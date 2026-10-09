/** Process-local scheduler state. No credentials, customer details or provider calls. */
export type Cursor = { id: string; expiresAt: Date };
type Batch = { expired: number; failures: number; scanned: number; cursor?: Cursor };
export function createExpiryWorker(batch: (now: Date, cursor?: Cursor) => Promise<Batch>, clock = Date.now) {
  let running = false;
  let lastCompleted: number | undefined;
  let failed = false;
  let sweepFailures = false;
  let cursor: Cursor | undefined;
  let sweepStarted: number | undefined;
  async function tick() {
    if (running) return;
    running = true;
    sweepStarted ??= clock();
    try {
      // At most 500 candidates per tick. Carry the keyset cursor across ticks so
      // inconsistent old rows cannot starve later orders, even beyond one batch.
      for (let i = 0; i < 5; i++) {
        const result = await batch(new Date(clock()), cursor);
        sweepFailures ||= result.failures > 0;
        if (result.failures) failed = true;
        cursor = result.cursor;
        if (result.scanned < 100) {
          failed = sweepFailures;
          sweepFailures = false;
          cursor = undefined;
          sweepStarted = undefined;
          break;
        }
      }
      lastCompleted = clock();
    } catch {
      failed = true;
      console.error("Merchandise expiry worker failed; review required");
    } finally { running = false; }
  }
  function status() {
    const now = clock();
    const stale = lastCompleted === undefined || now - lastCompleted > 5 * 60_000;
    const backlogStale = sweepStarted !== undefined && now - sweepStarted > 5 * 60_000;
    return { status: failed || stale || backlogStale ? "degraded" : "ok", running, stale, backlogStale, failed };
  }
  return { tick, status };
}

type Worker = ReturnType<typeof createExpiryWorker>;
const state = globalThis as typeof globalThis & { stor24Expiry?: Worker; stor24ExpiryTimer?: ReturnType<typeof setInterval> };
export function expiryWorkerEnabled() { return process.env.MERCHANDISE_APP_WORKER_ENABLED === "true"; }
export function expiryWorkerHealth() {
  if (!expiryWorkerEnabled()) return { enabled: false, status: "disabled" };
  return { enabled: true, ...(state.stor24Expiry?.status() ?? { status: "degraded", stale: true }) };
}
export function startExpiryWorker(batch: (now: Date, cursor?: Cursor) => Promise<Batch>) {
  if (!expiryWorkerEnabled() || state.stor24ExpiryTimer) return;
  const worker = state.stor24Expiry = createExpiryWorker(batch);
  // Startup is nonblocking. Only explicitly enabled runtime instances mutate.
  state.stor24ExpiryTimer = setInterval(() => { void worker.tick(); }, 60_000);
  state.stor24ExpiryTimer.unref();
  void worker.tick();
}
