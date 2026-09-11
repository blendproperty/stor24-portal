/**
 * Inbound Netcash Pay Now Notify endpoint.
 *
 * Confirmed against https://api.netcash.co.za/inbound-payments/pay-now/pay-now-ecommerce/
 * 4 September 2026: this postback is application/x-www-form-urlencoded, not
 * JSON, and Netcash's docs do not define any signature/hash scheme for it --
 * so the posted body (TransactionAccepted included) is never trusted
 * directly. Instead this handler re-verifies every delivery server-to-server
 * via checkPayNowTransactionStatus(RequestTrace) -- see the doc comment on
 * that function in netcash-client.ts -- and only that response is allowed to
 * mutate Payment/LedgerEntry state. A forged POST to this URL can create a
 * WebhookInbox row but cannot mark a payment succeeded, because RequestTrace
 * is Netcash's own transaction identifier and forging one that also passes
 * Netcash's status-check as accepted would require actually having paid.
 *
 * Every callback with a recognised tenant-owned Payment is first persisted to
 * WebhookInbox, then processed idempotently by externalEventId (RequestTrace).
 * Unattributable callbacks are acknowledged without inventing a tenant id.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueueMriExport } from "@/lib/finance/mri-export";
import { checkPayNowTransactionStatus } from "@/lib/payments/netcash-client";
import { settleVerifiedMerchandisePayment } from "@/lib/merchandise-order-settlement";

export async function POST(request: Request) {
  const rawBody = await request.text();
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const payload = Object.fromEntries(form.entries());
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const providerRef = payload.Reference || undefined; // the p2 we sent = payment.id
  const requestTrace = payload.RequestTrace || undefined;
  const externalEventId = requestTrace ?? providerRef ?? `netcash-${Date.now()}`;

  const payment = providerRef
    ? await db.payment.findFirst({ where: { provider: "NETCASH", providerRef } })
    : null;

  // WebhookInbox is tenant-owned. If the reference cannot be resolved we
  // deliberately do not invent an organisation id (which would violate the
  // foreign key and turn a harmless malformed callback into a 500).
  if (!payment) {
    return NextResponse.json({ received: true, matched: false }, { status: 202 });
  }

  const account = await db.account.findUnique({
    where: { id: payment.accountId },
    include: { customer: { select: { organisationId: true } } },
  });
  if (!account) {
    return NextResponse.json({ received: true, matched: false }, { status: 202 });
  }

  const merchandiseOrder = await db.merchandiseOrder.findUnique({ where: { paymentId: payment.id }, select: { id: true } });
  let inbox = await db.webhookInbox.create({
    data: {
      organisationId: account.customer.organisationId,
      provider: "NETCASH",
      eventType: "PAY_NOW_NOTIFY",
      externalEventId,
      payload: payload as object,
      headers: Object.fromEntries(request.headers.entries()),
      status: "PENDING",
    },
  }).catch((err) => {
    // Unique constraint on (organisationId, provider, externalEventId) -- duplicate delivery, that's fine.
    if (err instanceof Error && err.message.includes("Unique constraint")) return null;
    throw err;
  });

  // A repeated Netcash delivery is already represented by the original inbox
  // row and must not post the payment or ledger a second time.
  if (!inbox) {
    // Failed merchandise verification/settlement can be retried; order locks and
    // unique ledger references prevent double posting on concurrent deliveries.
    if (merchandiseOrder) inbox = await db.webhookInbox.findFirst({ where: { organisationId: account.customer.organisationId, provider: "NETCASH", externalEventId, status: { in: ["PENDING", "FAILED"] } } });
    if (!inbox) return NextResponse.json({ received: true, matched: true, duplicate: true });
  }

  if (!requestTrace) {
    // Nothing to reconcile against yet, or Netcash sent no RequestTrace to
    // verify against -- leave the inbox row PENDING for manual triage.
    return NextResponse.json({ received: true, matched: false });
  }

  let verified: Awaited<ReturnType<typeof checkPayNowTransactionStatus>>;
  try {
    verified = await checkPayNowTransactionStatus(requestTrace);
  } catch (err) {
    // Verification call itself failed (Netcash unreachable, etc). Leave the
    // inbox row PENDING rather than guessing -- do NOT fall back to trusting
    // the unsigned postback body.
    if (inbox) {
      await db.webhookInbox.update({
        where: { id: inbox.id },
        data: { status: "FAILED", failureMessage: err instanceof Error ? err.message.slice(0, 500) : String(err) },
      }).catch(() => undefined);
    }
    return NextResponse.json({ received: true, matched: true, verified: false });
  }

  const amountMatches = verified.amount !== undefined && Number(verified.amount) === Number(payment.amount);
  if (verified.reference !== providerRef || !amountMatches) {
    await db.webhookInbox.update({
      where: { id: inbox.id },
      data: {
        status: "FAILED",
        failureCode: "NETCASH_VERIFICATION_MISMATCH",
        failureMessage: "The verified Netcash reference or amount did not match the pending Stor24 payment.",
      },
    });
    return NextResponse.json({ received: true, matched: true, verified: false });
  }

  if (merchandiseOrder) {
    try {
      // Pay Now's documented p4 contract is ZAR-only; its status response has
      // no currency field. Both stored order and Payment must also be ZAR.
      // https://api.netcash.co.za/inbound-payments/pay-now/pay-now-ecommerce/
      await settleVerifiedMerchandisePayment(payment.id, { verified: true, reference: verified.reference!, amount: String(verified.amount), currency: "ZAR", accepted: verified.accepted });
      await db.webhookInbox.update({ where: { id: inbox.id }, data: { status: "SUCCEEDED", processedAt: new Date() } });
      if (verified.accepted) await enqueueMriExport(payment.id).catch(() => undefined);
      return NextResponse.json({ received: true, matched: true, verified: true, accepted: verified.accepted });
    } catch {
      await db.webhookInbox.update({ where: { id: inbox.id }, data: { status: "FAILED", failureCode: "MERCHANDISE_SETTLEMENT_REVIEW", failureMessage: "Verified payment could not be settled against its merchandise order. Retry/reconciliation required." } });
      return NextResponse.json({ received: true, matched: true, verified: true, settled: false }, { status: 503 });
    }
  }

  if (verified.accepted) {
    await db.$transaction(async (tx) => {
      const transitioned = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: "SUCCEEDED" } },
        // Keep providerRef as the p2/reference sent to Netcash. RequestTrace is
        // Netcash's transaction id and is stored on the ledger/inbox instead.
        data: { status: "SUCCEEDED", processedAt: new Date(), failureCode: null },
      });
      if (!transitioned.count) return;
      await tx.ledgerEntry.create({
        data: {
          accountId: payment.accountId,
          type: "PAYMENT",
          amount: payment.amount,
          description: `Netcash payment received (${payment.method})`,
          effectiveAt: new Date(),
          externalRef: requestTrace,
          metadata: { provider: "NETCASH", paymentId: payment.id, requestTrace, verifiedStatus: verified.raw, postedPayload: payload },
        },
      });
      await tx.account.update({ where: { id: payment.accountId }, data: { balance: { decrement: payment.amount } } });
    });
    await enqueueMriExport(payment.id).catch(() => undefined); // MRI export is best-effort, not payment-blocking
  } else {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureCode: verified.reason?.slice(0, 120) || "NETCASH_TRANSACTION_NOT_ACCEPTED" },
    });
  }

  if (inbox) {
    await db.webhookInbox.update({ where: { id: inbox.id }, data: { status: "SUCCEEDED", processedAt: new Date() } });
  }

  return NextResponse.json({ received: true, matched: true, verified: true, accepted: verified.accepted });
}
