import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { escapeEmailHtml, stor24ReservationHeldHtml } from "../../src/lib/email";
import { deliverBookingConfirmation } from "../../src/lib/payments/booking-confirmation-email";
import { customerHistory } from "../../src/lib/customer-history-service";
import { buildCustomerHistoryExport, hydrateCustomerHistoryMessages } from "../../src/lib/customer-history-export";
import type { RequestScope } from "../../src/lib/scope";
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

test("booking confirmation history is atomic with delivery intent, scoped and never resends unknown outcomes", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "localhost"); assert.match(url.pathname, /_ci$/);
  t.mock.method(globalThis, "fetch", () => { throw Error("Unexpected external transport"); });
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Booking history CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: "A", name: "Booking source store" } });
  const other = await db.facility.create({ data: { organisationId: org.id, code: "B", name: "Other store" } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", email: `${key}@example.invalid` } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "Synthetic", features: [] } });
  const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "H1", monthlyRate: 100 } });
  const reservation = await db.reservation.create({ data: { customerId: customer.id, facilityId: facility.id, unitId: unit.id, quotedRate: 100 } });
  await db.lead.create({ data: { facilityId: other.id, customerId: customer.id, source: "OTHER" } });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ST24-T-${reservation.id}` } });
  const staff = await db.user.create({ data: { organisationId: org.id, name: "Synthetic staff", email: `staff-${key}@example.invalid` } });
  const scope: RequestScope = { organisationId: org.id, userId: staff.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  const query = { kind: "COMMUNICATION" as const, search: "" };
  const access = { communications: scope, collections: null, write: null };
  const seed = async (store: string | null = facility.id, status: "PENDING" | "SUCCEEDED" = "PENDING") => {
    const payment = await db.payment.create({ data: { accountId: account.id, amount: 100, method: "CARD", provider: "NETCASH", status: "TEST_SUCCEEDED", idempotencyKey: randomUUID() } });
    const outbox = await db.webhookOutbox.create({ data: { organisationId: org.id, facilityId: store, eventType: "booking.payment_confirmation", aggregateType: "Payment", aggregateId: payment.id, destination: "email://booking-confirmation", idempotencyKey: `booking-confirmation:${payment.id}`, status, payload: { to: customer.email!, reference: `SYNTHETIC-${payment.id}`, unit: "H1", amount: "100.00", test: true } } });
    return { payment, outbox };
  };
  let sends = 0;
  const send = async (message: { text: string }) => { sends++; assert.match(message.text, /TEST — no money received/); };
  const finance = async () => ({ account: await db.account.findUniqueOrThrow({ where: { id: account.id } }), ledger: await db.ledgerEntry.count({ where: { accountId: account.id } }) });
  try {
    const first = await seed(); const before = await finance();
    await Promise.all(Array.from({ length: 5 }, () => deliverBookingConfirmation(first.payment.id, send)));
    assert.equal(sends, 1);
    const log = await db.communicationLog.findUniqueOrThrow({ where: { idempotencyKey: `booking-confirmation-history:${first.outbox.id}` } });
    assert.equal(log.customerId, customer.id); assert.equal(log.facilityId, facility.id); assert.equal(log.organisationId, org.id);
    assert.equal(log.status, "SUCCEEDED"); assert.ok(log.sentAt); assert.equal(log.deliveredAt, null); assert.equal(log.readAt, null); assert.equal(log.nextRetryAt, null);
    const metadata = log.metadata as Row;
    assert.equal(metadata.deliveryOutcome, "ACCEPTED"); assert.equal(metadata.outboxId, first.outbox.id);
    assert.match(metadata.historyEvidence.text, /TEST — no money received/); assert.doesNotMatch(metadata.historyEvidence.text, /https?:\/\//);
    const history = await customerHistory(scope, customer.id, { ...query, search: "sandbox transaction" }, access);
    assert.equal(history.entries.length, 1); assert.equal(history.entries[0].id, log.id);
    assert.equal((await customerHistory(scope, customer.id, query, { ...access, communications: null })).entries.length, 0);
    const bScope = { ...scope, facilityIds: [other.id] };
    assert.equal((await customerHistory(bScope, customer.id, query, { ...access, communications: bScope })).entries.length, 0);
    const exported = await buildCustomerHistoryExport(scope, customer.id, query, access, { id: log.id, kind: "COMMUNICATION" });
    await hydrateCustomerHistoryMessages({ scope, customerId: customer.id, phone: null, rows: exported.rows, access });
    assert.equal(exported.rows.length, 1); assert.equal(exported.rows[0].subject, metadata.historyEvidence.subject);
    assert.equal(exported.rows[0].body, metadata.historyEvidence.text);
    await db.webhookOutbox.update({ where: { id: first.outbox.id }, data: { payload: { changed: "Do not reconstruct a previously sent message" } } });
    await deliverBookingConfirmation(first.payment.id, send);
    assert.equal(sends, 1); assert.deepEqual((await db.communicationLog.findUniqueOrThrow({ where: { id: log.id } })).metadata, log.metadata);
    assert.deepEqual(await finance(), before);

    for (const store of [null, other.id]) {
      const invalid = await seed(store);
      await assert.rejects(deliverBookingConfirmation(invalid.payment.id, send), /BOOKING_EMAIL_SOURCE_REVIEW/);
      assert.equal((await db.webhookOutbox.findUniqueOrThrow({ where: { id: invalid.outbox.id } })).status, "PENDING");
    }
    const foreignOrg = await db.organisation.create({ data: { name: "Foreign booking history", slug: randomUUID() } });
    const wrongOrg = await seed();
    await db.webhookOutbox.update({ where: { id: wrongOrg.outbox.id }, data: { organisationId: foreignOrg.id } });
    await assert.rejects(deliverBookingConfirmation(wrongOrg.payment.id, send), /BOOKING_EMAIL_SOURCE_REVIEW/);
    assert.equal((await db.webhookOutbox.findUniqueOrThrow({ where: { id: wrongOrg.outbox.id } })).status, "PENDING");
    assert.equal(sends, 1);
    const historic = await seed(facility.id, "SUCCEEDED");
    await deliverBookingConfirmation(historic.payment.id, send);
    assert.equal(await db.communicationLog.count({ where: { idempotencyKey: `booking-confirmation-history:${historic.outbox.id}` } }), 0);

    const blocked = await seed();
    await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" ADD CONSTRAINT ci_booking_history_intent CHECK ("messageType" <> \'BOOKING_PAYMENT_CONFIRMATION\') NOT VALID');
    try { await assert.rejects(deliverBookingConfirmation(blocked.payment.id, send)); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" DROP CONSTRAINT ci_booking_history_intent'); }
    assert.equal(sends, 1); assert.equal((await db.webhookOutbox.findUniqueOrThrow({ where: { id: blocked.outbox.id } })).status, "PENDING");
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: blocked.payment.id } })).status, "TEST_SUCCEEDED");

    const unknown = await seed();
    await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" ADD CONSTRAINT ci_booking_history_final CHECK ("messageType" <> \'BOOKING_PAYMENT_CONFIRMATION\' OR "status" = \'PENDING\') NOT VALID');
    try { await deliverBookingConfirmation(unknown.payment.id, send); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" DROP CONSTRAINT ci_booking_history_final'); }
    assert.equal((await db.webhookOutbox.findUniqueOrThrow({ where: { id: unknown.outbox.id } })).status, "PROCESSING");
    const pending = await db.communicationLog.findUniqueOrThrow({ where: { idempotencyKey: `booking-confirmation-history:${unknown.outbox.id}` } });
    assert.equal(pending.status, "PENDING"); assert.equal(pending.sentAt, null);
    await deliverBookingConfirmation(unknown.payment.id, send); assert.equal(sends, 2);

    const rejected = await seed();
    await deliverBookingConfirmation(rejected.payment.id, async () => { sends++; throw Error("Synthetic provider timeout"); });
    await deliverBookingConfirmation(rejected.payment.id, send); assert.equal(sends, 3);
    const failed = await db.communicationLog.findUniqueOrThrow({ where: { idempotencyKey: `booking-confirmation-history:${rejected.outbox.id}` } });
    assert.equal(failed.status, "FAILED"); assert.equal(failed.failureCode, "DELIVERY_REVIEW_REQUIRED"); assert.equal(failed.deliveredAt, null); assert.equal(failed.readAt, null); assert.equal(failed.nextRetryAt, null);
    assert.deepEqual(await finance(), before);
  } finally { await db.$disconnect(); }
});
