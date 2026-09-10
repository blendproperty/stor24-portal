import { db } from "@/lib/db";
import { parseDebitOrderPreferences } from "@/lib/debit-order-preferences";

export async function requestPublicDebitOrderSetup(signingToken: string, input: unknown) {
  const lease = await db.publicReservationLease.findUnique({
    where: { signingToken },
    include: { mandate: true, reservation: { include: { customer: true, facility: true, unit: true } } },
  });
  if (!lease || lease.status !== "SIGNED" || lease.paymentMethod !== "DEBIT_ORDER") {
    return { ok: false as const, code: "DEBIT_ORDER_REQUEST_UNAVAILABLE" };
  }
  if (lease.mandate) return { ok: false as const, code: "MANDATE_ALREADY_STARTED" };
  if (lease.expiresAt.getTime() <= Date.now() || lease.reservation.status !== "ACTIVE") {
    return { ok: false as const, code: "RESERVATION_EXPIRED" };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const moveIn = lease.reservation.intendedMoveIn?.toISOString().slice(0, 10) ?? today;
  const preferences = parseDebitOrderPreferences(input, moveIn > today ? moveIn : today);
  if (!preferences) return { ok: false as const, code: "COLLECTION_PREFERENCES_REQUIRED" };

  const taskId = `public-debit-order-${lease.id}`;
  return db.$transaction(async (tx) => {
  const requestedAt = lease.debitOrderRequestedAt ?? new Date();
  const claimed = await tx.publicReservationLease.updateMany({ where: { id: lease.id, mandate: { is: null } }, data: { debitOrderPreferences: preferences, debitOrderRequestedAt: requestedAt } });
  if (!claimed.count) return { ok: false as const, code: "MANDATE_ALREADY_STARTED" };
  const description = `Customer selected debit order and signed for Unit ${lease.reservation.unit.number}. Requested first collection: ${preferences.firstCollectionDate}; monthly day: ${preferences.collectionDay}. These are preferences, NOT a signed bank mandate or an approved collection schedule. Complete approved secure mandate before collection, activation or access. Never request bank details by ordinary email.`;
  const task = await tx.task.upsert({
    where: { id: taskId },
    create: {
      id: taskId,
      organisationId: lease.reservation.customer.organisationId,
      facilityId: lease.reservation.facilityId,
      customerId: lease.reservation.customerId,
      title: `Complete debit-order mandate ${lease.reservation.publicReference}`,
      description,
      priority: "HIGH",
      dueAt: new Date(),
    },
    update: { description },
  });
  await tx.auditEvent.create({
    data: {
      organisationId: lease.reservation.customer.organisationId,
      facilityId: lease.reservation.facilityId,
      action: "public_lease.debit_order_setup_requested",
      entityType: "PublicReservationLease",
      entityId: lease.id,
      requestId: taskId,
      after: { taskId: task.id, paymentMethod: lease.paymentMethod, preferences, noCollectionInitiated: true },
    },
  });
  return {
    ok: true as const,
    reference: lease.reservation.publicReference,
    facilityName: lease.reservation.facility.name,
    unitNumber: lease.reservation.unit.number,
    taskId: task.id,
    requestedAt: requestedAt.toISOString(),
    preferences,
    mandateStatus: "AWAITING_SECURE_MANDATE",
  };
  });
}
