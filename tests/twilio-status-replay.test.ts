import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
test("signed delivery callbacks process each event once and preserve retry after rollback", async () => {
  const saved = { token: process.env.TWILIO_AUTH_TOKEN, url: process.env.APP_URL };
  process.env.TWILIO_AUTH_TOKEN = "synthetic-token"; process.env.APP_URL = "https://example.invalid";
  let inbox: Row[] = [], tasks: Row[] = [], updates = 0, failTask = false;
  let log: Row = { id: "log", organisationId: "org", facilityId: "facility", customerId: "customer", provider: "twilio", providerRef: "SMsynthetic", attempts: 1, status: "PROCESSING" };
  const db: Row = {
    communicationLog: {
      findFirst: async ({ where }: Row) => where.providerRef === log.providerRef ? { ...log } : null,
      findUniqueOrThrow: async () => ({ ...log }),
      update: async ({ data }: Row) => { updates++; Object.assign(log, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))); return { ...log }; },
    },
    webhookInbox: {
      upsert: async ({ create }: Row) => { const row = inbox.find(r => r.externalEventId === create.externalEventId); if (row) return row; inbox.push(create); return create; },
      create: async ({ data }: Row) => { if (inbox.some(r => r.externalEventId === data.externalEventId)) throw Object.assign(new Error("Synthetic duplicate"), { code: "P2002" }); inbox.push(data); return data; },
      findUnique: async ({ where }: Row) => inbox.find(r => r.externalEventId === where.organisationId_provider_externalEventId.externalEventId) ?? null,
    },
    task: { create: async ({ data }: Row) => { if (failTask) throw new Error("SYNTHETIC_TASK_FAILURE"); tasks.push(data); return data; } },
    $queryRaw: async () => [{ id: log.id }],
  };
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => {
    const before = { inbox: [...inbox], tasks: [...tasks], log: { ...log }, updates };
    try { return await fn(db); } catch (error) { inbox = before.inbox; tasks = before.tasks; log = before.log; updates = before.updates; throw error; }
  };
  try {
    const output = await build({ entryPoints: ["src/app/api/webhooks/twilio/status/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-db", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const db=__db;" }));
    } }] });
    const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
    new Function("require", "module", "exports", "__db", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db);
    const request = (status = "failed", valid = true, sid = "SMsynthetic", eventType?: string) => {
      const fields: Record<string, string> = { MessageSid: sid, MessageStatus: status, ...(eventType ? { EventType: eventType } : {}) };
      const url = "https://example.invalid/api/webhooks/twilio/status";
      const source = url + Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + v).join("");
      const signature = createHmac("sha1", "synthetic-token").update(source).digest("base64");
      return new Request(url, { method: "POST", headers: { "x-twilio-signature": valid ? signature : "invalid" }, body: new URLSearchParams(fields) });
    };
    assert.equal((await loaded.exports.POST(request("failed", false))).status, 403);
    assert.equal((await loaded.exports.POST(request("failed", true, "unknown"))).status, 204);
    assert.equal(inbox.length, 0); assert.equal(tasks.length, 0);
    assert.equal((await loaded.exports.POST(request())).status, 204);
    const firstFailure = log.failedAt, firstRetry = log.nextRetryAt;
    assert.equal((await loaded.exports.POST(request())).status, 204);
    assert.equal(tasks.length, 1); assert.equal(inbox.length, 1); assert.equal(updates, 1);
    assert.equal(log.failedAt, firstFailure); assert.equal(log.nextRetryAt, firstRetry);
    assert.equal((await loaded.exports.POST(request("undelivered"))).status, 204);
    assert.equal(tasks.length, 1); assert.equal(updates, 1);
    assert.equal((await loaded.exports.POST(request("sent"))).status, 204);
    assert.equal(log.status, "FAILED"); assert.equal(log.failedAt, firstFailure);
    // A new message exercises rollback without relying on a repeated failure.
    log = { ...log, id: "recovery", providerRef: "SMrecovery", status: "PROCESSING", failedAt: null, nextRetryAt: null };
    failTask = true;
    await assert.rejects(loaded.exports.POST(request("failed", true, "SMrecovery")), /SYNTHETIC_TASK_FAILURE/);
    assert.equal(inbox.length, 3); assert.equal(updates, 1);
    failTask = false;
    assert.equal((await loaded.exports.POST(request("failed", true, "SMrecovery"))).status, 204);
    assert.equal(inbox.length, 4); assert.equal(tasks.length, 2);
    assert.equal((await loaded.exports.POST(request("delivered", true, "SMrecovery"))).status, 204);
    assert.equal(log.status, "SUCCEEDED");
    const deliveredAt = log.deliveredAt, sentAt = log.sentAt;
    for (const status of ["queued", "sent", "unknown", "undelivered", "read"]) assert.equal((await loaded.exports.POST(request(status, true, "SMrecovery"))).status, 204);
    assert.equal(log.status, "SUCCEEDED");
    assert.equal(log.failedAt, null); assert.equal(log.nextRetryAt, null); assert.equal(log.failureCode, null);
    assert.equal(log.deliveredAt, deliveredAt); assert.equal(log.sentAt, sentAt); assert.ok(log.readAt);
    assert.equal(tasks.length, 2);
    log = { ...log, id: "read-first", providerRef: "SMread", status: "PROCESSING", readAt: null, sentAt: null, deliveredAt: null };
    await loaded.exports.POST(request("unknown", true, "SMread"));
    assert.equal(log.status, "PROCESSING"); assert.equal(log.sentAt, null);
    await loaded.exports.POST(request("delivered", true, "SMread", "READ"));
    const readAt = log.readAt;
    assert.ok(readAt);
    await loaded.exports.POST(request("delivered", true, "SMread"));
    await loaded.exports.POST(request("failed", true, "SMread"));
    assert.equal(log.readAt, readAt); assert.equal(log.status, "SUCCEEDED"); assert.equal(tasks.length, 2);
  } finally {
    if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = saved.token;
    if (saved.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved.url;
  }
});
