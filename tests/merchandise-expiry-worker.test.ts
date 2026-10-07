import assert from "node:assert/strict";
import test from "node:test";
import { createExpiryWorker } from "../src/lib/merchandise-expiry-worker";

test("expiry scheduler detects startup/staleness, failures and recovery without overlap", async () => {
  let now = 1000;
  let calls = 0;
  let release!: () => void;
  let failures = 1;
  const worker = createExpiryWorker(async () => {
    calls++;
    await new Promise<void>(resolve => { release = resolve; });
    return { expired: 0, failures, scanned: 1 };
  }, () => now);
  assert.equal(worker.status().stale, true);
  const first = worker.tick();
  await worker.tick();
  assert.equal(calls, 1);
  release(); await first;
  assert.equal(worker.status().failed, true);
  failures = 0;
  const second = worker.tick(); release(); await second;
  assert.equal(worker.status().status, "ok");
  now += 300001;
  assert.equal(worker.status().stale, true);
});

test("bounded scheduler carries cursor beyond 500 candidates and detects slow backlog", async () => {
  let now = 0;
  const cursors: (string | undefined)[] = [];
  const worker = createExpiryWorker(async (_, cursor) => {
    cursors.push(cursor?.id);
    const n = cursors.length;
    return { expired: 0, failures: n === 1 ? 1 : 0, scanned: n <= 6 ? 100 : 0, cursor: { id: String(n), expiresAt: new Date(0) } };
  }, () => now);
  await worker.tick();
  assert.equal(cursors.length, 5);
  now = 300001;
  assert.equal(worker.status().backlogStale, true);
  await worker.tick();
  assert.equal(cursors[5], "5");
  assert.equal(cursors.length, 7);
  assert.equal(worker.status().failed, true);
  await worker.tick();
  assert.equal(cursors[7], undefined);
  assert.equal(worker.status().status, "ok");
});

test("database failure is degraded and retried", async () => {
  let broken = true;
  const worker = createExpiryWorker(async () => {
    if (broken) throw Error("synthetic failure");
    return { expired: 0, failures: 0, scanned: 0 };
  });
  await worker.tick();
  assert.equal(worker.status().status, "degraded");
  broken = false;
  await worker.tick();
  assert.equal(worker.status().status, "ok");
});
