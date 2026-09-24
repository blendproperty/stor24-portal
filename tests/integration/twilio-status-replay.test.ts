import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import type { Prisma } from "../../src/generated/prisma/client";

test("isolated PostgreSQL callback replay and rollback", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const saved = { token: process.env.TWILIO_AUTH_TOKEN, url: process.env.APP_URL };
  process.env.TWILIO_AUTH_TOKEN = "synthetic-token"; process.env.APP_URL = "https://example.invalid";
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Callback CI", slug: key } });
  const log = await db.communicationLog.create({ data: { organisationId: org.id, channel: "WHATSAPP", provider: "twilio", providerRef: key, recipientHash: "synthetic", idempotencyKey: key, status: "PROCESSING" } });
  const output = await build({ entryPoints: ["src/app/api/webhooks/twilio/status/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "real-db", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const db=__db;" }));
  } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db);
  const request = (status = "failed", sid = key) => {
    const fields = { MessageSid: sid, MessageStatus: status };
    const url = "https://example.invalid/api/webhooks/twilio/status";
    const signature = createHmac("sha1", "synthetic-token").update(url + Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + v).join("")).digest("base64");
    return new Request(url, { method: "POST", headers: { "x-twilio-signature": signature }, body: new URLSearchParams(fields) });
  };
  try {
    const results = await Promise.all([loaded.exports.POST(request()), loaded.exports.POST(request()), loaded.exports.POST(request())]);
    assert.ok(results.every(response => response.status === 204));
    assert.equal(await db.webhookInbox.count({ where: { organisationId: org.id } }), 1);
    assert.equal(await db.task.count({ where: { organisationId: org.id } }), 1);
    const first = await db.communicationLog.findUniqueOrThrow({ where: { id: log.id } });
    assert.equal((await loaded.exports.POST(request())).status, 204);
    const repeat = await db.communicationLog.findUniqueOrThrow({ where: { id: log.id } });
    assert.equal(repeat.failedAt?.toISOString(), first.failedAt?.toISOString());
    assert.equal(repeat.nextRetryAt?.toISOString(), first.nextRetryAt?.toISOString());
    await loaded.exports.POST(request("undelivered"));
    await loaded.exports.POST(request("sent"));
    assert.equal(await db.task.count({ where: { organisationId: org.id } }), 1);
    assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { id: log.id } })).status, "FAILED");
    const recoveryKey = randomUUID();
    const recoveryLog = await db.communicationLog.create({ data: { organisationId: org.id, channel: "WHATSAPP", provider: "twilio", providerRef: recoveryKey, recipientHash: "synthetic", idempotencyKey: recoveryKey, status: "PROCESSING" } });
    const original = db.$transaction, transaction = db.$transaction.bind(db);
    db.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => callback(new Proxy(tx, { get(target, property) {
      if (property === "task") return { ...target.task, create: async () => { throw new Error("SYNTHETIC_TASK_FAILURE"); } };
      return Reflect.get(target, property);
    } })))) as typeof db.$transaction;
    try { await assert.rejects(loaded.exports.POST(request("failed", recoveryKey)), /SYNTHETIC_TASK_FAILURE/); }
    finally { db.$transaction = original; }
    assert.equal(await db.webhookInbox.count({ where: { organisationId: org.id } }), 3);
    assert.equal(await db.task.count({ where: { organisationId: org.id } }), 1);
    assert.equal((await loaded.exports.POST(request("failed", recoveryKey))).status, 204);
    assert.equal(await db.webhookInbox.count({ where: { organisationId: org.id } }), 4);
    assert.equal(await db.task.count({ where: { organisationId: org.id } }), 2);
    const mixed = await Promise.all(["delivered", "queued", "read", "sent", "undelivered", "unknown"].map(status => loaded.exports.POST(request(status, recoveryKey))));
    assert.ok(mixed.every(response => response.status === 204));
    const delivered = await db.communicationLog.findUniqueOrThrow({ where: { id: recoveryLog.id } });
    assert.equal(delivered.status, "SUCCEEDED"); assert.ok(delivered.readAt); assert.ok(delivered.deliveredAt); assert.ok(delivered.sentAt);
    assert.equal(delivered.failedAt, null); assert.equal(delivered.failureCode, null); assert.equal(delivered.nextRetryAt, null);
    assert.equal(await db.task.count({ where: { organisationId: org.id } }), 2);
    assert.equal(await db.webhookInbox.count({ where: { organisationId: org.id } }), 10);
    const smsKey = randomUUID();
    const sms = await db.communicationLog.create({ data: { organisationId: org.id, channel: "SMS", provider: "twilio", providerRef: smsKey, recipientHash: "synthetic", idempotencyKey: smsKey, status: "SUCCEEDED", sentAt: new Date() } });
    await loaded.exports.POST(request("failed", smsKey));
    assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { id: sms.id } })).status, "FAILED");
    assert.equal(await db.task.count({ where: { organisationId: org.id, title: "SMS delivery failed" } }), 1);
    await loaded.exports.POST(request("delivered", smsKey));
    await loaded.exports.POST(request("undelivered", smsKey));
    const smsDelivered = await db.communicationLog.findUniqueOrThrow({ where: { id: sms.id } });
    assert.equal(smsDelivered.status, "SUCCEEDED"); assert.ok(smsDelivered.deliveredAt); assert.equal(smsDelivered.failedAt, null);
    assert.equal(await db.task.count({ where: { organisationId: org.id, title: "SMS delivery failed" } }), 1);
  } finally {
    if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = saved.token;
    if (saved.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved.url;
    await db.$disconnect();
  }
});
