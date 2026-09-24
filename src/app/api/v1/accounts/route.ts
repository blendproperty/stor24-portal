import { unitIsOperational, floorMapSelection } from "@/lib/floor-availability";
import { testPaymentReviewAccounts } from "@/lib/payments/test-payment-review";
import { isTestPayment } from "@/lib/payments/payment-evidence";
import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { accountPaymentSchema } from "@/lib/validators";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";

export async function GET() {
  try {
    const { organisationId, allowedFacilityIds } = await requirePermission("ledger.view");
    const accounts = await db.account.findMany({
      where: { customer: { organisationId }, tenancy: allowedFacilityIds ? { facilityId: { in: allowedFacilityIds } } : undefined },
      include: { customer: true, tenancy: { include: { facility: true, documents: { where: { type: "LEASE_AGREEMENT" }, orderBy: { createdAt: "desc" } }, occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: { include: { unitType: true } } }, orderBy: { startDate: "desc" }, take: 1 } } }, ledgerEntries: { orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }], take: 50 }, payments: { orderBy: { createdAt: "desc" }, take: 25 } },
      orderBy: { updatedAt: "desc" }, take: 250,
    });
    const facilities = await db.facility.findMany({ where: { organisationId, active: true, ...(allowedFacilityIds ? { id: { in: allowedFacilityIds } } : {}) }, include: { units: { where: { status: "AVAILABLE" }, include: { unitType: true, mapElements: floorMapSelection }, orderBy: { number: "asc" } } }, orderBy: { name: "asc" } });
    const review = await testPaymentReviewAccounts(accounts.map(a => a.id));
    return Response.json({ data: { accounts: accounts.map(account => ({ ...account, financialReviewRequired: review.has(account.id), payments: account.payments.map(p => ({ ...p, status: isTestPayment(p) && p.status === "SUCCEEDED" ? "TEST_SUCCEEDED" : p.status })) })), facilities: facilities.map(facility => ({ ...facility, units: facility.units.filter(unit => unitIsOperational(unit, facility.closedFloors)) })) } });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const parsed = accountPaymentSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { message: parsed.error.issues.some(issue => issue.path[0] === "requestId") ? "Refresh Accounts before recording a payment, then try again." : "Check the payment details.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const actor = await requirePermission("payments.manage");
    const account = await db.account.findFirst({ where: { id: parsed.data.accountId, customer: { organisationId: actor.organisationId } }, include: { customer: true, tenancy: { include: { facility: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: true }, take: 1 } } } } });
    if (!account?.tenancy) return Response.json({ error: { message: "Account not found." } }, { status: 404 });
    await requirePermission("payments.manage", account.tenancy.facilityId);
    const idempotencyKey = `account-receipt:${actor.organisationId}:${parsed.data.requestId}`;
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${account.id} FOR UPDATE`;
      const existing = await tx.payment.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.accountId !== account.id || existing.status !== "SUCCEEDED" || Number(existing.amount) !== parsed.data.amount || existing.method !== parsed.data.method || existing.providerRef !== (parsed.data.reference || null) || existing.processedAt?.getTime() !== parsed.data.receivedAt.getTime()) throw new Error("ACCOUNT_RECEIPT_CONFLICT");
        const current = await tx.account.findUniqueOrThrow({ where: { id: account.id }, select: { balance: true } });
        return { payment: existing, balance: current.balance, idempotent: true };
      }
      const payment = await tx.payment.create({ data: { accountId: account.id, amount: parsed.data.amount, method: parsed.data.method, status: "SUCCEEDED", processedAt: parsed.data.receivedAt, idempotencyKey, providerRef: parsed.data.reference || null } });
      const ledger = await tx.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: parsed.data.amount, description: `${parsed.data.method.replace("_", " ")} payment`, effectiveAt: parsed.data.receivedAt, externalRef: idempotencyKey, createdById: actor.user.id, metadata: parsed.data.reference ? { reference: parsed.data.reference } : undefined } });
      const updated = await tx.account.update({ where: { id: account.id }, data: { balance: { decrement: parsed.data.amount } } });
      await tx.auditEvent.create({ data: { organisationId: actor.organisationId, facilityId: account.tenancy!.facilityId, actorId: actor.user.id, action: "payment.posted", entityType: "Payment", entityId: payment.id, after: { accountId: account.id, amount: parsed.data.amount, method: parsed.data.method, ledgerEntryId: ledger.id } } });
      return { payment, balance: updated.balance, idempotent: false };
    });
    let notificationReviewRequired = false;
    if (!result.idempotent && account.customer.phone) {
      try {
        const delivery = await sendWhatsAppTemplate({ organisationId: actor.organisationId, facilityId: account.tenancy.facilityId, customerId: account.customer.id, recipient: account.customer.phone, consent: account.customer.communicationConsent, messageType: "PAYMENT_RECEIVED", idempotencyKey: `${idempotencyKey}:WHATSAPP`, variables: { "1": account.customer.firstName || account.customer.companyName || "customer", "2": `R${parsed.data.amount.toFixed(2)}`, "3": formatSouthAfricaDate(parsed.data.receivedAt), "4": account.accountNumber, "5": `R${Number(result.balance).toFixed(2)}` } });
        notificationReviewRequired = !delivery.ok && "logId" in delivery;
      } catch {
        // Delivery is after commit. Its failure must never invite a second receipt.
        notificationReviewRequired = true;
      }
      if (notificationReviewRequired) {
        try { await db.auditEvent.create({ data: { organisationId: actor.organisationId, facilityId: account.tenancy.facilityId, actorId: actor.user.id, action: "payment.notification_review_required", entityType: "Payment", entityId: result.payment.id } }); }
        catch { console.error("Payment notification review could not be recorded."); }
      }
    }
    return Response.json({ data: { ...result, notificationReviewRequired } }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    if ((error instanceof Error && error.message === "ACCOUNT_RECEIPT_CONFLICT") || (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) return Response.json({ error: { code: "ACCOUNT_RECEIPT_CONFLICT", message: "This payment request was already used with different details. Check the recorded payment before starting another receipt." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
