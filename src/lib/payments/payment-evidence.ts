type Evidence = { status: string; idempotencyKey: string; environment?: string | null; provider?: string | null };

export function isTestPayment(payment: Evidence) {
  return payment.environment === "sandbox" || payment.status.startsWith("TEST_") || /test|simulat|sandbox/i.test(payment.idempotencyKey);
}

export function isFinancialReceipt(payment: Evidence) {
  return payment.status === "SUCCEEDED" && !isTestPayment(payment);
}
