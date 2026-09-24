import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { canRetryWhatsAppDelivery } from "../src/lib/whatsapp";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
test("manual retry requires a confirmed failure and preserves uncertain/legacy delivery review", () => {
  const log = { status: "FAILED", providerRef: "SMsynthetic", failureCode: "DELIVERY_FAILED", failedAt: new Date(), metadata: {} };
  assert.equal(canRetryWhatsAppDelivery(log), true);
  for (const change of [{ status: "PROCESSING" }, { failureCode: "NETWORK_ERROR" }, { failureCode: "DELIVERY_REVIEW_REQUIRED" }, { deliveredAt: new Date() }, { readAt: new Date() }, { metadata: { deliveryOutcome: "UNCERTAIN" } }, { providerRef: null, failureCode: null }]) assert.equal(canRetryWhatsAppDelivery({ ...log, ...change }), false);
  assert.equal(canRetryWhatsAppDelivery({ ...log, providerRef: null, failureCode: "CONFIG_REQUIRED" }), true);
  assert.equal(canRetryWhatsAppDelivery({ ...log, providerRef: null, metadata: { deliveryOutcome: "REJECTED" } }), true);
});
async function fixture() {
  const rows: Row[] = [];
  const state = { rows, sends: 0, failFinalize: false, throwProvider: false, result: { ok: true, providerReference: "SMsynthetic" } as Row };
  const db = { communicationLog: {
    findUnique: async ({ where }: Row) => rows.find(row => row.idempotencyKey === where.idempotencyKey) ?? null,
    create: async ({ data }: Row) => {
      if (rows.some(row => row.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
      const row = { id: `log-${rows.length}`, ...data }; rows.push(row); return row;
    },
    update: async ({ where, data }: Row) => {
      if (state.failFinalize) throw new Error("SYNTHETIC_PERSISTENCE_FAILURE");
      const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return row;
    },
  } };
  const provider = async () => { state.sends++; if (state.throwProvider) throw new Error("SYNTHETIC_NETWORK_FAILURE"); return state.result; };
  const output = await build({ entryPoints: ["src/lib/whatsapp.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-provider", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|integrations\/twilio-provider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export class TwilioWhatsAppProvider {sendTemplate(...args) {return __provider(...args);}}" }));
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__db", "__provider", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, provider);
  const input = { organisationId: "org", facilityId: "facility", customerId: "customer", recipient: "+27820000000", consent: { whatsapp: true }, messageType: "PAYMENT_REMINDER", variables: { "1": "Synthetic", "2": "100" }, idempotencyKey: "synthetic-attempt", allowWhenAutomationDisabled: true };
  return { state, input, send: (change: Row = {}) => loaded.exports.sendWhatsAppTemplate({ ...input, ...change }) };
}

test("WhatsApp claims a single attempt before sending and preserves confirmed repeats", async () => {
  const envKey = "TWILIO_WHATSAPP_PAYMENT_REMINDER_SID", previous = process.env[envKey]; process.env[envKey] = "HXsynthetic";
  try {
    const { state, send } = await fixture();
    const results = await Promise.all([send(), send(), send()]);
    assert.equal(state.sends, 1); assert.equal(state.rows.length, 1); assert.ok(results.some(result => result.ok));
    const repeated = await send({ variables: { "2": "100", "1": "Synthetic" } });
    assert.equal(repeated.ok, true); assert.equal(repeated.code, "DUPLICATE"); assert.equal(state.sends, 1);
    for (const change of [{ organisationId: "other" }, { customerId: "other" }, { facilityId: "other" }, { recipient: "+27821111111" }, { variables: { "1": "Changed" } }]) {
      const conflict = await send(change); assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT"); assert.equal(conflict.logId, undefined);
    }
    assert.equal(state.sends, 1);
  } finally { if (previous === undefined) delete process.env[envKey]; else process.env[envKey] = previous; }
});

test("uncertain, failed and unfinished WhatsApp attempts cannot silently resend", async () => {
  const envKey = "TWILIO_WHATSAPP_PAYMENT_REMINDER_SID", previous = process.env[envKey]; process.env[envKey] = "HXsynthetic";
  try {
    for (const mode of ["network", "throw", "persistence", "rejected", "missing-reference"]) {
      const { state, send } = await fixture();
      if (mode === "network") state.result = { ok: false, retryable: true, code: "NETWORK_ERROR", message: "Synthetic timeout" };
      if (mode === "rejected") state.result = { ok: false, retryable: false, code: "INVALID_RECIPIENT", message: "Synthetic invalid number" };
      if (mode === "missing-reference") state.result = { ok: true, providerReference: "" };
      state.throwProvider = mode === "throw"; state.failFinalize = mode === "persistence";
      assert.equal((await send()).ok, false, mode);
      assert.equal((await send()).code, "DELIVERY_REVIEW_REQUIRED", mode);
      assert.equal(state.sends, 1, mode);
      assert.equal(state.rows[0].nextRetryAt ?? null, null);
    }
    const { state, send } = await fixture();
    assert.equal((await send({ consent: { whatsapp: false } })).code, "CONSENT_REQUIRED");
    assert.equal(state.rows.length, 0); assert.equal(state.sends, 0);
  } finally { if (previous === undefined) delete process.env[envKey]; else process.env[envKey] = previous; }
});
