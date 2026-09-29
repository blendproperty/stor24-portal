import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { trainingAccess } from "@/lib/move-in-training";
import { bookingTestPaymentSchema, bookingTestPaymentSnapshotSchema } from "@/lib/booking-test-payment-contract";

const action = "training.booking_payment_recorded";
async function snapshot(tx: Prisma.TransactionClient, userId: string, reservationId: string) {
  const access = await trainingAccess(tx, userId);
  const reservation = await tx.reservation.findFirst({ where: {
    id: reservationId, facilityId: { in: access.facilities.map(f => f.id) },
    customer: { organisationId: access.organisationId }, journey: "RENTAL", status: "ACTIVE",
    publicLease: { status: "SIGNED" },
  }, select: { id: true, facilityId: true } });
  if (!reservation) throw new Error("FORBIDDEN");
  const control = await tx.moveInTrainingControl.findUnique({ where: { organisationId: access.organisationId } });
  const generation = control?.generation ?? 0;
  const saved = control?.enabled ? await tx.auditEvent.findFirst({ where: {
    organisationId: access.organisationId, facilityId: reservation.facilityId,
    action, entityType: "Reservation", entityId: reservation.id,
    after: { path: ["generation"], equals: generation },
  }, orderBy: { occurredAt: "desc" } }) : null;
  const after = saved?.after as { amount?: number } | undefined;
  return { access, reservation, data: bookingTestPaymentSnapshotSchema.parse({
    reservationId, enabled: control?.enabled ?? false, generation,
    receipt: saved ? { id: saved.id, amount: after?.amount, recordedAt: saved.occurredAt.toISOString(), testOnly: true } : null,
  }) };
}
export async function bookingTestPaymentSnapshot(userId: string, reservationId: string) {
  return (await snapshot(db, userId, reservationId)).data;
}
export async function recordBookingTestPayment(userId: string, input: unknown) {
  const data = bookingTestPaymentSchema.parse(input);
  const access = await trainingAccess(db, userId);
  return db.$transaction(async tx => {
    // Same lock as the owner switch: disable/re-enable cannot race a test receipt.
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${access.organisationId} FOR UPDATE`;
    const current = await snapshot(tx, userId, data.reservationId);
    if (current.access.organisationId !== access.organisationId) throw new Error("FORBIDDEN");
    if (!current.data.enabled) throw new Error("TRAINING_DISABLED");
    if (current.data.generation !== data.generation) throw new Error("TRAINING_CHANGED");
    // One simulation per booking per owner-enabled training session, including fresh-page retries.
    if (current.data.receipt) {
      if (current.data.receipt.amount !== data.amount) throw new Error("TEST_PAYMENT_EXISTS");
      return current.data;
    }
    await tx.auditEvent.create({ data: {
      organisationId: current.access.organisationId, facilityId: current.reservation.facilityId,
      actorId: userId, action, entityType: "Reservation", entityId: data.reservationId,
      after: { generation: data.generation, amount: data.amount, testOnly: true, fundsReceived: false },
    } });
    // Deliberately no Payment, LedgerEntry, Account, tenancy, gate or booking writes.
    return (await snapshot(tx, userId, data.reservationId)).data;
  });
}
