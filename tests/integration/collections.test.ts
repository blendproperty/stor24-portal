import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { collectionsWorkspace, updateCollection } from "../../src/lib/collections-service";
import { collectionCsv } from "../../src/lib/collections-view";
import { buildReportRows } from "../../src/lib/report-data-service";
import { southAfricaDateKey } from "../../src/lib/south-africa-time";
import type { CollectionAction } from "../../src/lib/collections-policy";
test("isolated PostgreSQL aged collections", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const today = southAfricaDateKey(new Date());
  async function fixture() {
    const key = randomUUID(), org = await db.organisation.create({ data: { name: "Collections CI", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "CI store" } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "CI collector", email: `${key}@example.invalid` } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Collector", permissions: ["collections.*"] } });
    await db.roleAssignment.create({ data: { roleId: role.id, userId: user.id, facilityId: facility.id } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "=CI formula" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `COL-CI-${key}`, balance: 100 } });
    await db.tenancy.create({ data: { customerId: customer.id, accountId: account.id, facilityId: facility.id, status: "ACTIVE", startDate: new Date("2026-01-01") } });
    await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 100, description: "CI original rent", effectiveAt: new Date("2026-01-01") } });
    const scope = { organisationId: org.id, userId: user.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    return { org, facility, user, account, scope };
  }
  const row = async (f: Awaited<ReturnType<typeof fixture>>) => (await collectionsWorkspace(f.scope, today)).rows[0];
  const base = async (f: Awaited<ReturnType<typeof fixture>>) => ({ accountId: f.account.id, revision: (await row(f)).revision, requestKey: randomUUID(), note: "CI evidence reference" });
  const terms = async (f: Awaited<ReturnType<typeof fixture>>) => updateCollection(f.scope, { ...await base(f), action: "terms", terms: { dueDays: 0, allocation: "OLDEST_DUE_FIRST", approvalReference: "CI approved agreement", overrides: [] }, confirm: true });
  try {
    await t.test("seven-day EFT/card task preparation is scoped, deduplicated and has no financial or access effects", async () => {
      const f = await fixture(); await terms(f);
      await db.tenancy.update({ where: { accountId: f.account.id }, data: { paymentMethod: "EFT" } });
      assert.equal((await row(f)).accessReview.eligible, true);
      await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "access-review-task" }), /COLLECTION_OWNER/);
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
      const foreignOrg = await db.organisation.create({ data: { name: "Foreign role source", slug: randomUUID() } });
      const foreignRole = await db.role.create({ data: { organisationId: foreignOrg.id, name: "Organisation owner", permissions: ["*"] } });
      await db.roleAssignment.create({ data: { userId: f.user.id, roleId: foreignRole.id, facilityId: null } });
      await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "access-review-task" }), /COLLECTION_OWNER/);
      await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.manage", "operations.view", "operations.manage"] } });
      await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "access-review-task" }), /COLLECTION_OWNER/);
      await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.*", "operations.view", "operations.manage"] } });
      const financial = async () => JSON.stringify(await db.account.findUnique({ where: { id: f.account.id }, include: { ledgerEntries: true, payments: true, tenancy: { include: { occupancies: true } } } }));
      const before = await financial();
      const command = { ...await base(f), action: "access-review-task" as const };
      const first = await updateCollection(f.scope, command);
      assert.equal((await updateCollection(f.scope, command)).id, first.id);
      await updateCollection(f.scope, { ...await base(f), action: "access-review-task" });
      const tasks = await db.task.findMany({ where: { organisationId: f.org.id } });
      assert.equal(tasks.length, 1); assert.equal(tasks[0].purpose, "ARREARS_ACCESS_REVIEW");
      assert.equal(tasks[0].assigneeId, f.user.id);
      assert.equal(tasks[0].facilityId, f.facility.id); assert.equal(tasks[0].customerId, null);
      assert.match(tasks[0].description!, /not approval/);
      assert.equal(await financial(), before);
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: f.org.id } }), 0);
      const audit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: f.org.id, action: "collections.access-review-task" } });
      assert.equal((audit.after as { accessApproval: boolean }).accessApproval, false);
      await assert.rejects(updateCollection({ ...f.scope, facilityIds: [] }, { ...await base(f), action: "access-review-task" }), /NOT_FOUND/);
      const pending = await db.payment.create({ data: { accountId: f.account.id, amount: 100, method: "CARD", status: "PENDING", idempotencyKey: randomUUID(), environment: "live" } });
      assert.equal((await row(f)).accessReview.eligible, false);
      await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "access-review-task" }), /ACCESS_REVIEW_HELD/);
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
      for (const status of ["FAILED", "SUCCEEDED"] as const) {
        await db.payment.update({ where: { id: pending.id }, data: { status } });
        assert.equal((await row(f)).accessReview.eligible, false);
        await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "access-review-task" }), /ACCESS_REVIEW_HELD/);
      }
    });
    await t.test("debit order needs authoritative failure evidence and task/audit failures roll back together", async () => {
      const f = await fixture(); await terms(f);
      await db.tenancy.update({ where: { accountId: f.account.id }, data: { paymentMethod: "DEBIT_ORDER" } });
      assert.equal((await row(f)).accessReview.reviewOn, null);
      await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "access-review-task" }), /ACCESS_REVIEW_HELD/);
      await db.tenancy.update({ where: { accountId: f.account.id }, data: { paymentMethod: "CARD" } });
      await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.*", "operations.view", "operations.manage"] } });
      const revision = (await row(f)).revision;
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_access_review_audit_failure CHECK (action <> 'collections.access-review-task') NOT VALID`);
      try { await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "access-review-task" })); }
      finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_access_review_audit_failure'); }
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal((await row(f)).revision, revision);
    });
    await t.test("escalation requests remain held evidence under a promise and never send, post fees or change access", async () => {
      const f = await fixture(); await terms(f);
      await updateCollection(f.scope, { ...await base(f), action: "promise", amount: "50", dueDate: today, confirm: true });
      const before = JSON.stringify(await db.account.findUnique({ where: { id: f.account.id }, include: { ledgerEntries: true, payments: true, tenancy: { include: { occupancies: true } } } }));
      for (const target of ["NOTICE", "FEE", "ACCESS"] as const) {
        const command = { ...await base(f), action: "escalation-review" as const, target, channel: "WHATSAPP" as const, reviewOn: today, policyReference: "Proposed evidence, not approval" };
        const result = await updateCollection(f.scope, command);
        assert.equal((await updateCollection(f.scope, command)).id, result.id);
        await assert.rejects(updateCollection(f.scope, { ...command, note: "Different retry payload" }), /COLLECTION_CHANGED/);
        const audit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: f.org.id, action: "collections.escalation-review" }, orderBy: { occurredAt: "desc" } });
        const review = (audit.after as { review: { status: string; effect: string; blockers: string[]; sourceHash: string; customerMessageSent: boolean; financialEntriesCreated: number; accessCommandsCreated: number } }).review;
        assert.equal(review.status, "HELD_POLICY"); assert.equal(review.effect, "INTERNAL_REVIEW_ONLY"); assert.ok(review.blockers.some(value => /promise/i.test(value)));
        assert.match(review.sourceHash, /^[a-f0-9]{64}$/); assert.equal(review.customerMessageSent, false); assert.equal(review.financialEntriesCreated, 0); assert.equal(review.accessCommandsCreated, 0);
      }
      assert.equal(JSON.stringify(await db.account.findUnique({ where: { id: f.account.id }, include: { ledgerEntries: true, payments: true, tenancy: { include: { occupancies: true } } } })), before);
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0); assert.equal(await db.webhookOutbox.count({ where: { organisationId: f.org.id } }), 0);
      assert.ok((await row(f)).hold); assert.equal((await row(f)).promises[0].status, "OPEN");
      const command = { ...await base(f), action: "escalation-review" as const, target: "FEE" as const, channel: "EMAIL" as const, reviewOn: today, policyReference: "" };
      const revision = (await row(f)).revision;
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_escalation_audit_failure CHECK (action <> 'collections.escalation-review') NOT VALID`);
      try { await assert.rejects(updateCollection(f.scope, command)); } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_escalation_audit_failure'); }
      assert.equal((await row(f)).revision, revision);
      await assert.rejects(updateCollection({ ...f.scope, facilityIds: [] }, command), /COLLECTION_NOT_FOUND/);
      await assert.rejects(updateCollection(f.scope, { ...command, reviewOn: "2020-01-01" }), /COLLECTION_DATE/);
    });
    await t.test("missing terms excluded; approved terms produce 91+ age without financial writes", async () => {
      const f = await fixture(); assert.match((await row(f)).ageing.issue!, /terms/);
      const parameters = { reportKey: "receivables-ageing", from: today, to: today, format: "JSON" as const, groupBy: "month" as const };
      const [missing] = await buildReportRows(f.scope, parameters); assert.match(String(missing.reviewReason), /terms/); assert.equal(missing.days91Plus, null);
      await terms(f);
      const [exported] = await buildReportRows(f.scope, parameters); assert.equal(exported.days91Plus, "100.00"); assert.equal(exported.currentRecordedBalance, "100"); assert.equal(exported.asOfSast, today);
      assert.equal((await buildReportRows({ ...f.scope, facilityIds: [] }, parameters)).length, 0);
      const excluded = await fixture(); await assert.rejects(buildReportRows(f.scope, { ...parameters, facilityId: excluded.facility.id }), /FACILITY_FORBIDDEN/);
      const r = await row(f); assert.equal(r.ageing.issue, null); assert.equal(r.ageing.buckets[4], 10000);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1); assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 0);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), "100");
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: f.org.id } }), 0);
      await db.payment.create({ data: { accountId: f.account.id, amount: 100, method: "EFT", status: "PENDING", idempotencyKey: randomUUID(), environment: "live" } });
      assert.equal((await row(f)).hold, "Payment awaiting confirmation");
    });
    await t.test("organisation, facility and assignee isolation", async () => {
      const f = await fixture(), other = await fixture();
      assert.equal((await collectionsWorkspace({ ...f.scope, facilityIds: [] }, today)).rows.length, 0);
      await assert.rejects(updateCollection(other.scope, { ...await base(f), action: "dispute", disputed: true }), /NOT_FOUND/);
      await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "follow-up", ownerId: other.user.id, nextFollowUp: today, outcome: "PLAN" }), /OWNER/);
      await db.user.update({ where: { id: f.user.id }, data: { active: false } });
      await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "follow-up", ownerId: f.user.id, nextFollowUp: today, outcome: "PLAN" }), /OWNER/);
    });
    await t.test("idempotency, stale edits and simultaneous writers preserve one action", async () => {
      const f = await fixture(); const input: CollectionAction = { ...await base(f), action: "follow-up", ownerId: f.user.id, nextFollowUp: today, outcome: "NO_ANSWER" };
      const result = await updateCollection(f.scope, input); assert.equal((await updateCollection(f.scope, input)).id, result.id);
      await assert.rejects(updateCollection(f.scope, { ...input, note: "different outcome" }), /CHANGED/);
      await assert.rejects(updateCollection(f.scope, { ...input, requestKey: randomUUID() }), /CHANGED/);
      const next = { ...await base(f), action: "dispute" as const, disputed: true };
      const outcomes = await Promise.allSettled([updateCollection(f.scope, next), updateCollection(f.scope, { ...next, requestKey: randomUUID() })]);
      assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1); assert.equal((await row(f)).activities.length, 2);
    });
    await t.test("dispute holds and bad amounts block promises; cancellation retains history", async () => {
      const f = await fixture(); await terms(f);
      await updateCollection(f.scope, { ...await base(f), action: "dispute", disputed: true });
      const promise = async (amount = "50") => updateCollection(f.scope, { ...await base(f), action: "promise", amount, dueDate: today, confirm: true });
      await assert.rejects(promise(), /PROMISE/); await updateCollection(f.scope, { ...await base(f), action: "dispute", disputed: false });
      await assert.rejects(promise("100.01"), /PROMISE/); await promise(); await assert.rejects(promise(), /PROMISE/);
      const saved = await row(f); assert.match(saved.hold!, /Agreed promise due/);
      const p = saved.promises[0]; await assert.rejects(updateCollection(f.scope, { ...await base(f), action: "close-promise", promiseId: p.id, status: "KEPT" }), /PROMISE/);
      await updateCollection(f.scope, { ...await base(f), action: "close-promise", promiseId: p.id, status: "CANCELLED" });
      await promise(); assert.equal((await row(f)).promises.length, 2);
    });
    await t.test("test receipts and unmatched opening balances cannot appear collectible", async () => {
      const f = await fixture(); await terms(f);
      const payment = await db.payment.create({ data: { accountId: f.account.id, amount: 10, status: "TEST_SUCCEEDED", method: "EFT", idempotencyKey: randomUUID(), environment: "sandbox" } });
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "PAYMENT", amount: 10, description: "test", effectiveAt: new Date(), metadata: { paymentId: payment.id } } });
      await db.account.update({ where: { id: f.account.id }, data: { balance: 90 } });
      const r = await row(f); assert.match(r.ageing.issue!, /test/); assert.equal(r.ageing.overdue, 0);
      const other = await fixture(); await db.account.update({ where: { id: other.account.id }, data: { balance: 999 } }); assert.match((await row(other)).ageing.issue!, /reconciliation/);
    });
    await t.test("promise closure requires new on-time receipts; later reversal remains visible", async () => {
      const f = await fixture(); await terms(f);
      await updateCollection(f.scope, { ...await base(f), action: "promise", amount: "50", dueDate: today, confirm: true });
      const p = (await row(f)).promises[0];
      await db.collectionPromise.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 60000) } });
      const paid = await db.payment.create({ data: { accountId: f.account.id, amount: 50, status: "SUCCEEDED", method: "EFT", idempotencyKey: randomUUID(), environment: "live" } });
      const receipt = await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "PAYMENT", amount: 50, description: "Real fixture receipt", effectiveAt: new Date(), metadata: { paymentId: paid.id } } });
      await db.auditEvent.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, actorId: f.user.id, entityType: "Payment", entityId: paid.id, action: "payment.posted" } });
      await db.account.update({ where: { id: f.account.id }, data: { balance: 50 } });
      await updateCollection(f.scope, { ...await base(f), action: "close-promise", promiseId: p.id, status: "KEPT" });
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "REVERSAL", amount: 50, description: "Unpaid", effectiveAt: new Date(), reversalOfId: receipt.id } });
      await db.payment.update({ where: { id: paid.id }, data: { status: "REVERSED" } }); await db.account.update({ where: { id: f.account.id }, data: { balance: 100 } });
      const after = await row(f); assert.equal(after.promises[0].status, "KEPT"); assert.equal(after.promises[0].progress?.covered, false); assert.equal(after.ageing.buckets[4], 10000);
    });
    await t.test("receipt status alone is not proof and corrected states need matching ledger entries", async () => {
      const f = await fixture(); await terms(f);
      const payment = await db.payment.create({ data: { accountId: f.account.id, amount: 10, status: "SUCCEEDED", method: "EFT", idempotencyKey: randomUUID(), environment: "live" } });
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "PAYMENT", amount: 10, description: "Unproven receipt", effectiveAt: new Date(), metadata: { paymentId: payment.id } } });
      await db.account.update({ where: { id: f.account.id }, data: { balance: 90 } });
      assert.match((await row(f)).ageing.issue!, /unverified/);
      await db.auditEvent.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, actorId: f.user.id, entityType: "Payment", entityId: payment.id, action: "payment.posted" } });
      assert.equal((await row(f)).ageing.issue, null);
      await db.payment.update({ where: { id: payment.id }, data: { status: "REVERSED" } }); assert.match((await row(f)).ageing.issue!, /unverified/);
    });
    await t.test("CSV uses same filtered scope, escapes formulas and labels exclusions", async () => {
      const f = await fixture(); const data = await collectionsWorkspace(f.scope, today);
      const csv = collectionCsv(data, { mode: "all", facility: "", owner: "", search: "" }); assert.ok(csv.includes("'=CI formula")); assert.ok(csv.includes("Approved due dates"));
      const empty = collectionCsv(data, { mode: "all", facility: "another-store", owner: "", search: "" }); assert.equal(empty.split("\r\n").length, 1);
      await assert.rejects(collectionsWorkspace(f.scope, "2099-01-01"), /DATE/);
    });
  } finally { await db.$disconnect(); }
});
