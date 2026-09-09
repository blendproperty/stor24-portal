import { db } from "@/lib/db";

export async function requestPublicDebitOrderSetup(signingToken: string) {
  const lease = await db.publicReservationLease.findUnique({
    where: { signingToken },
    include: { reservation: { include: { customer: true, facility: true, unit: true } } },
  });
  if (!lease || lease.status !== "SIGNED" || lease.paymentMethod !== "DEBIT_ORDER") {
    return { ok: false as const, code: "DEBIT_ORDER_REQUEST_UNAVAILABLE" };
  }
  if (lease.expiresAt.getTime() <= Date.now()) {
    return { ok: false as const, code: "RESERVATION_EXPIRED" };
  }

  const taskId = `public-debit-order-${lease.id}`;
  const task = await db.task.upsert({
    where: { id: taskId },
    create: {
      id: taskId,
      organisationId: lease.reservation.customer.organisationId,
      facilityId: lease.reservation.facilityId,
      customerId: lease.reservation.customerId,
      title: `Complete debit-order mandate ${lease.reservation.publicReference}`,
      description: `Customer selected debit order and signed the reservation agreement for Unit ${lease.reservation.unit.number}. Complete the approved secure mandate process before collection, activation or access. Do not request bank details by ordinary email.`,
      priority: "HIGH",
      dueAt: new Date(),
    },
    update: {},
  });
  await db.auditEvent.create({
    data: {
      organisationId: lease.reservation.customer.organisationId,
      facilityId: lease.reservation.facilityId,
      action: "public_lease.debit_order_setup_requested",
      entityType: "PublicReservationLease",
      entityId: lease.id,
      requestId: taskId,
      after: { taskId: task.id, paymentMethod: lease.paymentMethod, noCollectionInitiated: true },
    },
  });
  return {
    ok: true as const,
    reference: lease.reservation.publicReference,
    facilityName: lease.reservation.facility.name,
    unitNumber: lease.reservation.unit.number,
    taskId: task.id,
  };
}
