import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { escapeEmailHtml, stor24ReservationHeldHtml } from "../src/lib/email";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Execute the real offline service, notification orchestration and WhatsApp
// consent guard. Only persistence, unrelated allocation guards and transports
// are substituted; no real customer, credentials or network are used.
async function fixture(consent: unknown, mode: "fresh" | "replay" | "race") {
  const sends: string[] = [];
  const row = { id: "reservation", publicReference: "SYNTHETIC", facilityId: "facility", customerId: "customer", holdExpiresAt: new Date("2026-10-01T10:00:00Z"), intendedMoveIn: null, quotedRate: 100, customer: { firstName: "Synthetic", email: "synthetic@example.invalid", phone: "+15005550006", communicationConsent: consent }, facility: { organisationId: "org", name: "Synthetic facility" }, unit: { number: "1" } };
  let lookups = 0;
  const db: Row = {
    reservation: { findUnique: async () => (++lookups === 1 && mode !== "replay" ? null : row), create: async () => row },
    lead: { findFirst: async () => ({ id: "lead" }), updateMany: async () => ({ count: 1 }) },
    unit: { updateMany: async () => ({ count: 1 }) },
    task: { create: async () => ({}) }, auditEvent: { create: async () => ({}) },
    communicationTemplate: { findFirst: async () => null },
    communicationLog: {
      // Old successes must not override the customer's current opt-out.
      findMany: async () => ["EMAIL", "SMS", "WHATSAPP"].map(channel => ({ channel, status: "SUCCEEDED" })),
      upsert: async () => ({}), create: async () => ({ id: "log" }), update: async () => ({}),
    },
  };
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => { if (mode === "race") throw new Error("SYNTHETIC_RACE"); return fn(db); };
  const state = { db, escapeEmailHtml, stor24ReservationHeldHtml, send: async (channel: string) => { sends.push(channel); return { ok: true, providerReference: "synthetic" }; } };
  const output = await build({ entryPoints: ["src/lib/offline-reservation-service.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-offline", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|email|scope|floor-availability-service|integrations\/(twilio-provider|whatsapp-automation))$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
      const modules: Record<string, string> = {
        "db": "export const db=__state.db;",
        "email": "export const escapeEmailHtml=__state.escapeEmailHtml;export const stor24ReservationHeldHtml=__state.stor24ReservationHeldHtml;export const emailProvider=()=>({send:()=>__state.send('EMAIL')});",
        "scope": "export const requireFacility=async()=>{};",
        "floor-availability-service": "export const requireOperationalUnit=async()=>{};",
        "integrations/twilio-provider": "export class TwilioSmsProvider {send(){return __state.send('SMS')}};export class TwilioWhatsAppProvider {sendTemplate(){return __state.send('WHATSAPP')}};",
        "integrations/whatsapp-automation": "export const getWhatsAppAutomationState=async()=>({enabled:true});export const whatsAppServerGateEnabled=()=>true;",
      };
      return { contents: modules[args.path.replace("@/lib/", "")] };
    });
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const result = await loaded.exports.syncOfflineReservation({ organisationId: "org", userId: "staff", facilityIds: ["facility"], unrestrictedFacilities: false }, { submissionId: "synthetic-submission", capturedAt: "2026-09-24T10:00:00Z", facilityId: "facility", customerId: "customer", leadId: "lead", unitId: "unit", quotedRate: 100, paymentMethod: "EFT" });
  return { sends, result };
}

test("offline reservations preserve WhatsApp opt-out across fresh and both replay paths", async () => {
  const previous = process.env.TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID;
  process.env.TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID = "HX-synthetic";
  try {
    for (const mode of ["fresh", "replay", "race"] as const) {
      for (const optedOutAt of ["2026-09-24T10:00:00Z", "legacy-nonempty-marker"]) {
        const f = await fixture({ email: true, sms: true, whatsapp: true, optedOutAt }, mode);
        assert.equal(f.result.communications.find((r: Row) => r.channel === "WHATSAPP").status, "NOT_CONSENTED", `${mode} must preserve opt-out`);
        assert.deepEqual(f.sends, mode === "fresh" ? ["EMAIL", "SMS"] : []);
        assert.equal(f.result.idempotent, mode !== "fresh");
      }
      const active = await fixture({ email: true, sms: true, whatsapp: true, optedOutAt: null }, mode);
      assert.deepEqual(active.sends, mode === "fresh" ? ["EMAIL", "SMS", "WHATSAPP"] : []);
      assert.equal(active.result.communications.find((r: Row) => r.channel === "WHATSAPP").status, "SENT");
      for (const consent of [null, [], "true", {}, { whatsapp: false }, { whatsapp: "true" }, { phone: true, sms: false }]) {
        const f = await fixture(consent, mode);
        assert.deepEqual(f.sends, []);
        assert.ok(f.result.communications.every((r: Row) => r.status === "NOT_CONSENTED"));
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID;
    else process.env.TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID = previous;
  }
});
