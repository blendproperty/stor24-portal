import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "./build-commonjs";
import { db } from "../../src/lib/db";
import { POST as inbound } from "../../src/app/api/webhooks/twilio/inbound/route";
import { privacyHash } from "../../src/lib/request-security";
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
    for (const channel of ["SMS", "WHATSAPP"]) {
      const reviewedKey = randomUUID();
      const reviewed = await db.communicationLog.create({ data: { organisationId: org.id, channel, messageType: "COLLECTION_REMINDER", provider: "twilio", providerRef: reviewedKey, recipientHash: "synthetic", idempotencyKey: reviewedKey, status: "PROCESSING", attempts: 1, metadata: { noticeId: "collection-phone:reviewed", deliveryOutcome: "ACCEPTED" } } });
      await loaded.exports.POST(request("failed", reviewedKey));
      const failed = await db.communicationLog.findUniqueOrThrow({ where: { id: reviewed.id } });
      assert.equal(failed.status, "FAILED"); assert.equal(failed.nextRetryAt, null); assert.ok(failed.failedAt);
    }
  } finally {
    if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = saved.token;
    if (saved.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved.url;
    await db.$disconnect();
  }
});

test("signed inbound WhatsApp retries preserve consent and one staff task", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const saved = { token: process.env.TWILIO_AUTH_TOKEN, url: process.env.APP_URL };
  const url = "https://example.invalid/api/webhooks/twilio/inbound";
  const key = randomUUID();
  const phone = "+27710000071";
  const consent = { whatsapp: true, email: true };
  process.env.TWILIO_AUTH_TOKEN = "synthetic-inbound-token";
  process.env.APP_URL = "https://example.invalid";
  const org = await db.organisation.create({ data: { name: "Inbound fixture", slug: key } });
  const customer = await db.customer.create({ data: { organisationId: org.id, communicationConsent: consent } });
  await db.communicationLog.create({ data: { organisationId: org.id, customerId: customer.id, channel: "WHATSAPP",
    direction: "OUTBOUND", provider: "twilio", recipientHash: privacyHash(phone), idempotencyKey: key } });
  function request() {
    const fields = { Body: " STOP ", From: `whatsapp:${phone}`, MessageSid: key };
    const signature = createHmac("sha1", "synthetic-inbound-token")
      .update(url + Object.entries(fields).map(([name, value]) => name + value).join("")).digest("base64");
    return new Request(url, { method: "POST", headers: { "x-twilio-signature": signature }, body: new URLSearchParams(fields) });
  }
  const counts = async () => Promise.all([
    db.webhookInbox.count({ where: { organisationId: org.id } }),
    db.communicationLog.count({ where: { organisationId: org.id, direction: "INBOUND" } }),
    db.task.count({ where: { organisationId: org.id } }),
  ]);
  const readConsent = async () => (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).communicationConsent;
  try {
    const original = db.$transaction, transaction = db.$transaction.bind(db);
    db.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => callback(new Proxy(tx, {
      get(target, property) {
        if (property === "customer") return { ...target.customer, update: async () => { throw Error("SYNTHETIC_CONSENT_FAILURE"); } };
        return Reflect.get(target, property);
      },
    })))) as typeof db.$transaction;
    try { await assert.rejects(inbound(request()), /SYNTHETIC_CONSENT_FAILURE/); }
    finally { db.$transaction = original; }
    assert.deepEqual(await counts(), [0, 0, 0]);
    assert.deepEqual(await readConsent(), consent);
    assert.deepEqual((await Promise.all([inbound(request()), inbound(request()), inbound(request())])).map(r => r.status), [200, 200, 200]);
    assert.deepEqual(await counts(), [1, 1, 1]);
    const optedOut = await readConsent() as { whatsapp: boolean; email: boolean; optedOutAt: string };
    assert.equal(optedOut.whatsapp, false);
    assert.equal(optedOut.email, true);
    assert.ok(optedOut.optedOutAt);
    await db.customer.update({ where: { id: customer.id }, data: { communicationConsent: consent } });
    assert.equal((await inbound(request())).status, 200);
    assert.deepEqual(await readConsent(), consent);
    assert.deepEqual(await counts(), [1, 1, 1]);
  } finally {
    if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = saved.token;
    if (saved.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved.url;
    await db.$disconnect();
  }
});
