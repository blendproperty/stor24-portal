import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
test("isolated PostgreSQL WhatsApp attempt and manual-retry claims", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Message claim CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: "test", name: "Synthetic facility" } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", phone: "+27820000000", communicationConsent: { whatsapp: true }, leads: { create: { facilityId: facility.id, source: "CI" } } } });
  const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "Synthetic staff", passwordHash: "synthetic" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Message operator", permissions: ["operations.manage"] } });
  await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: facility.id } });
  let sends = 0, reject = false;
  const provider = async () => { sends++; return reject ? { ok: false, retryable: true, code: "NETWORK_ERROR", message: "Synthetic timeout" } : { ok: true, providerReference: `SMsynthetic-${sends}` }; };
  const output = await build({ stdin: { contents: 'export { sendWhatsAppTemplate } from "./src/lib/whatsapp"; export { POST } from "./src/app/api/v1/communications/retry-whatsapp/route";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-provider", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|session|integrations\/twilio-provider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : args.path.endsWith("/session") ? "export const getSession=async()=>__session;" : "export class TwilioWhatsAppProvider {sendTemplate(...args) {return __provider(...args);}}" }));
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__db", "__session", "__provider", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: user.id, sessionVersion: user.sessionVersion }, provider);
  const input = { organisationId: org.id, facilityId: facility.id, customerId: customer.id, recipient: customer.phone, consent: customer.communicationConsent, messageType: "PAYMENT_REMINDER", variables: { "1": "Synthetic" }, idempotencyKey: key, allowWhenAutomationDisabled: true };
  const retry = (logId: string) => loaded.exports.POST(new Request("https://example.invalid/api/v1/communications/retry-whatsapp", { method: "POST", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify({ logId }) }));
  const envKey = "TWILIO_WHATSAPP_PAYMENT_REMINDER_SID", previous = process.env[envKey]; process.env[envKey] = "HXsynthetic";
  try {
    const results = await Promise.all([1, 2, 3].map(() => loaded.exports.sendWhatsAppTemplate(input)));
    assert.ok(results.some(result => result.ok)); assert.equal(sends, 1);
    assert.equal(await db.communicationLog.count({ where: { idempotencyKey: key } }), 1);
    assert.equal((await loaded.exports.sendWhatsAppTemplate(input)).code, "DUPLICATE"); assert.equal(sends, 1);
    assert.equal((await loaded.exports.sendWhatsAppTemplate({ ...input, customerId: "foreign" })).code, "IDEMPOTENCY_CONFLICT");

    const failed = await db.communicationLog.create({ data: { organisationId: org.id, facilityId: facility.id, customerId: customer.id, channel: "WHATSAPP", messageType: "PAYMENT_REMINDER", recipientHash: "synthetic", idempotencyKey: randomUUID(), status: "FAILED", providerRef: "SMfailed", failedAt: new Date(), failureCode: "DELIVERY_FAILED", metadata: { variables: { "1": "Synthetic" } } } });
    const retries = await Promise.all([retry(failed.id), retry(failed.id), retry(failed.id)]);
    assert.ok(retries.every(response => [202, 409].includes(response.status))); assert.equal(sends, 2);
    assert.equal(await db.communicationLog.count({ where: { idempotencyKey: `whatsapp-retry:${failed.id}` } }), 1);
    assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { id: failed.id } })).attempts, 2);
    assert.equal((await retry(failed.id)).status, 202); assert.equal(sends, 2);
    assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { id: failed.id } })).attempts, 2);

    reject = true;
    const uncertainKey = randomUUID();
    const uncertain = await loaded.exports.sendWhatsAppTemplate({ ...input, idempotencyKey: uncertainKey });
    assert.equal(uncertain.code, "DELIVERY_REVIEW_REQUIRED"); assert.equal(sends, 3);
    assert.equal((await loaded.exports.sendWhatsAppTemplate({ ...input, idempotencyKey: uncertainKey })).code, "DELIVERY_REVIEW_REQUIRED");
    assert.equal((await retry(uncertain.logId)).status, 409); assert.equal(sends, 3);
    const uncertainLog = await db.communicationLog.findUniqueOrThrow({ where: { id: uncertain.logId } });
    assert.equal(uncertainLog.nextRetryAt, null); assert.equal(uncertainLog.attempts, 1);
  } finally {
    if (previous === undefined) delete process.env[envKey]; else process.env[envKey] = previous;
    await db.$disconnect();
  }
});
