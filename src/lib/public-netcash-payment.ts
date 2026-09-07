import { db } from "@/lib/db";
import { createOnceOffCheckout } from "@/lib/payments/netcash-service";

export const NETCASH_SANDBOX_PAYMENT_AMOUNT_ZAR = 10;

export async function startPublicNetcashSandboxPayment(reference: string, idempotencyKey: string) {
  const reservation = await db.reservation.findUnique({
    where: { publicReference: reference },
    include: {
      facility: { select: { name: true } },
      unit: { select: { number: true } },
      customer: true,
    },
  });
  if (
    !reservation ||
    reservation.status !== "ACTIVE" ||
    reservation.journey !== "RENTAL" ||
    !reservation.contactVerifiedAt ||
    !reservation.customer.emailVerifiedAt
  ) {
    return { ok: false as const, code: "RESERVATION_UNAVAILABLE" };
  }

  const account = await db.account.upsert({
    where: { accountNumber: `ST24-T-${reservation.id}` },
    create: {
      customerId: reservation.customerId,
      accountNumber: `ST24-T-${reservation.id}`,
    },
    update: {},
  });
  if (account.customerId !== reservation.customerId) throw new Error("NETCASH_ACCOUNT_CONFLICT");
  const checkout = await createOnceOffCheckout(
    reservation.customer.organisationId,
    null,
    {
      accountId: account.id,
      amount: NETCASH_SANDBOX_PAYMENT_AMOUNT_ZAR,
      description: `STOR24 test - Unit ${reservation.unit.number}`,
      customerEmail: reservation.customer.email ?? undefined,
      idempotencyKey: `netcash-public-test-${idempotencyKey}`,
    },
  );
  await db.auditEvent.create({
    data: {
      organisationId: reservation.customer.organisationId,
      facilityId: reservation.facilityId,
      action: "public_payment.netcash_sandbox_started",
      entityType: "Payment",
      entityId: checkout.payment.id,
      requestId: idempotencyKey,
      after: {
        reservationId: reservation.id,
        amount: NETCASH_SANDBOX_PAYMENT_AMOUNT_ZAR,
        environment: "sandbox",
      },
    },
  });
  return {
    ok: true as const,
    paymentId: checkout.payment.id,
    amountZar: NETCASH_SANDBOX_PAYMENT_AMOUNT_ZAR,
    currency: checkout.payment.currency,
    facilityName: reservation.facility.name,
    unitNumber: reservation.unit.number,
    checkout: checkout.checkout,
  };
}
