import { db } from "@/lib/db";
import { notifyReservationConfirmed } from "@/lib/notifications";
import { requireFacility, type RequestScope } from "@/lib/scope";
import type { OfflineReservationSyncInput } from "@/lib/validators";

const HOLD_HOURS = 24;

function idempotencyKey(submissionId: string) {
  return `offline:${submissionId}`;
}

function reservationReference(capturedAt: string, submissionId: string) {
  const day = capturedAt.slice(0, 10).replaceAll("-", "");
  return `ST24-${day}-${submissionId.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

type DeliveryChannel = "EMAIL" | "SMS" | "WHATSAPP";
type DeliveryResult = { channel: DeliveryChannel; status: "SENT" | "FAILED" | "NOT_CONSENTED" | "NO_CONTACT" };

function consentObject(value: unknown) {
  const consent = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { email: consent.email === true, sms: consent.sms === true, phone: consent.phone === true, whatsapp: consent.whatsapp === true };
}

function deliverySummary(consent: ReturnType<typeof consentObject>, contact: { email: string | null; phone: string | null }, attempted: Array<{ channel: DeliveryChannel; ok: boolean }>): DeliveryResult[] {
  const attemptedByChannel = new Map(attempted.map((result) => [result.channel, result.ok]));
  return (["EMAIL", "SMS", "WHATSAPP"] as const).map((channel) => {
    const consented = channel === "EMAIL" ? consent.email : channel === "SMS" ? consent.sms : consent.whatsapp;
    const hasContact = channel === "EMAIL" ? Boolean(contact.email) : Boolean(contact.phone);
    if (!consented) return { channel, status: "NOT_CONSENTED" };
    if (!hasContact) return { channel, status: "NO_CONTACT" };
    return { channel, status: attemptedByChannel.get(channel) ? "SENT" : "FAILED" };
  });
}

async function existingDeliverySummary(reservationId: string, consent: ReturnType<typeof consentObject>, contact: { email: string | null; phone: string | null }) {
  const logs = await db.communicationLog.findMany({
    where: { idempotencyKey: { startsWith: `offline-reservation:${reservationId}:` } },
    select: { channel: true, status: true },
  });
  return deliverySummary(consent, contact, logs.map((log) => ({ channel: log.channel as DeliveryChannel, ok: log.status === "SUCCEEDED" })));
}

export async function syncOfflineReservation(scope: RequestScope, input: OfflineReservationSyncInput) {
  await requireFacility(scope, input.facilityId);
  const key = idempotencyKey(input.submissionId);
  const existing = await db.reservation.findUnique({
    where: { idempotencyKey: key },
    include: { facility: { select: { organisationId: true } }, customer: { select: { email: true, phone: true, communicationConsent: true } } },
  });
  if (existing) {
    if (existing.facility.organisationId !== scope.organisationId || existing.facilityId !== input.facilityId) throw new Error("FORBIDDEN");
    const consent = consentObject(existing.customer.communicationConsent);
    return { reservationId: existing.id, reference: existing.publicReference, holdExpiresAt: existing.holdExpiresAt?.toISOString() ?? null, communications: await existingDeliverySummary(existing.id, consent, existing.customer), idempotent: true };
  }

  const lead = await db.lead.findFirst({
    where: { id: input.leadId, customerId: input.customerId, facilityId: input.facilityId, facility: { organisationId: scope.organisationId } },
    select: { id: true },
  });
  if (!lead) throw new Error("FORBIDDEN");

  try {
    const created = await db.$transaction(async (tx) => {
      const claimed = await tx.unit.updateMany({
        where: { id: input.unitId, facilityId: input.facilityId, status: "AVAILABLE" },
        data: { status: "RESERVED" },
      });
      if (claimed.count !== 1) throw new Error("UNIT_UNAVAILABLE");

      const holdExpiresAt = new Date(Date.now() + HOLD_HOURS * 60 * 60 * 1000);
      const reservation = await tx.reservation.create({
        data: {
          facilityId: input.facilityId,
          customerId: input.customerId,
          leadId: input.leadId,
          unitId: input.unitId,
          quotedRate: input.quotedRate,
          holdExpiresAt,
          intendedMoveIn: input.intendedMoveIn ? new Date(`${input.intendedMoveIn}T00:00:00.000Z`) : undefined,
          source: "OFFLINE_PWA",
          idempotencyKey: key,
          publicReference: reservationReference(input.capturedAt, input.submissionId),
        },
      });
      await tx.lead.updateMany({ where: { id: input.leadId, customerId: input.customerId, facilityId: input.facilityId }, data: { stage: "RESERVED" } });
      await tx.task.create({
        data: {
          organisationId: scope.organisationId,
          facilityId: input.facilityId,
          customerId: input.customerId,
          createdById: scope.userId,
          title: `Follow up offline reservation ${reservation.publicReference}`,
          description: "Confirm whether the customer wants to view, receive a secure payment link, or continue to the correct lease workflow. Do not take payment or create a lease from the offline device.",
          priority: "HIGH",
          dueAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          organisationId: scope.organisationId,
          facilityId: input.facilityId,
          actorId: scope.userId,
          action: "offline.reservation.synced",
          entityType: "Reservation",
          entityId: reservation.id,
          requestId: input.submissionId,
          after: { deviceId: input.deviceId, capturedAt: input.capturedAt, unitId: input.unitId, source: "OFFLINE_PWA", holdExpiresAt: holdExpiresAt.toISOString() },
        },
      });
      return { reservationId: reservation.id, reference: reservation.publicReference, holdExpiresAt: holdExpiresAt.toISOString(), idempotent: false };
    });
    const details = await db.reservation.findUnique({ where: { id: created.reservationId }, include: { customer: true, facility: true, unit: true } });
    if (!details) return { ...created, communications: [] as DeliveryResult[] };
    const consent = consentObject(details.customer.communicationConsent);
    const attempted = await notifyReservationConfirmed({
      organisationId: scope.organisationId,
      facilityId: details.facilityId,
      customerId: details.customerId,
      idempotencyKey: `offline-reservation:${details.id}`,
      consent,
      to: { email: details.customer.email ?? "", phone: details.customer.phone ?? "" },
      variables: {
        firstName: details.customer.firstName || details.customer.companyName || "customer",
        facilityName: details.facility.name,
        unitNumber: details.unit.number,
        monthlyRateZar: Number(details.quotedRate).toFixed(2),
        holdExpiresAt: created.holdExpiresAt,
        intendedMoveIn: details.intendedMoveIn?.toLocaleDateString("en-ZA") ?? "To be confirmed",
        reference: details.publicReference ?? created.reference ?? "",
      },
    }).catch(() => [] as Array<{ channel: DeliveryChannel; ok: boolean }>);
    return { ...created, communications: deliverySummary(consent, details.customer, attempted) };
  } catch (error) {
    const raced = await db.reservation.findUnique({ where: { idempotencyKey: key }, include: { facility: { select: { organisationId: true } }, customer: { select: { email: true, phone: true, communicationConsent: true } } } });
    if (raced && raced.facility.organisationId === scope.organisationId && raced.facilityId === input.facilityId) {
      const consent = consentObject(raced.customer.communicationConsent);
      return { reservationId: raced.id, reference: raced.publicReference, holdExpiresAt: raced.holdExpiresAt?.toISOString() ?? null, communications: await existingDeliverySummary(raced.id, consent, raced.customer), idempotent: true };
    }
    throw error;
  }
}
