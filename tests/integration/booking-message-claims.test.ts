import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { escapeEmailHtml, stor24ReservationHeldHtml } from "../../src/lib/email";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("isolated PostgreSQL booking email/SMS attempt claims", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "localhost"); assert.match(url.pathname, /_ci$/);
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Notification CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: "test", name: "Synthetic facility" } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", email: `${key}@example.invalid`, phone: "+15005550006" } });
  const sends: string[] = [];
  let uncertain = false;
  const state = { db, escapeEmailHtml, stor24ReservationHeldHtml, send: async (channel: string) => { sends.push(channel); await new Promise(resolve => setTimeout(resolve, 15)); if (uncertain) throw new Error("SYNTHETIC_TIMEOUT"); return { ok: true, providerReference: `SM-synthetic-${sends.length}` }; } };
  const output = await build({ entryPoints: ["src/lib/notifications.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-notification-providers", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|email|whatsapp|integrations\/twilio-provider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__state.db;" : args.path.endsWith("/email") ? "export const escapeEmailHtml=__state.escapeEmailHtml;export const stor24ReservationHeldHtml=__state.stor24ReservationHeldHtml;export const emailProvider=()=>({send:()=>__state.send('EMAIL')});" : args.path.endsWith("/whatsapp") ? "export const sendWhatsAppTemplate=()=>{throw Error('Unexpected WhatsApp');};" : "export class TwilioSmsProvider {send(){return __state.send('SMS')}}" }));
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const input = { organisationId: org.id, facilityId: facility.id, customerId: customer.id, idempotencyKey: key, consent: { email: true, sms: true, whatsapp: false, phone: false }, to: { email: customer.email, phone: customer.phone }, variables: { firstName: "Synthetic", facilityName: "Test", unitNumber: "1", monthlyRateZar: "100", holdExpiresAt: "2026-10-01T10:00:00Z", intendedMoveIn: "1 October 2026", viewingAt: "1 October 2026 at 10:00", reference: "SYNTHETIC" } };
  const notify = loaded.exports.notifyReservationConfirmed;
  try {
    for (const method of ["notifyReservationConfirmed", "notifyViewingBooked"]) {
      sends.length = 0;
      const next = { ...input, idempotencyKey: randomUUID() };
      await Promise.all([1, 2, 3].map(() => loaded.exports[method](next)));
      assert.equal(sends.filter(x => x === "EMAIL").length, 1); assert.equal(sends.filter(x => x === "SMS").length, 1);
      assert.equal(await db.communicationLog.count({ where: { idempotencyKey: { startsWith: next.idempotencyKey } } }), 2);
      assert.ok((await loaded.exports[method](next)).every((r: Row) => r.ok));
      assert.ok((await loaded.exports[method]({ ...next, variables: { ...next.variables, unitNumber: "other" } })).every((r: Row) => !r.ok));
      assert.equal(sends.length, 2);
    }
    uncertain = true; sends.length = 0;
    const timedOut = { ...input, idempotencyKey: randomUUID() };
    assert.ok((await notify(timedOut)).every((r: Row) => !r.ok));
    assert.ok((await notify(timedOut)).every((r: Row) => !r.ok));
    assert.equal(sends.length, 2);
    const rows = await db.communicationLog.findMany({ where: { idempotencyKey: { startsWith: timedOut.idempotencyKey } } });
    assert.ok(rows.every(row => row.status === "FAILED" && row.failureCode === "DELIVERY_REVIEW_REQUIRED" && row.attempts === 1 && row.nextRetryAt === null));
    uncertain = false; sends.length = 0;
    // Reject finalisation but permit the durable pre-send claim. Existing rows
    // are exempt from validation; no concurrent test file shares this process.
    await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" ADD CONSTRAINT "synthetic_notification_finalization" CHECK ("status" = \'PENDING\') NOT VALID');
    const unfinished = { ...input, idempotencyKey: randomUUID() };
    try {
      assert.ok((await notify(unfinished)).every((r: Row) => !r.ok));
      assert.ok((await notify(unfinished)).every((r: Row) => !r.ok));
      assert.equal(sends.length, 2);
      assert.equal(await db.communicationLog.count({ where: { idempotencyKey: { startsWith: unfinished.idempotencyKey }, status: "PENDING" } }), 2);
    } finally { await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" DROP CONSTRAINT "synthetic_notification_finalization"'); }
    assert.ok((await notify(unfinished)).every((r: Row) => !r.ok)); assert.equal(sends.length, 2);
    sends.length = 0;
    await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" ADD CONSTRAINT "synthetic_notification_claim" CHECK (false) NOT VALID');
    try { assert.ok((await notify({ ...input, idempotencyKey: randomUUID() })).every((r: Row) => !r.ok)); assert.equal(sends.length, 0); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" DROP CONSTRAINT "synthetic_notification_claim"'); }
  } finally { await db.$disconnect(); }
});
