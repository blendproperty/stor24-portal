import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { commandCollectionSchedule, collectionPlanRecord, collectionRunRecord, evaluateCollectionSchedule, readCollectionSchedules, SCHEDULE_VIEW, SCHEDULE_MANAGE, SCHEDULE_APPROVE } from "../../src/lib/collection-schedule-service";
import { processCollectionSchedules } from "../../src/lib/collection-schedule-worker";
import { sendCollectionNotice, reviewCollectionNotice } from "../../src/lib/collection-notice-service";
import { southAfricaDateKey } from "../../src/lib/south-africa-time";
test("isolated native schedules require a fresh real independent review every run", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "collection-schedule-isolated-key-only-at-least-32";
  process.env.AUTH_SECRET = "collection-schedule-isolated-auth-only-at-least-32"; process.env.APP_URL = "https://portal.example.invalid";
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("No real network is permitted"); };
  const fixed = new Date("2026-10-15T10:00:00.000Z"); t.mock.timers.enable({ apis: ["Date"], now: fixed });
  const fixture = async (count = 1) => {
    const org = await db.organisation.create({ data: { name: "Schedule isolated", slug: randomUUID() } });
    const facility = await db.facility.create({ data: { organisationId: org.id, code: randomUUID(), name: "Synthetic Midpoint" } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Isolated scheduler", permissions: [SCHEDULE_VIEW, SCHEDULE_MANAGE, SCHEDULE_APPROVE, "collections.view", "collections.manage", "billing.documents.send"] } });
    const users = await Promise.all([0, 1].map(i => db.user.create({ data: { organisationId: org.id, name: `Isolated staff ${i}`, email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: facility.id } } } })));
    const scopes = users.map(u => ({ organisationId: org.id, userId: u.id, facilityIds: [facility.id], unrestrictedFacilities: false }));
    const accounts = [];
    for (let i = 0; i < count; i++) {
      const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", lastName: "Debtor", email: `${randomUUID()}@example.invalid`, emailVerifiedAt: fixed, communicationConsent: { email: true } } });
      const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `TEST-${randomUUID()}`, balance: 100 } });
      await db.tenancy.create({ data: { customerId: customer.id, accountId: account.id, facilityId: facility.id, status: "ACTIVE", startDate: new Date("2026-01-01") } });
      await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 100, description: "Synthetic original", effectiveAt: new Date("2026-01-01") } });
      await db.collectionCase.create({ data: { accountId: account.id, terms: { dueDays: 0, allocation: "OLDEST_DUE_FIRST", approvalReference: "Isolated original terms", overrides: [] } } });
      accounts.push({ account, customer });
    }
    const input = { facilityId: facility.id, label: "Synthetic staff review", accountIds: accounts.map(a => a.account.id), from: "2026-10-15", to: "2026-10-16", weekdays: [4, 5], dueTime: "11:00", reviewMinutes: 120 };
    const command = { action: "create", requestKey: randomUUID(), input, confirm: true };
    const saved = await commandCollectionSchedule(scopes[0], command), plan = await collectionPlanRecord(db, org.id, saved.id);
    return { org, facility, role, users, a: scopes[0], b: scopes[1], accounts, command, plan };
  };
  const prepare = async (f: Awaited<ReturnType<typeof fixture>>, system = false) => { const id = await evaluateCollectionSchedule(f.a, f.plan.row.id, f.plan.state.revision, system); return collectionRunRecord(db, f.org.id, id); };
  const approve = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const run = await prepare(f); await commandCollectionSchedule(f.b, { action: "review-run", id: run.row.id, revision: run.state.revision, fingerprint: run.state.fingerprint, decision: "APPROVE", reference: "Isolated exact letters reviewed", confirm: true }); return collectionRunRecord(db, f.org.id, run.row.id);
  };
  const activate = (f: Awaited<ReturnType<typeof fixture>>) => { process.env.COLLECTION_SCHEDULE_ENABLED = "true"; process.env.COLLECTION_SCHEDULE_APPROVED_FINGERPRINT = f.plan.state.fingerprint; };
  try {
    await t.test("default-off worker and due preparation send nothing; system audit does not impersonate staff", async () => {
      delete process.env.COLLECTION_SCHEDULE_ENABLED; delete process.env.COLLECTION_SCHEDULE_APPROVED_FINGERPRINT;
      assert.equal((await processCollectionSchedules({ send: async () => assert.fail("disabled") })).disabled, true);
      const f = await fixture(2), run = await prepare(f, true);
      assert.equal(run.state.status, "PENDING_REVIEW"); assert.equal(run.state.items.length, 2);
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0);
      const audit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: f.org.id, action: "collection.schedule.run_prepared" } }); assert.equal(audit.actorId, null);
      assert.equal((audit.after as { execution: string }).execution, "SYSTEM");
      const rows = await db.configurationProfile.findMany({ where: { organisationId: f.org.id } }); assert.ok(!JSON.stringify(rows).includes(f.accounts[0].customer.email!));
      activate(f); let calls = 0; const result = await processCollectionSchedules({ send: async () => { calls++; } }); assert.equal(calls, 0); assert.equal(result.held, 2);
      assert.equal((await prepare(f)).row.id, run.row.id); assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: "COLLECTION_SCHEDULE_RUN" } }), 1);
      for (const item of run.state.items) { await assert.rejects(sendCollectionNotice(f.b, { id: item.noticeId, revision: item.revision, confirm: true }, { send: async () => assert.fail("manual bypass") }), /IMMUTABLE/); await assert.rejects(reviewCollectionNotice(f.b, { id: item.noticeId, revision: item.revision, action: "approve", reference: "Bypass rejected" }), /IMMUTABLE/); }
    });
    await t.test("exact run review is independent and atomic; stale recipient rolls back all approvals", async () => {
      const f = await fixture(2), run = await prepare(f), command = { action: "review-run", id: run.row.id, revision: run.state.revision, fingerprint: run.state.fingerprint, decision: "APPROVE", reference: "Independent exact review", confirm: true };
      await assert.rejects(commandCollectionSchedule(f.a, command), /SELF_APPROVAL/);
      await db.customer.update({ where: { id: f.accounts[1].customer.id }, data: { email: "changed@example.invalid" } });
      await assert.rejects(commandCollectionSchedule(f.b, command), /CHANGED/);
      assert.equal((await collectionRunRecord(db, f.org.id, run.row.id)).state.status, "PENDING_REVIEW");
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: "COLLECTION_EMAIL_NOTICE", status: "APPROVED" } }), 0);
    });
    await t.test("real reviewed current-day producer sends once, records history, and changes no money", async () => {
      const f = await fixture(), run = await approve(f); activate(f); let calls = 0;
      const provider = { send: async (message: { to: string; dlp?: { actorId?: string } }) => { calls++; assert.equal(message.to, f.accounts[0].customer.email); assert.equal(message.dlp?.actorId, f.b.userId); } };
      assert.equal((await processCollectionSchedules(provider)).accepted, 1); await processCollectionSchedules(provider); assert.equal(calls, 1);
      const log = await db.communicationLog.findUniqueOrThrow({ where: { idempotencyKey: run.state.items[0].noticeId } }); assert.equal(log.status, "SUCCEEDED"); assert.ok(JSON.stringify(log.metadata).includes("historyEvidence"));
      const audits = await db.auditEvent.findMany({ where: { organisationId: f.org.id, action: { in: ["collection.notice.send_claimed", "collection.notice.provider_accepted"] } } }); assert.ok(audits.every(a => a.actorId === null));
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.accounts[0].account.id } })).balance.toString(), "100"); assert.equal(await db.payment.count({ where: { accountId: f.accounts[0].account.id } }), 0); assert.equal(await db.ledgerEntry.count({ where: { accountId: f.accounts[0].account.id } }), 1);
    });
    await t.test("unknown provider outcome never retries and holds the next day's reminder", async () => {
      const f = await fixture(); await approve(f); activate(f); let calls = 0;
      const provider = { send: async () => { calls++; throw Error("simulated unknown"); } };
      await processCollectionSchedules(provider); await processCollectionSchedules(provider); assert.equal(calls, 1);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: "COLLECTION_EMAIL_NOTICE", status: "REVIEW_REQUIRED" } }), 1);
      t.mock.timers.setTime(new Date("2026-10-16T10:00:00Z").getTime());
      const next = await prepare(f); assert.equal(next.state.day, "2026-10-16"); assert.equal(next.state.items.length, 0); assert.equal(next.state.held.length, 1); assert.equal(next.state.reviewerId, null);
      await processCollectionSchedules(provider); assert.equal(calls, 1); t.mock.timers.setTime(fixed.getTime());
    });
    await t.test("a new day prepares a new unapproved run, never regenerates an old approval", async () => {
      const f = await fixture(), old = await approve(f); activate(f); let calls = 0;
      t.mock.timers.setTime(new Date("2026-10-16T10:00:00Z").getTime());
      const result = await processCollectionSchedules({ send: async () => { calls++; } }); assert.equal(calls, 0); assert.equal(result.held, 1);
      const next = await prepare(f); assert.notEqual(next.row.id, old.row.id); assert.equal(next.state.status, "PENDING_REVIEW"); assert.equal(next.state.reviewerId, null); assert.equal(next.state.items[0].text.includes("2026-10-16"), true); assert.equal(old.state.items[0].text.includes("2026-10-15"), true);
      t.mock.timers.setTime(fixed.getTime());
    });
    await t.test("cancellation, sender rotation, current role revocation and consent/source changes hold dispatch", async () => {
      for (const mode of ["plan", "run", "role", "consent", "source", "sender"]) {
        const f = await fixture(), run = await approve(f); activate(f); let calls = 0;
        if (mode === "plan") await commandCollectionSchedule(f.a, { action: "cancel-plan", id: f.plan.row.id, revision: f.plan.state.revision, reference: "Cancel intended plan" });
        if (mode === "run") await commandCollectionSchedule(f.a, { action: "review-run", id: run.row.id, revision: run.state.revision, fingerprint: run.state.fingerprint, decision: "CANCEL", reference: "Cancel exact run", confirm: true });
        if (mode === "role") await db.roleAssignment.deleteMany({ where: { userId: f.b.userId } });
        if (mode === "consent") await db.customer.update({ where: { id: f.accounts[0].customer.id }, data: { communicationConsent: { email: false } } });
        if (mode === "source") await db.ledgerEntry.create({ data: { accountId: f.accounts[0].account.id, type: "CHARGE", amount: 1, description: "Changed source", effectiveAt: new Date("2026-01-01") } });
        if (mode === "sender") process.env.EMAIL_FROM = "changed-sender@example.invalid";
        try { await processCollectionSchedules({ send: async () => { calls++; } }); } catch { /* fail-closed source/authority hold */ }
        assert.equal(calls, 0, mode); assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0, mode); if (mode === "sender") delete process.env.EMAIL_FROM;
      }
    });
    await t.test("scope, immutable encrypted envelope and duplicate preparation reject cross-store or tampered records", async () => {
      const f = await fixture(), other = await fixture(); await assert.rejects(readCollectionSchedules(other.a, { planId: f.plan.row.id }), /NOT_FOUND/);
      await assert.rejects(readCollectionSchedules({ ...f.a, facilityIds: [] }, { facilityId: f.facility.id }), /FORBIDDEN/);
      const repeat = await commandCollectionSchedule(f.a, f.command); assert.equal(repeat.id, f.plan.row.id);
      const attempts = await Promise.allSettled([prepare(f), prepare(f)]); assert.ok(attempts.some(r => r.status === "fulfilled"));
      assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: "COLLECTION_SCHEDULE_RUN" } }), 1);
      const changed = { ...(f.plan.row.config as object), integrity: "a".repeat(64) }; await db.configurationProfile.update({ where: { id: f.plan.row.id }, data: { config: changed } });
      await assert.rejects(prepare(f), /INTEGRITY/);
    });
    await t.test("exact window expiry sends nothing and does not claim a notice", async () => {
      const f = await fixture(); await approve(f); activate(f); t.mock.timers.setTime(new Date("2026-10-15T11:00:00Z").getTime());
      assert.equal(southAfricaDateKey(new Date()), "2026-10-15"); let calls = 0; await processCollectionSchedules({ send: async () => { calls++; } }); assert.equal(calls, 0); assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0); t.mock.timers.setTime(fixed.getTime());
    });
  } finally { globalThis.fetch = originalFetch; delete process.env.COLLECTION_SCHEDULE_ENABLED; delete process.env.COLLECTION_SCHEDULE_APPROVED_FINGERPRINT; t.mock.timers.reset(); await db.$disconnect(); }
});
