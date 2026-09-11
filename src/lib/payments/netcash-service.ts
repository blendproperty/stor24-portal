/**
 * Orchestration layer between Netcash and this CRM's own billing records.
 * Every call here writes/updates a Payment row (provider: "NETCASH") and, on
 * success, a LedgerEntry, and tracks IntegrationConnection health the same
 * way other providers in this repo are tracked. This is the layer
 * billing-service.ts / staff UI should call -- nothing should call
 * netcash-client.ts directly outside this file and the webhook handler.
 */
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { assertMerchandiseCheckoutEnabled } from "@/lib/merchandise-checkout-access";
import {
  getNetcashConnection,
  createEMandateSync,
  submitDebiCheckMandate,
  submitDebiCheckCollection,
  submitStandardDebitOrder,
  createPayNowCheckout,
  verifyBankAccount,
  fetchNetcashStatement,
} from "@/lib/payments/netcash-client";

async function recordHealth(connectionId: string, ok: boolean, failureCode?: string, failureMessage?: string) {
  await db.integrationConnection.update({
    where: { id: connectionId },
    data: ok
      ? { status: "HEALTHY", lastHealthAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0, failureCode: null, failureMessage: null }
      : { status: "DEGRADED", lastHealthAt: new Date(), lastFailureAt: new Date(), consecutiveFailures: { increment: 1 }, failureCode, failureMessage },
  });
}

/** Draft checkout: persist the link before any provider form can leave the server. */
export async function createMerchandiseCheckout(session: Parameters<typeof tenantCustomerScope>[0], orderId: string) {
  assertMerchandiseCheckoutEnabled(session);
  const owned = await db.merchandiseOrder.findFirst({ where: { id: orderId, organisationId: session.organisationId, account: { customer: tenantCustomerScope(session) } }, select: { facilityId: true } });
  if (!owned) throw new Error("TENANT_NOT_FOUND");
  const connection = await getNetcashConnection(session.organisationId, owned.facilityId, true);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "MerchandiseOrder" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.merchandiseOrder.findFirst({ where: { id: orderId, organisationId: session.organisationId, account: { customer: tenantCustomerScope(session) } } });
    if (!order) throw new Error("TENANT_NOT_FOUND");
    if (order.status !== "AWAITING_PAYMENT" || !order.stockHeld || order.expiresAt <= new Date() || order.currency !== "ZAR") throw new Error("MERCHANDISE_ORDER_NOT_PAYABLE");
    // Never issue a second form for a single-use reference or reset a pending payment.
    // A lost response requires cancellation/status recovery, not a second charge attempt.
    if (order.paymentId) throw new Error("MERCHANDISE_CHECKOUT_ALREADY_STARTED");
    const payment = await tx.payment.create({ data: { accountId: order.accountId, status: "PENDING", amount: order.total, currency: order.currency, method: "PAY_NOW", provider: "NETCASH", idempotencyKey: `merchandise:${order.id}` } });
    const checkout = createPayNowCheckout(connection, { reference: payment.id, amount: Number(order.total.toFixed(2)), description: "STOR24 packing supplies", customerEmail: session.email, returnData: new URLSearchParams({ paymentId: payment.id, merchandiseOrderId: order.id }).toString(), extra1: order.id, extra2: "merchandise" });
    await tx.payment.update({ where: { id: payment.id }, data: { providerRef: payment.id } });
    await tx.merchandiseOrder.update({ where: { id: order.id }, data: { paymentId: payment.id } });
    await tx.auditEvent.create({ data: { organisationId: order.organisationId, facilityId: order.facilityId, action: "merchandise_order.checkout_started", entityType: "MerchandiseOrder", entityId: order.id, after: { paymentId: payment.id } } });
    // Form construction is not a provider health check or proof of payment.
    return { orderId: order.id, paymentId: payment.id, checkout };
  });
}

