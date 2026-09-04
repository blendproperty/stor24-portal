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
 * Every inbound call is first persisted to WebhookInbox verbatim (so nothing
 * is ever lost even if processing throws), then processed idempotently by
 * externalEventId (RequestTrace).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueueMriExport } from "@/lib/finance/mri-export";
import { checkPayNowTransactionStatus } from "@/lib/payments/netcash-client";

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

  // Resolve the owning organisation for the WebhookInbox row: walk
  // Payment -> Account -> Customer -> Organisation when we have a match.
  // Unmatched callbacks (no providerRef, or providerRef we don't recognise)
  // get organisationId "UNKNOWN" and are left for manual triage -- we'd
  // rather record an unattributed webhook than silently drop it.
  let organisationId = "UNKNOWN";
  if (payment) {
    const account = await db.account.findUnique({
      where: { id: payment.accountId },
      include: { customer: { select: { organisationId: true } } },
    });
    organisationId = account?.customer.organisationId ?? "UNKNOWN";
  }

  const inbox = await db.webhookInbox.create({
    data: {
      organisationId,
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

  if (!payment || !requestTrace) {
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

  if (verified.accepted) {
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", processedAt: new Date(), providerRef: requestTrace } });
      await tx.ledgerEntry.create({
        data: {
          accountId: payment.accountId,
          type: "PAYMENT",
          amount: payment.amount,
          description: `Netcash payment received (${payment.method})`,
          effectiveAt: new Date(),
          externalRef: requestTrace,
          metadata: { provider: "NETCASH", verifiedStatus: verified.raw, postedPayload: payload },
        },
      });
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
