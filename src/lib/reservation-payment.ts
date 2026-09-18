import { z } from "zod";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";

export const reservationReceiptSchema = z.object({
  reservationId: z.string().min(1),
  requestId: z.string().uuid(),
  amount: z.coerce.number().positive().max(10_000_000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two decimal places."),
  method: z.enum(["EFT", "CASH", "CARD"]),
  reference: z.string().trim().min(3).max(120),
  receivedAt: z.preprocess(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+02:00` : value, z.coerce.date().refine(value => value <= new Date(), "The received date cannot be in the future.")),
  realPaymentConfirmed: z.literal(true),
});

/** Caller requires payments.manage for the reservation facility. No payment is taken or simulated here. */
export async function recordReservationReceipt(scope: RequestScope, input: z.infer<typeof reservationReceiptSchema>) {
  const data = reservationReceiptSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${data.reservationId} FOR UPDATE`;
    const reservation = await tx.reservation.findFirst({ where: { id: data.reservationId, facility: facilityWhere(scope), customer: { organisationId: scope.organisationId } }, include: { publicLease: { select: { status: true } } } });
    if (!reservation || reservation.journey !== "RENTAL" || reservation.publicLease?.status !== "SIGNED") throw new Error("BOOKING_RECEIPT_UNAVAILABLE");
    const accountNumber = `ST24-T-${reservation.id}`;
    const account = await tx.account.upsert({ where: { accountNumber }, create: { accountNumber, customerId: reservation.customerId }, update: {} });
    if (account.customerId !== reservation.customerId) throw new Error("BOOKING_RECEIPT_UNAVAILABLE");
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${account.id} FOR UPDATE`;
    const idempotencyKey = `booking-receipt:${data.requestId}`;
    const existing = await tx.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.accountId !== account.id || Number(existing.amount) !== data.amount || existing.method !== data.method || existing.providerRef !== data.reference || existing.processedAt?.getTime() !== data.receivedAt.getTime()) throw new Error("BOOKING_RECEIPT_CONFLICT");
      return { paymentId: existing.id, idempotent: true };
    }
    if (reservation.status !== "ACTIVE" || reservation.convertedTenancyId) throw new Error("BOOKING_RECEIPT_UNAVAILABLE");
    // Catch a fresh-page retry of the same bank/terminal/cash receipt as well as a duplicate request.
    const duplicate = await tx.payment.findFirst({ where: { accountId: account.id, provider: null, providerRef: data.reference, status: "SUCCEEDED" } });
    if (duplicate) throw new Error("BOOKING_RECEIPT_REFERENCE_EXISTS");
    const payment = await tx.payment.create({ data: { accountId: account.id, amount: data.amount, currency: "ZAR", method: data.method, providerRef: data.reference, environment: "live", status: "SUCCEEDED", processedAt: data.receivedAt, idempotencyKey } });
    const ledger = await tx.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: data.amount, description: `${data.method} booking payment`, effectiveAt: data.receivedAt, externalRef: idempotencyKey, createdById: scope.userId, metadata: { reference: data.reference, reservationId: reservation.id, paymentId: payment.id, environment: "live" } } });
    await tx.account.update({ where: { id: account.id }, data: { balance: { decrement: data.amount } } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: reservation.facilityId, actorId: scope.userId, action: "booking.payment_recorded", entityType: "Payment", entityId: payment.id, after: { reservationId: reservation.id, accountId: account.id, amount: data.amount, ledgerEntryId: ledger.id, realPaymentConfirmed: true } } });
    return { paymentId: payment.id, idempotent: false };
  });
}
