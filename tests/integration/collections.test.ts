import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { collectionsWorkspace, updateCollection } from "../../src/lib/collections-service";
import { collectionCsv } from "../../src/lib/collections-view";
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
    await t.test("missing terms excluded; approved terms produce 91+ age without financial writes", async () => {
      const f = await fixture(); assert.match((await row(f)).ageing.issue!, /terms/); await terms(f);
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
