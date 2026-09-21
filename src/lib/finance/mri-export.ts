/**
 * MRI Property Central export -- GENERIC SCAFFOLD ONLY.
 *
 * API access was provisioned in September 2026. The agreed model is
 * consolidated journals, not per-payment export. Authentication, journal
 * contract, finance mappings and provider reconciliation remain unresolved.
 * These legacy markers MUST NOT be replayed as journals or treated as
 * approved financial source evidence. See docs/MRI_INTEGRATION.md.
 * This module intentionally does NOT call any MRI API.
 *
 * `destination` is left as a placeholder finance-export marker
 * ("mri://pending-integration-decision") rather than a real URL -- update
 * once MRI's actual import mechanism is confirmed.
 */
import { isFinancialReceipt } from "@/lib/payments/payment-evidence";
import { db } from "@/lib/db";

export async function enqueueMriExport(paymentId: string) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { account: { include: { customer: true, tenancy: { include: { facility: true } } } } },
  });
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  if (!isFinancialReceipt(payment)) throw new Error("PAYMENT_NOT_FINANCIAL");

  const organisationId = payment.account.customer.organisationId;
  const facilityId = payment.account.tenancy?.facilityId ?? null;

  const exportRecord = {
    // Best-effort generic shape -- rename/reshape once MRI's actual import
    // schema (API payload or CSV column headers) is confirmed.
    paymentId: payment.id,
    accountNumber: payment.accountId,
    customerName: [payment.account.customer.firstName, payment.account.customer.lastName].filter(Boolean).join(" ")
      || payment.account.customer.companyName
      || "UNKNOWN",
    facilityCode: payment.account.tenancy?.facility.code ?? null,
    amount: payment.amount.toString(),
    currency: payment.currency,
    paidAt: payment.processedAt?.toISOString() ?? new Date().toISOString(),
    provider: payment.provider,
    providerRef: payment.providerRef,
  };

  await db.webhookOutbox.create({
    data: {
      organisationId,
      facilityId,
      eventType: "PAYMENT_SUCCEEDED",
      aggregateType: "Payment",
      aggregateId: payment.id,
      destination: "mri://pending-integration-decision",
      payload: exportRecord,
      idempotencyKey: `mri-export-${payment.id}`,
      status: "PENDING",
    },
  }).catch((err) => {
    // Idempotency key collision -- already queued, fine.
    if (err instanceof Error && err.message.includes("Unique constraint")) return;
    throw err;
  });
}