/** Verify a bank account before setting up any mandate -- catches typos before they cost a failed-collection fee. */
export async function verifyCustomerBankAccount(organisationId: string, facilityId: string | null, params: {
  accountHolderName: string;
  bankAccountNumber: string;
  branchCode: string;
  idNumber?: string;
}) {
  const connection = await getNetcashConnection(organisationId, facilityId);
  try {
    const result = await verifyBankAccount(connection, params);
    await recordHealth(connection.id, true);
    return result;
  } catch (err) {
    await recordHealth(connection.id, false, "AVS_FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Set up recurring collection for a tenancy's Account. Tries DebiCheck first
 * (mandatory authentication, lower dispute risk) and can fall back to the
 * synchronous eMandate flow or a standard debit order depending on facility
 * configuration -- policy TODO, currently always uses DebiCheck.
 */
export async function setUpRecurringCollection(organisationId: string, facilityId: string | null, params: {
  accountId: string;
  accountHolderName: string;
  bankAccountNumber: string;
  branchCode: string;
  idNumber: string;
  mobileNumber: string;
  collectionAmount: number;
  collectionDay: number;
  startDate: string;
}) {
  const connection = await getNetcashConnection(organisationId, facilityId);
  const reference = `ACC-${params.accountId}-${randomUUID().slice(0, 8)}`;
  try {
    const result = await submitDebiCheckMandate(connection, {
      reference,
      accountHolderName: params.accountHolderName,
      bankAccountNumber: params.bankAccountNumber,
      branchCode: params.branchCode,
      idNumber: params.idNumber,
      mobileNumber: params.mobileNumber,
      collectionAmount: params.collectionAmount,
      maxCollectionAmount: params.collectionAmount,
      collectionDay: params.collectionDay,
      frequency: "MONTHLY",
      startDate: params.startDate,
    });
    await recordHealth(connection.id, true);
    return { mandateReference: result.mandateReference, reference, raw: result.raw };
  } catch (err) {
    await recordHealth(connection.id, false, "MANDATE_FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Submit the monthly collection for an already-authenticated mandate. Called from the billing cron. */
export async function collectMonthlyRent(organisationId: string, facilityId: string | null, params: {
  accountId: string;
  mandateReference: string;
  amount: number;
  actionDate: string;
}) {
  const connection = await getNetcashConnection(organisationId, facilityId);
  const idempotencyKey = `netcash-collect-${params.accountId}-${params.actionDate}`;

  const existing = await db.payment.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const payment = await db.payment.create({
    data: {
      accountId: params.accountId,
      status: "PENDING",
      amount: params.amount,
      method: "DEBICHECK",
      provider: "NETCASH",
      idempotencyKey,
    },
  });

  try {
    const result = await submitDebiCheckCollection(connection, {
      mandateReference: params.mandateReference,
      amount: params.amount,
      actionDate: params.actionDate,
      reference: payment.id,
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { providerRef: result.collectionReference, status: "PENDING" }, // final status arrives via webhook, not this response
    });
    await recordHealth(connection.id, true);
    return payment;
  } catch (err) {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureCode: err instanceof Error ? err.message.slice(0, 120) : "UNKNOWN" },
    });
    await recordHealth(connection.id, false, "COLLECTION_SUBMIT_FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Once-off payment (deposit, arrears, ad-hoc charge) via Netcash's hosted Pay
 * Now eCommerce checkout. Unlike the other functions in this file, this
 * doesn't call Netcash at all -- it returns a form the caller must render
 * and auto-submit from the customer's browser (see the doc comment on
 * createPayNowCheckout in netcash-client.ts for why, and for the one-time
 * NetConnector Profile URLs that must be configured in the Netcash portal
 * before a real postback can arrive).
 */
export async function createOnceOffCheckout(organisationId: string, facilityId: string | null, params: {
  accountId: string;
  amount: number;
  description: string;
  customerEmail?: string;
  extra1?: string;
  idempotencyKey?: string;
}) {
  const connection = await getNetcashConnection(organisationId, facilityId);
  const idempotencyKey = params.idempotencyKey ?? `netcash-paynow-${params.accountId}-${randomUUID()}`;
  let payment = await db.payment.upsert({
    where: { idempotencyKey },
    create: {
      accountId: params.accountId,
      status: "PENDING",
      amount: params.amount,
      method: "PAY_NOW",
      provider: "NETCASH",
      idempotencyKey,
    },
    update: {},
  });
  if (payment.accountId !== params.accountId || Number(payment.amount) !== params.amount || payment.method !== "PAY_NOW" || payment.provider !== "NETCASH") {
    throw new Error("NETCASH_IDEMPOTENCY_CONFLICT");
  }
  if (payment.status === "SUCCEEDED") throw new Error("NETCASH_PAYMENT_ALREADY_SUCCEEDED");
  if (payment.status === "FAILED") {
    payment = await db.payment.update({
      where: { id: payment.id },
      data: { status: "PENDING", failureCode: null },
    });
  }
  try {
    const checkout = createPayNowCheckout(connection, {
      reference: payment.id,
      amount: params.amount,
      description: params.description,
      customerEmail: params.customerEmail,
      extra1: params.extra1,
      returnData: new URLSearchParams({
        paymentId: payment.id,
        ...(params.extra1 ? { reference: params.extra1 } : {}),
      }).toString(),
    });
    // providerRef is the p2 reference we sent (payment.id) -- the Notify
    // postback returns it as Reference, and RequestTrace (Netcash's own
    // transaction identifier) only becomes known once that postback arrives.
    await db.payment.update({ where: { id: payment.id }, data: { providerRef: payment.id } });
    await recordHealth(connection.id, true);
    return { payment, checkout };
  } catch (err) {
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureCode: "CHECKOUT_CREATE_FAILED" } });
    await recordHealth(connection.id, false, "CHECKOUT_CREATE_FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Standard debit order fallback for accounts not eligible/enrolled for DebiCheck. */
export async function submitFallbackDebitOrder(organisationId: string, facilityId: string | null, params: {
  accountId: string;
  accountHolderName: string;
  bankAccountNumber: string;
  branchCode: string;
  accountType: "CURRENT" | "SAVINGS" | "TRANSMISSION";
  amount: number;
  actionDate: string;
}) {
  const connection = await getNetcashConnection(organisationId, facilityId);
  const idempotencyKey = `netcash-do-${params.accountId}-${params.actionDate}`;
  const existing = await db.payment.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const payment = await db.payment.create({
    data: { accountId: params.accountId, status: "PENDING", amount: params.amount, method: "DEBIT_ORDER", provider: "NETCASH", idempotencyKey },
  });
  try {
    const result = await submitStandardDebitOrder(connection, {
      reference: payment.id,
      accountHolderName: params.accountHolderName,
      bankAccountNumber: params.bankAccountNumber,
      branchCode: params.branchCode,
      accountType: params.accountType,
      amount: params.amount,
      actionDate: params.actionDate,
    });
    await db.payment.update({ where: { id: payment.id }, data: { providerRef: result.batchReference } });
    await recordHealth(connection.id, true);
    return payment;
  } catch (err) {
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureCode: "DEBIT_ORDER_SUBMIT_FAILED" } });
    await recordHealth(connection.id, false, "DEBIT_ORDER_SUBMIT_FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Pull a Netcash statement for a date range -- for manual/scheduled reconciliation against our own Payment records. */
export async function getNetcashStatementForReconciliation(organisationId: string, facilityId: string | null, fromDate: string, toDate: string) {
  const connection = await getNetcashConnection(organisationId, facilityId);
  return fetchNetcashStatement(connection, { fromDate, toDate });
}
