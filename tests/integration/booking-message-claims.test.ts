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
import { sendTenantWelcome } from "../../src/lib/tenant-welcome-email";
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

test("welcome history retains actual scoped attempts and holds automatic uncertainty beyond cooldown", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "localhost"); assert.match(url.pathname, /_ci$/);
  t.mock.method(globalThis, "fetch", () => { throw Error("Unexpected real welcome transport"); });
  const org = await db.organisation.create({ data: { name: "Welcome history CI", slug: randomUUID() } });
  const foreignOrg = await db.organisation.create({ data: { name: "Foreign welcome CI", slug: randomUUID() } });
  const a = await db.facility.create({ data: { organisationId: org.id, code: "A", name: "Actual welcome store" } });
  const b = await db.facility.create({ data: { organisationId: org.id, code: "B", name: "Covering store" } });
  const foreign = await db.facility.create({ data: { organisationId: foreignOrg.id, code: "F", name: "Foreign store" } });
  const make = async (facility = a, email = `${randomUUID()}@example.invalid`) => {
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: `Synthetic ${randomUUID()}`, email, emailVerifiedAt: new Date() } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: randomUUID(), features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: randomUUID(), monthlyRate: 100 } });
    const reservation = await db.reservation.create({ data: { customerId: customer.id, facilityId: facility.id, unitId: unit.id, quotedRate: 100 } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: randomUUID() } });
    const tenancy = await db.tenancy.create({ data: { customerId: customer.id, facilityId: facility.id, accountId: account.id, startDate: new Date() } });
    return { customer, reservation, account, tenancy, facility };
  };
  const first = await make();
  const source = { kind: "RESERVATION" as const, id: first.reservation.id, facilityId: a.id };
  let sends = 0;
  const send = async (message: { to: string; text: string; dlp?: { facilityId?: string } }) => { sends++; assert.ok(message.to.endsWith("@example.invalid")); assert.match(message.text, /does not confirm payment/); assert.ok(message.dlp?.facilityId); };
  const logs = (customerId: string) => db.communicationLog.findMany({ where: { organisationId: org.id, customerId, messageType: "TENANT_PORTAL_WELCOME" }, orderBy: [{ queuedAt: "asc" }, { id: "asc" }] });
  const cool = (email: string) => db.tenantPortalWelcome.updateMany({ where: { organisationId: org.id, email }, data: { nextAttemptAt: new Date(0) } });
  const finance = async () => ({ accounts: await db.account.findMany({ where: { customer: { organisationId: org.id } }, orderBy: { id: "asc" } }), ledger: await db.ledgerEntry.count({ where: { account: { customer: { organisationId: org.id } } } }), payments: await db.payment.count({ where: { account: { customer: { organisationId: org.id } } } }) });
  try {
    const admitted = await Promise.all(Array.from({ length: 6 }, () => sendTenantWelcome(first.customer.id, org.id, { source }, db, send)));
    assert.equal(admitted.filter(value => value === "sent").length, 1); assert.equal(sends, 1);
    const original = (await logs(first.customer.id))[0];
    assert.equal(original.facilityId, a.id); assert.equal(original.status, "SUCCEEDED"); assert.ok(original.sentAt); assert.equal(original.deliveredAt, null); assert.equal(original.readAt, null);
    assert.doesNotMatch(JSON.stringify(original.metadata), /https?:\/\//);
    await db.customer.update({ where: { id: first.customer.id }, data: { firstName: "Updated welcome name" } });
    await cool(first.customer.email!);
    assert.equal(await sendTenantWelcome(first.customer.id, org.id, { source }, db, send), "already_sent_or_cooling_down");
    // All actual source kinds resolve their own store, including an exact
    // booking account without a tenancy. Each explicit resend is a new row.
    assert.equal(await sendTenantWelcome(first.customer.id, org.id, { resend: true, source: { kind: "ACCOUNT", id: first.account.id, facilityId: a.id } }, db, send), "sent");
    assert.equal(await sendTenantWelcome(first.customer.id, org.id, { resend: true, source }, db, send), "already_sent_or_cooling_down");
    await cool(first.customer.email!);
    assert.equal(await sendTenantWelcome(first.customer.id, org.id, { resend: true, source: { kind: "TENANCY", id: first.tenancy.id, facilityId: a.id } }, db, send), "sent");
    const bookingAccount = await db.account.create({ data: { customerId: first.customer.id, accountNumber: `ST24-T-${first.reservation.id}` } });
    await cool(first.customer.email!);
    assert.equal(await sendTenantWelcome(first.customer.id, org.id, { resend: true, source: { kind: "ACCOUNT", id: bookingAccount.id, facilityId: a.id } }, db, send), "sent");
    assert.equal((await logs(first.customer.id)).length, 4); assert.equal(sends, 4);
    const accountAttempt = (await logs(first.customer.id)).find(row => (row.metadata as Row).sourceId === first.account.id);
    assert.ok(accountAttempt); assert.match(JSON.stringify(accountAttempt.metadata), /Updated welcome name/);
    assert.deepEqual((await db.communicationLog.findUniqueOrThrow({ where: { id: original.id } })).metadata, original.metadata);
    const second = await make(b, first.customer.email!);
    const secondSource = { kind: "RESERVATION" as const, id: second.reservation.id, facilityId: b.id };
    await cool(first.customer.email!);
    assert.equal(await sendTenantWelcome(second.customer.id, org.id, { source: secondSource }, db, send), "already_sent_or_cooling_down");
    assert.equal((await logs(second.customer.id)).length, 0);
    assert.equal(await sendTenantWelcome(second.customer.id, org.id, { resend: true, source: secondSource }, db, send), "sent");
    const secondLog = (await logs(second.customer.id))[0]; assert.equal(secondLog.facilityId, b.id);
    assert.equal((await logs(first.customer.id)).length, 4);
    await db.lead.create({ data: { customerId: first.customer.id, facilityId: b.id, source: "OTHER" } });
    const staff = await db.user.create({ data: { organisationId: org.id, name: "Welcome fixture", email: `${randomUUID()}@example.invalid` } });
    const scope: RequestScope = { organisationId: org.id, userId: staff.id, facilityIds: [a.id], unrestrictedFacilities: false };
    const query = { kind: "COMMUNICATION" as const, search: "No password to remember" };
    const access = { communications: scope, collections: null, write: null };
    assert.equal((await customerHistory(scope, first.customer.id, query, access)).entries.length, 4);
    const bScope = { ...scope, facilityIds: [b.id] };
    assert.equal((await customerHistory(bScope, first.customer.id, query, { ...access, communications: bScope })).entries.length, 0);
    assert.equal((await customerHistory(scope, first.customer.id, query, { ...access, communications: null })).entries.length, 0);
    const exported = await buildCustomerHistoryExport(scope, first.customer.id, query, access, { id: original.id, kind: "COMMUNICATION" });
    await hydrateCustomerHistoryMessages({ scope, customerId: first.customer.id, phone: null, rows: exported.rows, access });
    assert.match(String(exported.rows[0].body), /No password to remember/); assert.ok(exported.rows[0].subject);
    const beforeInvalid = sends;
    for (const invalid of [{ ...source, facilityId: b.id }, { ...source, facilityId: "" }, { ...source, id: second.reservation.id }, { kind: "TENANCY" as const, id: second.tenancy.id, facilityId: b.id }]) {
      await assert.rejects(sendTenantWelcome(first.customer.id, org.id, { source: invalid, resend: true }, db, send), /WELCOME_SOURCE_REVIEW/);
    }
    const foreignLinked = await make(foreign);
    await assert.rejects(sendTenantWelcome(foreignLinked.customer.id, org.id, { source: { kind: "ACCOUNT", id: foreignLinked.account.id, facilityId: foreign.id } }, db, send), /WELCOME_SOURCE_REVIEW/);
    assert.equal(await sendTenantWelcome(first.customer.id, foreignOrg.id, { source }, db, send), "ineligible");
    const orphan = await db.account.create({ data: { customerId: first.customer.id, accountNumber: randomUUID() } });
    await assert.rejects(sendTenantWelcome(first.customer.id, org.id, { source: { kind: "ACCOUNT", id: orphan.id, facilityId: a.id }, resend: true }, db, send), /WELCOME_SOURCE_REVIEW/);
    assert.equal(sends, beforeInvalid);
    const blocked = await make(); const before = await finance();
    const blockedSource = { kind: "RESERVATION" as const, id: blocked.reservation.id, facilityId: a.id };
    await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" ADD CONSTRAINT ci_welcome_intent CHECK ("messageType" <> \'TENANT_PORTAL_WELCOME\') NOT VALID');
    try { await assert.rejects(sendTenantWelcome(blocked.customer.id, org.id, { source: blockedSource }, db, send)); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" DROP CONSTRAINT ci_welcome_intent'); }
    assert.equal(sends, beforeInvalid); assert.equal((await logs(blocked.customer.id)).length, 0);
    assert.equal(await db.tenantPortalWelcome.count({ where: { organisationId: org.id, email: blocked.customer.email! } }), 0);
    assert.deepEqual(await finance(), before);
    const unknown = await make();
    const unknownSource = { kind: "RESERVATION" as const, id: unknown.reservation.id, facilityId: a.id };
    await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" ADD CONSTRAINT ci_welcome_final CHECK ("messageType" <> \'TENANT_PORTAL_WELCOME\' OR "status" = \'PENDING\') NOT VALID');
    try { await assert.rejects(sendTenantWelcome(unknown.customer.id, org.id, { source: unknownSource }, db, send), /WELCOME_DELIVERY_REVIEW_REQUIRED/); }
    finally { await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" DROP CONSTRAINT ci_welcome_final'); }
    const pending = (await logs(unknown.customer.id))[0]; assert.equal(pending.status, "PENDING"); assert.equal(pending.sentAt, null);
    assert.equal((await db.tenantPortalWelcome.findFirstOrThrow({ where: { organisationId: org.id, email: unknown.customer.email! } })).sentAt, null);
    assert.equal(await db.auditEvent.count({ where: { organisationId: org.id, entityId: unknown.customer.id, action: "tenant_portal.welcome_sent" } }), 0);
    const unknownSends = sends; await cool(unknown.customer.email!);
    assert.equal(await sendTenantWelcome(unknown.customer.id, org.id, { source: unknownSource }, db, send), "delivery_review_required"); assert.equal(sends, unknownSends);
    assert.equal(await sendTenantWelcome(unknown.customer.id, org.id, { source: unknownSource, resend: true }, db, send), "sent");
    assert.equal((await logs(unknown.customer.id)).length, 2); assert.deepEqual((await db.communicationLog.findUniqueOrThrow({ where: { id: pending.id } })).metadata, pending.metadata);
    const rejected = await make();
    const rejectedSource = { kind: "RESERVATION" as const, id: rejected.reservation.id, facilityId: a.id };
    await assert.rejects(sendTenantWelcome(rejected.customer.id, org.id, { source: rejectedSource }, db, async () => { sends++; throw Error("Synthetic unknown provider result"); }), /WELCOME_DELIVERY_FAILED/);
    const failed = (await logs(rejected.customer.id))[0]; assert.equal(failed.status, "FAILED"); assert.equal(failed.failureCode, "DELIVERY_REVIEW_REQUIRED"); assert.equal(failed.deliveredAt, null);
    const failedSends = sends; await cool(rejected.customer.email!);
    assert.equal(await sendTenantWelcome(rejected.customer.id, org.id, { source: rejectedSource }, db, send), "delivery_review_required"); assert.equal(sends, failedSends);
    assert.equal(await sendTenantWelcome(rejected.customer.id, org.id, { source: rejectedSource, resend: true }, db, send), "sent");
    const legacy = await make();
    const legacySource = { kind: "RESERVATION" as const, id: legacy.reservation.id, facilityId: a.id };
    const { createHash } = await import("node:crypto");
    await db.tenantPortalWelcome.create({ data: { id: createHash("sha256").update(`${org.id}\0${legacy.customer.email}`).digest("hex"), organisationId: org.id, email: legacy.customer.email!, attempts: 1, nextAttemptAt: new Date(0), failed: true } });
    assert.equal(await sendTenantWelcome(legacy.customer.id, org.id, { source: legacySource }, db, send), "delivery_review_required"); assert.equal((await logs(legacy.customer.id)).length, 0);
    assert.equal(await sendTenantWelcome(legacy.customer.id, org.id, { source: legacySource, resend: true }, db, send), "sent"); assert.equal((await logs(legacy.customer.id)).length, 1);
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
