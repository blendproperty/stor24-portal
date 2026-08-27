import { dispatchBlendSignLease } from "@/lib/blendsign-lease-service";
import { db } from "@/lib/db";
import { moveIn, type MoveInResult } from "@/lib/leasing-service";
import { sendLeaseSigningLink } from "@/lib/notifications";
import type { RequestScope } from "@/lib/scope";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";

async function automationScope(organisationId: string, facilityId: string): Promise<RequestScope> {
  const user = await db.user.findFirst({
    where: { organisationId, active: true, roleAssignments: { some: { role: { name: "Organisation owner" } } } },
    orderBy: { createdAt: "asc" },
  });
  if (!user) throw new Error("AUTOMATION_OWNER_REQUIRED");
  return { userId: user.id, organisationId, facilityIds: [facilityId], unrestrictedFacilities: true };
}

async function existingMoveInResult(tenancyId: string): Promise<MoveInResult | null> {
  const tenancy = await db.tenancy.findUnique({
    where: { id: tenancyId },
    include: { customer: true, facility: true, documents: { orderBy: { createdAt: "desc" }, take: 1 }, occupancies: { include: { unit: { include: { unitType: true } } }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const document = tenancy?.documents[0];
  const unit = tenancy?.occupancies[0]?.unit;
  return tenancy && document && unit ? { tenancy, document, customer: tenancy.customer, facility: tenancy.facility, unit } : null;
}

export async function runSimulatedPaymentFollowUp(sessionId: string) {
  const current = await db.publicPaymentSession.findUnique({
    where: { id: sessionId },
    select: { followUpStatus: true, reservation: { select: { convertedTenancyId: true } } },
  });
  if (current?.followUpStatus === "COMPLETED") {
    const document = current.reservation.convertedTenancyId ? await db.document.findFirst({
      where: { tenancyId: current.reservation.convertedTenancyId, type: "LEASE_AGREEMENT_UAT" },
      orderBy: { createdAt: "desc" },
      select: { id: true, externalId: true },
    }) : null;
    const [email, whatsapp] = await Promise.all([
      document ? db.communicationLog.findUnique({ where: { idempotencyKey: `lease-sign:${document.id}` }, select: { status: true } }) : null,
      db.communicationLog.findUnique({ where: { idempotencyKey: `sim-payment:${sessionId}:WHATSAPP` }, select: { status: true } }),
    ]);
    const evidenceComplete = Boolean(document?.externalId && email?.status === "SUCCEEDED" && whatsapp && whatsapp.status !== "FAILED");
    if (evidenceComplete) return { ok: true as const, status: "COMPLETED" };
    await db.publicPaymentSession.update({
      where: { id: sessionId },
      data: { followUpStatus: "FAILED", followUpError: "FOLLOW_UP_EVIDENCE_MISSING" },
    });
  }
  const claimed = await db.publicPaymentSession.updateMany({
    where: { id: sessionId, status: "SUCCEEDED", followUpStatus: { in: ["NOT_STARTED", "FAILED"] } },
    data: { followUpStatus: "PROCESSING", followUpError: null },
  });
  if (!claimed.count) {
    const existing = await db.publicPaymentSession.findUnique({ where: { id: sessionId }, select: { followUpStatus: true } });
    return { ok: existing?.followUpStatus === "COMPLETED", status: existing?.followUpStatus ?? "NOT_FOUND" };
  }

  try {
    const session = await db.publicPaymentSession.findUnique({
      where: { id: sessionId },
      include: { reservation: { include: { customer: true, facility: true, unit: { include: { unitType: true } } } } },
    });
    if (!session) throw new Error("PAYMENT_SESSION_NOT_FOUND");
    const reservation = session.reservation;
    const scope = await automationScope(reservation.customer.organisationId, reservation.facilityId);
    let result = reservation.convertedTenancyId ? await existingMoveInResult(reservation.convertedTenancyId) : null;
    if (!result) {
      result = await moveIn(scope, {
        reservationId: reservation.id,
        facilityId: reservation.facilityId,
        customerId: reservation.customerId,
        unitId: reservation.unitId,
        startDate: reservation.intendedMoveIn ?? new Date(),
        monthlyRate: Number(reservation.quotedRate),
        initialCharge: 0,
        accessState: "PENDING_SIGNATURE",
        paymentMethod: "CARD",
        simulation: true,
      });
    }
    const envelope = await dispatchBlendSignLease(scope, result, { paymentMethod: "CARD", startDate: result.tenancy.startDate, monthlyRate: Number(reservation.quotedRate), simulation: true });
    const customerName = reservation.customer.companyName || [reservation.customer.firstName, reservation.customer.lastName].filter(Boolean).join(" ") || "customer";
    const signer = envelope.signers.find((item) => item.email === reservation.customer.email) ?? envelope.signers.find((item) => item.order === 1);
    if (!signer?.signingUrl) throw new Error("BLENDSIGN_SIGNING_URL_MISSING");
    const email = await sendLeaseSigningLink({
      organisationId: reservation.customer.organisationId,
      facilityId: reservation.facilityId,
      customerId: reservation.customerId,
      documentId: result.document.id,
      to: { email: reservation.customer.email },
      variables: { customerName, facilityName: reservation.facility.name, unitNumber: reservation.unit.number, signingUrl: signer.signingUrl, expiresAt: result.document.expiresAt?.toLocaleString("en-ZA") ?? "soon" },
      simulation: true,
    });
    if (!email.ok) throw new Error(`LEASE_EMAIL_${email.reason}`);
    const account = await db.account.findUnique({ where: { id: result.tenancy.accountId }, select: { accountNumber: true } });
    if (!account) throw new Error("ACCOUNT_NOT_FOUND");
    const whatsapp = reservation.customer.phone ? await sendWhatsAppTemplate({
      organisationId: reservation.customer.organisationId,
      facilityId: reservation.facilityId,
      customerId: reservation.customerId,
      recipient: reservation.customer.phone,
      consent: reservation.customer.communicationConsent,
      messageType: "PAYMENT_RECEIVED",
      idempotencyKey: `sim-payment:${session.id}:WHATSAPP`,
      variables: { "1": reservation.customer.firstName || reservation.customer.companyName || "customer", "2": `R${Number(session.amount).toFixed(2)} UAT`, "3": new Date().toLocaleDateString("en-ZA"), "4": account.accountNumber, "5": "R0.00" },
    }) : { ok: false as const, code: "NO_PHONE" };
    if (!whatsapp.ok) throw new Error(`PAYMENT_WHATSAPP_${whatsapp.code}`);
    const [emailEvidence, whatsappEvidence, documentEvidence] = await Promise.all([
      db.communicationLog.findUnique({ where: { idempotencyKey: `lease-sign:${result.document.id}` }, select: { status: true } }),
      db.communicationLog.findUnique({ where: { idempotencyKey: `sim-payment:${session.id}:WHATSAPP` }, select: { status: true } }),
      db.document.findUnique({ where: { id: result.document.id }, select: { externalId: true } }),
    ]);
    if (!documentEvidence?.externalId || emailEvidence?.status !== "SUCCEEDED" || !whatsappEvidence || whatsappEvidence.status === "FAILED") {
      throw new Error("FOLLOW_UP_EVIDENCE_MISSING");
    }
    await db.$transaction([
      db.publicPaymentSession.update({ where: { id: session.id }, data: { followUpStatus: "COMPLETED", followUpError: null } }),
      db.auditEvent.create({ data: { organisationId: reservation.customer.organisationId, facilityId: reservation.facilityId, action: "public_payment.simulator_follow_up_completed", entityType: "PublicPaymentSession", entityId: session.id, after: { simulated: true, tenancyId: result.tenancy.id, documentId: result.document.id, envelopeId: envelope.envelopeId } } }),
    ]);
    return { ok: true as const, status: "COMPLETED", tenancyId: result.tenancy.id, documentId: result.document.id };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "SIMULATED_PAYMENT_FOLLOW_UP_FAILED";
    await db.publicPaymentSession.update({ where: { id: sessionId }, data: { followUpStatus: "FAILED", followUpError: message } });
    return { ok: false as const, status: "FAILED", error: message };
  }
}
