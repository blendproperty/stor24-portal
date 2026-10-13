import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { changeMriMapping, mriMappingReview } from "../../src/lib/mri-mapping-service";
import { emptyMriMapping } from "../../src/lib/mri-mapping-policy";

test("isolated MRI mapping persistence, independent review, concurrency and rollback", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const fixture = async () => {
    const org = await db.organisation.create({ data: { name: "MRI mapping CI", slug: randomUUID() } });
    const users = await Promise.all([0, 1, 2].map(i => db.user.create({ data: { organisationId: org.id, name: `Finance CI ${i}`, email: randomUUID() + "@example.invalid" } })));
    return users.map(user => ({ organisationId: org.id, userId: user.id, unrestrictedFacilities: true, facilityIds: [] }));
  };
  const complete = () => ({ ...emptyMriMapping(), entityCode: "CI-ONLY", propertyCode: "CI-PROPERTY", basis: "ACCRUAL" as const, scopeNotes: "Synthetic source classification only; exclusions and opening balances require review", rules: emptyMriMapping().rules.map(r => ({ ...r, debitAccount: "CI-DEBIT", creditAccount: "CI-CREDIT", taxTreatment: "NO_TAX" as const, rationale: "Synthetic sign, source identification, tax and reversal instructions" })) });
  const nativeFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Unexpected provider call"); };
  try {
    await t.test("incomplete drafts persist, scope isolates and review blocks until decisions are explicit", async () => {
      const [a] = await fixture(), [b] = await fixture();
      const saved = await changeMriMapping(a, { action: "save", revision: null, mapping: emptyMriMapping() });
      assert.ok(saved.blockers.length); assert.equal(saved.postingEnabled, false);
      await assert.rejects(changeMriMapping(a, { action: "submit", revision: saved.revision }), /MRI_MAPPING_INCOMPLETE/);
      assert.equal((await mriMappingReview(b)).revision, null);
      await assert.rejects(mriMappingReview({ ...a, unrestrictedFacilities: false }), /MRI_ORG_PERMISSION/);
      await assert.rejects(changeMriMapping({ ...a, unrestrictedFacilities: false }, { action: "save", revision: saved.revision, mapping: complete() }), /MRI_ORG_PERMISSION/);
      await assert.rejects(changeMriMapping(b, { action: "save", revision: saved.revision, mapping: complete() }), /MRI_MAPPING_CHANGED/);
    });
    await t.test("contributors and submitter cannot approve; edits clear approval and audit retains approved version", async () => {
      const [a, b, c] = await fixture();
      const first = await changeMriMapping(a, { action: "save", revision: null, mapping: complete() });
      const edited = await changeMriMapping(b, { action: "save", revision: first.revision, mapping: complete() });
      const submitted = await changeMriMapping(a, { action: "submit", revision: edited.revision });
      for (const actor of [a, b]) {
        assert.equal((await mriMappingReview(actor)).canApprove, false);
        await assert.rejects(changeMriMapping(actor, { action: "approve", revision: submitted.revision, approvalReference: "CI-only decision" }), /MRI_MAPPING_SELF_APPROVAL/);
      }
      assert.equal((await mriMappingReview(c)).canApprove, true);
      const approved = await changeMriMapping(c, { action: "approve", revision: submitted.revision, approvalReference: "CI-only decision" });
      assert.equal(approved.status, "APPROVED"); assert.equal(approved.postingEnabled, false);
      await assert.rejects(changeMriMapping(c, { action: "approve", revision: submitted.revision, approvalReference: "replay" }), /MRI_MAPPING_CHANGED/);
      const revised = await changeMriMapping(a, { action: "save", revision: approved.revision, mapping: complete() });
      assert.equal(revised.status, "DRAFT"); assert.equal(revised.approvedAt, null); assert.equal(revised.approvalReference, null);
      const audits = await db.auditEvent.findMany({ where: { organisationId: a.organisationId, action: "mri.mapping.approve" } });
      assert.equal(audits.length, 1); assert.ok(JSON.stringify(audits[0].after).includes("CI-only decision"));
      assert.equal(await db.ledgerEntry.count({ where: { account: { customer: { organisationId: a.organisationId } } } }), 0);
      assert.equal(await db.payment.count({ where: { account: { customer: { organisationId: a.organisationId } } } }), 0);
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: a.organisationId } }), 0);
    });
    await t.test("concurrent initial saves and stale edits cannot silently overwrite finance decisions", async () => {
      const [a, b] = await fixture();
      const results = await Promise.allSettled([a, b].map(scope => changeMriMapping(scope, { action: "save", revision: null, mapping: complete() })));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const review = await mriMappingReview(a);
      const changes = await Promise.allSettled([a, b].map(scope => changeMriMapping(scope, { action: "save", revision: review.revision, mapping: complete() })));
      assert.equal(changes.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: a.organisationId, domain: "MRI_JOURNAL_MAPPING" } }), 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: a.organisationId } }), 2);
    });
    await t.test("audit failure rolls back mapping create and changes", async () => {
      const [a] = await fixture();
      await assert.rejects(changeMriMapping({ ...a, userId: "missing-ci-actor" }, { action: "save", revision: null, mapping: complete() }));
      assert.equal((await mriMappingReview(a)).revision, null);
      const initial = await changeMriMapping(a, { action: "save", revision: null, mapping: complete() });
      await assert.rejects(changeMriMapping({ ...a, userId: "missing-ci-actor" }, { action: "submit", revision: initial.revision }));
      assert.equal((await mriMappingReview(a)).revision, initial.revision);
    });
  } finally { globalThis.fetch = nativeFetch; await db.$disconnect(); }
});
