import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { escapeEmailHtml, stor24ReservationHeldHtml } from "../src/lib/email";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fixture(failure = "none") {
  const logs = new Map<string, Row>(), sends: string[] = [];
  const state = {
    escapeEmailHtml, stor24ReservationHeldHtml,
    db: {
      communicationTemplate: { findFirst: async () => null },
      communicationLog: {
        create: async ({ data }: Row) => { if (failure === "claim") throw new Error("SYNTHETIC_DB_FAILURE"); if (logs.has(data.idempotencyKey)) throw Object.assign(new Error("Duplicate"), { code: "P2002" }); const row = { ...data, id: data.idempotencyKey }; logs.set(data.idempotencyKey, row); return row; },
        findUnique: async ({ where }: Row) => logs.get(where.idempotencyKey),
        update: async ({ where, data }: Row) => { if (failure === "finalize") throw new Error("SYNTHETIC_DB_FAILURE"); Object.assign(logs.get(where.id)!, data); },
        upsert: async ({ create, update }: Row) => { const old = logs.get(create.idempotencyKey); if (old) Object.assign(old, update); else logs.set(create.idempotencyKey, { ...create, id: create.idempotencyKey }); },
      },
    },
    send: async (channel: string) => { sends.push(channel); await new Promise(resolve => setTimeout(resolve, 10)); if (failure === "uncertain") throw new Error("SYNTHETIC_TIMEOUT"); return failure === "rejected" ? { ok: false, retryable: false, code: "REJECTED", message: "Synthetic rejection" } : { ok: true, providerReference: failure === "empty-reference" ? "" : "synthetic" }; },
  };
  const output = await build({ entryPoints: ["src/lib/notifications.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-claims", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|email|whatsapp|integrations\/twilio-provider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__state.db;" : args.path.endsWith("/email") ? "export const escapeEmailHtml=__state.escapeEmailHtml;export const stor24ReservationHeldHtml=__state.stor24ReservationHeldHtml;export const emailProvider=()=>({send:()=>__state.send('EMAIL')});" : args.path.endsWith("/whatsapp") ? "export const sendWhatsAppTemplate=()=>{throw Error('Unexpected WhatsApp');};" : "export class TwilioSmsProvider {send(){return __state.send('SMS')}}" }));
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const input = { organisationId: "org", facilityId: "facility", customerId: "customer", idempotencyKey: "synthetic", consent: { email: true, sms: true, whatsapp: false, phone: false }, to: { email: "synthetic@example.invalid", phone: "+15005550006" }, variables: { firstName: "Synthetic", facilityName: "Test", unitNumber: "1", monthlyRateZar: "100", holdExpiresAt: "2026-10-01T10:00:00Z", intendedMoveIn: "1 October 2026", viewingAt: "1 October 2026 at 10:00", reference: "SYNTHETIC" } };
  return { api: loaded.exports, input, sends, logs };
}

for (const method of ["notifyReservationConfirmed", "notifyViewingBooked"]) test(`${method} claims email and SMS before sending and never silently repeats`, async () => {
  const f = await fixture();
  await Promise.all([1, 2, 3].map(() => f.api[method](f.input)));
  assert.equal(f.sends.filter(x => x === "EMAIL").length, 1);
  assert.equal(f.sends.filter(x => x === "SMS").length, 1);
  assert.deepEqual(await f.api[method](f.input), [{ channel: "EMAIL", ok: true }, { channel: "SMS", ok: true }]);
  for (const change of [{ organisationId: "other" }, { facilityId: "other" }, { customerId: "other" }, { to: { email: "other@example.invalid", phone: "+15005550007" } }, { variables: { ...f.input.variables, unitNumber: "2" } }]) {
    assert.ok((await f.api[method]({ ...f.input, ...change })).every((r: Row) => !r.ok));
  }
  assert.equal(f.sends.length, 2);
  assert.deepEqual(await f.api[method]({ ...f.input, consent: { email: false, sms: false } }), []);
  assert.equal(f.logs.size, 2);
  for (const row of f.logs.values()) { assert.equal(row.attempts, 1); assert.equal(row.nextRetryAt, null); assert.ok(row.metadata.payloadHash); assert.ok(!JSON.stringify(row).includes("synthetic@example.invalid")); }
});

test("unclaimed, uncertain and unfinished booking notifications do not resend", async () => {
  for (const failure of ["claim", "finalize", "uncertain"]) {
    const f = await fixture(failure);
    for (let i = 0; i < 2; i++) assert.ok((await f.api.notifyReservationConfirmed(f.input)).every((r: Row) => !r.ok));
    assert.equal(f.sends.length, failure === "claim" ? 0 : 2);
    if (failure !== "claim") for (const row of f.logs.values()) assert.ok(["PENDING", "FAILED"].includes(row.status));
  }
  const rejected = await fixture("rejected");
  const smsOnly = { ...rejected.input, consent: { email: false, sms: true } };
  assert.equal((await rejected.api.notifyReservationConfirmed(smsOnly))[0].ok, false);
  assert.equal((await rejected.api.notifyReservationConfirmed(smsOnly))[0].ok, false);
  assert.equal(rejected.sends.length, 1);
  const empty = await fixture("empty-reference");
  const noReference = { ...empty.input, consent: { email: false, sms: true } };
  assert.equal((await empty.api.notifyReservationConfirmed(noReference))[0].ok, false);
  assert.equal((await empty.api.notifyReservationConfirmed(noReference))[0].ok, false);
  assert.equal(empty.sends.length, 1);
  const legacy = await fixture();
  for (const channel of ["EMAIL", "SMS"]) legacy.logs.set(`synthetic:${channel}`, { id: channel, status: "SUCCEEDED" });
  assert.ok((await legacy.api.notifyReservationConfirmed(legacy.input)).every((r: Row) => !r.ok));
  assert.equal(legacy.sends.length, 0);
});
