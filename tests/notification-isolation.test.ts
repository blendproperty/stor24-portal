import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { escapeEmailHtml, stor24ReservationHeldHtml } from "../src/lib/email";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fixture(failure: string) {
  const sends: string[] = [];
  const state = {
    escapeEmailHtml, stor24ReservationHeldHtml,
    db: {
      communicationTemplate: { findFirst: async () => { if (failure === "template") throw new Error("SYNTHETIC_TEMPLATE_FAILURE"); return null; } },
      communicationLog: { create: async () => { if (failure === "log") throw new Error("SYNTHETIC_LOG_FAILURE"); return { id: "synthetic" }; }, update: async () => { if (failure === "finalize") throw new Error("SYNTHETIC_LOG_FAILURE"); return {}; } },
    },
    send: async (channel: string) => { sends.push(channel); if (failure === channel) throw new Error(`SYNTHETIC_${channel}_FAILURE`); return { ok: true, providerReference: "synthetic" }; },
  };
  const output = await build({ entryPoints: ["src/lib/notifications.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-channels", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|email|whatsapp|integrations\/twilio-provider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__state.db;" : args.path.endsWith("/email") ? "export const escapeEmailHtml=__state.escapeEmailHtml;export const stor24ReservationHeldHtml=__state.stor24ReservationHeldHtml;export const emailProvider=()=>({send:()=>__state.send('EMAIL')});" : args.path.endsWith("/whatsapp") ? "export const sendWhatsAppTemplate=()=>__state.send('WHATSAPP');" : "export class TwilioSmsProvider {send(){return __state.send('SMS')}}" }));
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const input = { organisationId: "org", facilityId: "facility", customerId: "customer", idempotencyKey: "synthetic", consent: { email: true, sms: true, whatsapp: true, phone: false }, to: { email: "synthetic@example.invalid", phone: "+27820000000" }, variables: { firstName: "Synthetic", facilityName: "Test", unitNumber: "1", monthlyRateZar: "100", holdExpiresAt: "2026-10-01T10:00:00Z", intendedMoveIn: "1 October 2026", viewingAt: "1 October 2026 at 10:00", reference: "SYNTHETIC" } };
  return { api: loaded.exports, input, sends };
}

for (const method of ["notifyReservationConfirmed", "notifyViewingBooked"]) test(`${method} returns per-channel failures without interrupting committed work`, async () => {
  for (const failure of ["log", "finalize", "EMAIL", "SMS", "WHATSAPP", "none"]) {
    const f = await fixture(failure);
    const result = await f.api[method](f.input);
    assert.deepEqual(result, ["EMAIL", "SMS", "WHATSAPP"].map(channel => ({ channel, ok: failure !== channel && !(["log", "finalize"].includes(failure) && channel !== "WHATSAPP") })));
    assert.deepEqual(f.sends, failure === "log" ? ["WHATSAPP"] : ["EMAIL", "SMS", "WHATSAPP"]);
  }
  const f = await fixture("none");
  assert.deepEqual(await f.api[method]({ ...f.input, consent: { email: false, sms: false, whatsapp: false, phone: true } }), []);
  assert.deepEqual(await f.api[method]({ ...f.input, to: { email: "", phone: "" } }), []);
  assert.equal(f.sends.length, 0);
});

test("reservation template failure leaves the independent WhatsApp channel available", async () => {
  const f = await fixture("template");
  assert.deepEqual(await f.api.notifyReservationConfirmed(f.input), [{ channel: "EMAIL", ok: false }, { channel: "SMS", ok: false }, { channel: "WHATSAPP", ok: true }]);
  assert.deepEqual(f.sends, ["WHATSAPP"]);
});
