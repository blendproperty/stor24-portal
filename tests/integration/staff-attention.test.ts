import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { staffOperationalInbox, acknowledgeOperationalEvent, staffOperationalUnreadCount } from "../../src/lib/staff-operational-events";
import { staffArrivals, changeArrivalHandover } from "../../src/lib/staff-arrivals-service";
import { staffPaymentReviewQueue, staffPaymentReviewCount } from "../../src/lib/staff-payment-review-service";
import { getOperationsCalendar } from "../../src/lib/calendar-service";

test("isolated staff event inbox, weekend arrival cover and source payment review", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const org = await db.organisation.create({ data: { name: "Synthetic attention", slug: randomUUID() } });
  const a = await db.facility.create({ data: { organisationId: org.id, name: "Midpoint fixture", code: "A" } });
  const b = await db.facility.create({ data: { organisationId: org.id, name: "Other store fixture", code: "B" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Synthetic operations", permissions: ["operations.view", "operations.manage", "payments.view"] } });
  const staff = await db.user.create({ data: { organisationId: org.id, name: "Manager fixture", email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: a.id } } } });
  const cover = await db.user.create({ data: { organisationId: org.id, name: "Weekend cover fixture", email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: a.id } } } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic arrival" } });
  const type = await db.unitType.create({ data: { facilityId: a.id, name: "Synthetic unit", features: [] } });
  const unit = await db.unit.create({ data: { facilityId: a.id, unitTypeId: type.id, number: "106", status: "RESERVED", floor: "Ground", monthlyRate: 100 } });
  const reservation = await db.reservation.create({ data: { facilityId: a.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: new Date("2026-10-17T00:00:00+02:00"), createdAt: new Date("2026-10-14T09:00:00Z") } });
  const scope = { organisationId: org.id, userId: staff.id, facilityIds: [a.id], unrestrictedFacilities: false };
  const coverScope = { ...scope, userId: cover.id };
  const query = { from: "2026-10-17", to: "2026-10-18" };
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ST24-T-${reservation.id}` } });
  try {
    await t.test("recorded events are source-backed and acknowledgements are personal and idempotent", async () => {
      const event = (await staffOperationalInbox(scope, {})).events.find(e => e.sourceKey === `BOOKING:${reservation.id}`)!;
      assert.ok(event); assert.equal(event.kind, "BOOKING");
      const command = { sourceKey: event.sourceKey, sourceHash: event.sourceHash };
      const [first, second] = await Promise.all([acknowledgeOperationalEvent(scope, command), acknowledgeOperationalEvent(scope, command)]);
      assert.equal(first.id, second.id);
      assert.equal(await db.auditEvent.count({ where: { entityId: first.id, action: "staff_event.acknowledged" } }), 1);
      assert.ok((await staffOperationalInbox(scope, {})).events.find(e => e.sourceKey === event.sourceKey)?.acknowledgedAt);
      assert.equal((await staffOperationalInbox(coverScope, {})).events.find(e => e.sourceKey === event.sourceKey)?.acknowledgedAt, null);
      assert.equal(await staffOperationalUnreadCount(scope), 0);
      assert.equal(await staffOperationalUnreadCount(coverScope), 1);
      assert.equal((await staffOperationalInbox({ ...scope, facilityIds: [b.id] }, {})).events.length, 0);
      await assert.rejects(acknowledgeOperationalEvent({ ...scope, facilityIds: [b.id] }, command), /FORBIDDEN/);
      await assert.rejects(acknowledgeOperationalEvent(scope, { ...command, sourceHash: "a".repeat(64) }), /CONFLICT/);
    });
    await t.test("Saturday/Sunday arrivals retain real blockers and calendar links; only named cover acknowledges", async () => {
      const data = await staffArrivals(scope, query), row = data.rows.find(r => r.id === reservation.id)!;
      assert.equal(row.readiness.readyNow, false); assert.equal(row.readiness.paymentVerified, false); assert.equal(row.readiness.signed, false); assert.ok(row.readiness.blockers.length);
      assert.equal((await staffArrivals({ ...scope, facilityIds: [b.id] }, query)).rows.length, 0);
      await assert.rejects(staffArrivals(scope, { ...query, facilityId: b.id }), /FORBIDDEN/);
      const plan = await changeArrivalHandover(scope, reservation.id, { action: "ASSIGN", sourceHash: row.sourceHash, expectedRevision: null, ownerId: staff.id, coverId: cover.id, notes: "Saturday arrival; agreed weekend cover must review all source checks." });
      await assert.rejects(changeArrivalHandover(scope, reservation.id, { action: "ACKNOWLEDGE", sourceHash: row.sourceHash, expectedRevision: plan.revision }), /FORBIDDEN/);
      const ack = await changeArrivalHandover(coverScope, reservation.id, { action: "ACKNOWLEDGE", sourceHash: row.sourceHash, expectedRevision: plan.revision });
      assert.ok(ack.coverAcknowledgedAt);
      const changed = await changeArrivalHandover(scope, reservation.id, { action: "ASSIGN", sourceHash: row.sourceHash, expectedRevision: ack.revision, ownerId: staff.id, coverId: cover.id, notes: "Updated arrival instructions require a new acknowledgement." });
      assert.equal(changed.coverAcknowledgedAt, null);
      await assert.rejects(changeArrivalHandover(coverScope, reservation.id, { action: "ACKNOWLEDGE", sourceHash: row.sourceHash, expectedRevision: plan.revision }), /CONFLICT/);
      const calendar = await getOperationsCalendar(scope, new Date("2026-10-15T10:00:00+02:00"));
      assert.ok(calendar.find(day => day.key === "2026-10-17")?.items.some(item => item.kind === "MOVE_IN" && item.href.includes("from=2026-10-17")));
      await db.reservation.update({ where: { id: reservation.id }, data: { intendedMoveIn: new Date("2026-10-18T00:00:00+02:00") } });
      const reloaded = (await staffArrivals(scope, query)).rows.find(r => r.id === reservation.id)!;
      assert.equal(reloaded.handover?.sourceCurrent, false);
      await assert.rejects(changeArrivalHandover(coverScope, reservation.id, { action: "ACKNOWLEDGE", sourceHash: row.sourceHash, expectedRevision: changed.revision }), /CONFLICT/);
    });
    await t.test("audit failures roll back arrival instructions and personal inbox acknowledgement", async () => {
      const row = (await staffArrivals(scope, query)).rows[0], before = await db.arrivalHandover.findUniqueOrThrow({ where: { reservationId: reservation.id } });
      const event = (await staffOperationalInbox(coverScope, {})).events[0];
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_staff_attention_audit_failure CHECK (action NOT IN ('arrival_handover.assigned','staff_event.acknowledged')) NOT VALID`);
      try {
        await assert.rejects(changeArrivalHandover(scope, reservation.id, { action: "ASSIGN", sourceHash: row.sourceHash, expectedRevision: before.revision, ownerId: staff.id, coverId: cover.id, notes: "This must roll back." }));
        await assert.rejects(acknowledgeOperationalEvent(coverScope, { sourceKey: event.sourceKey, sourceHash: event.sourceHash }));
        assert.deepEqual(await db.arrivalHandover.findUniqueOrThrow({ where: { id: before.id } }), before);
        assert.equal(await db.staffOperationalAcknowledgement.count({ where: { userId: cover.id } }), 0);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_staff_attention_audit_failure'); }
    });
    await t.test("pending/live exceptions count once; sandbox is excluded; only corrected source clears review", async () => {
      const payment = await db.payment.create({ data: { accountId: account.id, status: "PENDING", provider: "NETCASH", environment: "live", amount: 100, method: "CARD", idempotencyKey: randomUUID() } });
      await db.payment.create({ data: { accountId: account.id, status: "TEST_SUCCEEDED", provider: "NETCASH", environment: "sandbox", amount: 100, method: "CARD", idempotencyKey: randomUUID() } });
      assert.equal(await staffPaymentReviewCount(scope), 1);
      assert.equal(await staffPaymentReviewCount({ ...scope, facilityIds: [b.id] }), 0);
      await db.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", processedAt: new Date() } });
      assert.equal((await staffPaymentReviewQueue(scope)).rows[0].reason, "MISSING_RECEIPT");
      await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: 100, description: "Synthetic verified fixture only", effectiveAt: new Date(), metadata: { paymentId: payment.id, verifiedStatus: true, environment: "live" } } });
      assert.equal(await staffPaymentReviewCount(scope), 0);
      await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: 100, description: "Synthetic duplicate fixture only", effectiveAt: new Date(), metadata: { paymentId: payment.id, verifiedStatus: true, environment: "live" } } });
      assert.equal((await staffPaymentReviewQueue(scope)).rows[0].reason, "DUPLICATE_RECEIPT");
      assert.equal(await db.account.count({ where: { id: account.id, balance: 0 } }), 1);
      assert.equal(await db.communicationLog.count({ where: { organisationId: org.id } }), 0);
    });
    await t.test("payment review includes older pages and does not truncate its reminder count", async () => {
      await db.payment.createMany({ data: Array.from({ length: 105 }, () => ({ accountId: account.id, status: "PENDING" as const, provider: "NETCASH", environment: "live", amount: 100, method: "CARD", idempotencyKey: randomUUID() })) });
      const first = await staffPaymentReviewQueue(scope);
      assert.ok(first.nextCursor); assert.equal(first.rows.length, 100);
      const next = await staffPaymentReviewQueue(scope, undefined, first.nextCursor!);
      assert.equal(next.rows.length, 6); assert.equal(next.nextCursor, null);
      assert.equal(new Set([...first.rows, ...next.rows].map(r => r.id)).size, 106);
      assert.equal(await staffPaymentReviewCount(scope), 106);
    });
    await t.test("signed, move-in started and explicit handover sources remain separate stages", async () => {
      const lease = await db.publicReservationLease.create({ data: { reservationId: reservation.id, status: "SIGNED", version: "synthetic-only", paymentMethod: "CARD", content: "Synthetic lease fixture", clauses: [], sha256: "a".repeat(64), signingToken: randomUUID(), expiresAt: new Date("2030-01-01T00:00:00Z"), signedAt: new Date("2026-10-14T10:00:00Z"), signedPdfSha256: "b".repeat(64) } });
      const tenancy = await db.tenancy.create({ data: { facilityId: a.id, customerId: customer.id, accountId: account.id, startDate: new Date("2026-10-18T00:00:00+02:00"), status: "ACTIVE" } });
      let events = (await staffOperationalInbox(scope, {})).events;
      assert.ok(events.some(e => e.sourceKey === `SIGNED:${lease.id}`));
      assert.equal(events.some(e => e.kind === "HANDED_OVER"), false);
      const started = await db.auditEvent.create({ data: { organisationId: org.id, facilityId: a.id, actorId: staff.id, action: "tenancy.lease_sent_for_signature", entityType: "Tenancy", entityId: tenancy.id } });
      events = (await staffOperationalInbox(scope, {})).events;
      assert.ok(events.some(e => e.sourceKey === `MOVE_IN_STARTED:${started.id}`));
      assert.equal(events.some(e => e.kind === "HANDED_OVER"), false);
      const handed = await db.auditEvent.create({ data: { organisationId: org.id, facilityId: a.id, actorId: staff.id, action: "tenancy.key_handover_confirmed", entityType: "Tenancy", entityId: tenancy.id } });
      assert.ok((await staffOperationalInbox(scope, {})).events.some(e => e.sourceKey === `HANDED_OVER:${handed.id}`));
    });
    await t.test("events and arrivals remain complete over pages and all timestamp ties", async () => {
      await db.reservation.createMany({ data: Array.from({ length: 60 }, () => ({ facilityId: a.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: new Date("2026-10-18T00:00:00+02:00"), createdAt: new Date("2026-10-14T10:00:00Z") })) });
      await db.auditEvent.createMany({ data: Array.from({ length: 60 }, () => ({ organisationId: org.id, facilityId: a.id, action: "tenancy.key_handover_confirmed", entityType: "Tenancy", entityId: "deleted-historical-tenancy" })) });
      let cursor: string | undefined, ids: string[] = [];
      do { const page = await staffOperationalInbox(scope, { cursor }); ids.push(...page.events.map(e => e.sourceKey)); cursor = page.nextCursor ?? undefined; } while (cursor);
      assert.equal(ids.filter(id => id.startsWith("BOOKING:")).length, 61); assert.equal(new Set(ids).size, ids.length);
      cursor = undefined; ids = [];
      do { const page = await staffArrivals(scope, { ...query, ...(cursor ? { cursor } : {}) }); ids.push(...page.rows.map(r => r.id)); cursor = page.nextCursor ?? undefined; } while (cursor);
      assert.equal(ids.length, 61); assert.equal(new Set(ids).size, 61);
    });
  } finally { await db.$disconnect(); }
});
