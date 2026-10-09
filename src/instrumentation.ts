export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { expiryWorkerEnabled, startExpiryWorker } = await import("./lib/merchandise-expiry-worker");
  if (!expiryWorkerEnabled()) return;
  const { expireMerchandiseBatch } = await import("./lib/merchandise-order-settlement");
  startExpiryWorker(expireMerchandiseBatch);
}
