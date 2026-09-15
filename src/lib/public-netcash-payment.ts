import { db } from "@/lib/db";
import { welcomeTenantWhenReady } from "@/lib/tenant-welcome-email";
import { createOnceOffCheckout } from "@/lib/payments/netcash-service";
import { getNetcashConnection } from "@/lib/payments/netcash-client";

export function publicNetcashPaymentStatus(status: string, failureCode: string | null) {
  if (status === "FAILED" && failureCode && /\bcancell?(?:ed|ation)\b/i.test(failureCode)) {
    return "CANCELLED" as const;
  }
  return status;
}

export async function startPublicNetcashSandboxPayment(reference: string, idempotencyKey: string) {
  const reservation = await db.reservation.findUnique({
    where: { publicReference: reference },
    include: {
      facility: { select: { name: true } },
      unit: { select: { number: true } },
      customer: true,
      packageSelection: { select: { priceSnapshot: true } },
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

  // This sends the reservation's real quoted rate to Netcash so a completed
  // transaction here is a true proof the integration handles what a
  // customer would actually pay -- not a token amount that always
  // "succeeds" regardless of what's really being charged. That is only
  // safe to do because this code path is only ever reachable through a
  // Netcash connection explicitly configured as "sandbox": nothing in the
  // Netcash client enforces that on its own (getNetcashConnection returns
  // whatever environment the organisation's connection is set to), and
  // there is no invoicing/ledger integration behind this endpoint (see
  // claude/invoicing-statements-scope.md) for a charge to land safely in
  // if it were ever real money. So we check the environment ourselves,
  // before it ever reaches Netcash, and refuse outright rather than
  // silently falling back to a smaller "safe" amount.
  const connection = await getNetcashConnection(reservation.customer.organisationId, null);
  if (connection.config.environment !== "sandbox") {
    return { ok: false as const, code: "NETCASH_LIVE_ENVIRONMENT_BLOCKED" };
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
  await welcomeTenantWhenReady(reservation.customerId, reservation.customer.organisationId);
  // The unit's monthly rate and any storage/merchandise package selected
  // during booking are priced separately (Reservation.quotedRate vs.
  // ReservationPackage.priceSnapshot) -- both have to be summed here or a
  // reservation with a package attached sends Netcash a total that's short
  // of what the customer actually booked.
  const quotedRate = Number(reservation.quotedRate);
  const packageAmount = Number(reservation.packageSelection?.priceSnapshot ?? 0);
  const amount = quotedRate + packageAmount;
  const checkout = await createOnceOffCheckout(
    reservation.customer.organisationId,
    null,
    {
      accountId: account.id,
      amount,
      description: `STOR24 test - Unit ${reservation.unit.number}`,
      customerEmail: reservation.customer.email ?? undefined,
      extra1: reference,
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
        amount,
        quotedRate,
        packageAmount,
        environment: "sandbox",
      },
    },
  });
  return {
    ok: true as const,
    paymentId: checkout.payment.id,
    amountZar: amount,
    currency: checkout.payment.currency,
    facilityName: reservation.facility.name,
    unitNumber: reservation.unit.number,
    checkout: checkout.checkout,
  };
}

export async function getPublicNetcashSandboxPayment(reference: string, paymentId: string) {
  const reservation = await db.reservation.findUnique({
    where: { publicReference: reference },
    select: {
      id: true,
      status: true,
      journey: true,
      publicLease: { select: { status: true, signingToken: true, paymentMethod: true } },
    },
  });
  if (!reservation || reservation.journey !== "RENTAL") {
    return { ok: false as const, code: "PAYMENT_UNAVAILABLE" };
  }
  const account = await db.account.findUnique({
    where: { accountNumber: `ST24-T-${reservation.id}` },
    select: {
      payments: {
        where: { id: paymentId, provider: "NETCASH", method: "PAY_NOW" },
        select: { id: true, status: true, amount: true, currency: true, failureCode: true, processedAt: true },
        take: 1,
      },
    },
  });
  const payment = account?.payments[0];
  if (!payment) return { ok: false as const, code: "PAYMENT_UNAVAILABLE" };
  return {
    ok: true as const,
    paymentId: payment.id,
    status: publicNetcashPaymentStatus(payment.status, payment.failureCode),
    amountZar: Number(payment.amount),
    currency: payment.currency,
    failureCode: payment.failureCode,
    processedAt: payment.processedAt?.toISOString() ?? null,
    reservationStatus: reservation.status,
    leaseToken: reservation.publicLease?.status === "SIGNED" ? reservation.publicLease.signingToken : null,
    paymentMethod: reservation.publicLease?.status === "SIGNED" ? reservation.publicLease.paymentMethod : null,
  };
}

export async function cancelPublicNetcashSandboxPayment(reference: string, paymentId: string) {
  const reservation = await db.reservation.findUnique({
    where: { publicReference: reference },
    select: { id: true, facilityId: true, customer: { select: { organisationId: true } } },
  });
  if (!reservation) return { ok: false as const, code: "PAYMENT_UNAVAILABLE" };

  const account = await db.account.findUnique({
    where: { accountNumber: `ST24-T-${reservation.id}` },
    select: {
      payments: {
        where: { id: paymentId, provider: "NETCASH", method: "PAY_NOW" },
        select: { id: true, status: true },
        take: 1,
      },
    },
  });
  const payment = account?.payments[0];
  if (!payment) return { ok: false as const, code: "PAYMENT_UNAVAILABLE" };

  if (payment.status === "PENDING") {
    await db.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", failureCode: "NETCASH_CUSTOMER_CANCELLED", processedAt: new Date() },
      });
      if (!changed.count) return;
      await tx.auditEvent.create({
        data: {
          organisationId: reservation.customer.organisationId,
          facilityId: reservation.facilityId,
          action: "public_payment.netcash_cancelled",
          entityType: "Payment",
          entityId: payment.id,
          after: { status: "FAILED", failureCode: "NETCASH_CUSTOMER_CANCELLED" },
        },
      });
    });
  }

  const current = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, failureCode: true } });
  return {
    ok: true as const,
    status: publicNetcashPaymentStatus(current?.status ?? payment.status, current?.failureCode ?? null),
  };
}
