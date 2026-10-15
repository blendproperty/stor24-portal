import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { previewStaffEventEmail, prepareStaffEventEmail, reviewStaffEventEmail, evaluateStaffEventEmail, readStaffEventEmails } from "../../src/lib/staff-event-email-service";
import { staffEmailDecode, staffEmailPolicyKey } from "../../src/lib/staff-event-email-source";
import { processStaffEventEmail } from "../../src/lib/staff-event-email-worker";
import { STAFF_EMAIL_OUTBOX_DOMAIN } from "../../src/lib/staff-event-email-policy";

test("isolated reviewed staff email policies, source evidence and durable once-only outbox", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const url = new URL(process.env.DATABASE_URL!); assert.equal(url.hostname, "localhost"); assert.match(url.pathname, /^\/(?:faeez_operations|receipt_correction_history_20261015|merchandise_ci)$/);
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "isolated-staff-email-key-not-for-production-123456";
  delete process.env.STAFF_EVENT_EMAIL_ENABLED; delete process.env.STAFF_EVENT_EMAIL_APPROVED_FINGERPRINT;
  const org = await db.organisation.create({ data: { name: "Synthetic staff emails", slug: randomUUID() } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic Midpoint", code: "A" } }), other = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic other", code: "B" } });
  const grants = ["operations.view", "staff_event_emails.view", "staff_event_emails.manage", "staff_event_emails.approve"];
  const role = await db.role.create({ data: { organisationId: org.id, name: "Synthetic event reviewer", permissions: grants } });
  async function user(name: string) { return db.user.create({ data: { organisationId: org.id, name, email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: facility.id } } } }); }
  const creator = await user("Synthetic preparer"), reviewer = await user("Synthetic reviewer"), recipient = await user("Synthetic recipient");
  const scope = { organisationId: org.id, userId: creator.id, facilityIds: [facility.id], unrestrictedFacilities: false }, reviewScope = { ...scope, userId: reviewer.id };
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic customer" } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "Synthetic", features: [] } }), unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "106", status: "RESERVED", floor: "Ground", monthlyRate: 100 } });
  const today = new Date(Date.now() + 7200000).toISOString().slice(0, 10), yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10), tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const booking = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, createdAt: new Date(`${yesterday}T10:00:00Z`) } });
  const input = { facilityId: facility.id, label: "Synthetic reviewed booking policy", recipientIds: [recipient.id], kinds: ["BOOKING"], from: yesterday, to: yesterday, notBefore: `${yesterday}T00:00`, expires: `${tomorrow}T00:00` };
  let requestKey = randomUUID(), prepared: Awaited<ReturnType<typeof prepareStaffEventEmail>>;
  async function newPolicy() { requestKey = randomUUID(); const preview = await previewStaffEventEmail(scope, { action: "preview", input, requestKey }); return prepareStaffEventEmail(scope, { action: "prepare", input, requestKey, expectedFingerprint: preview.previewFingerprint }); }
  async function approve(value: Awaited<ReturnType<typeof prepareStaffEventEmail>>) { return reviewStaffEventEmail(reviewScope, { action: "review", id: value.id, revision: value.revision, decision: "APPROVE", reference: "Synthetic independent review" }); }
  try {
    await t.test("default off exits before any provider call or database source evaluation", async () => {
      let calls = 0; assert.equal((await processStaffEventEmail({ send: async () => { calls++; } })).disabled, true); assert.equal(calls, 0);
    });
    await t.test("genuine scoped source preview and idempotent retained review; no customer log or financial writes", async () => {
      const preview = await previewStaffEventEmail(scope, { action: "preview", input, requestKey });
      assert.equal(preview.examples.length, 1); assert.equal(preview.examples[0].sourceKey, `BOOKING:${booking.id}`); assert.match(preview.examples[0].text, /not confirmation of payment/);
      const command = { action: "prepare", input, requestKey, expectedFingerprint: preview.previewFingerprint };
      const both = await Promise.all([prepareStaffEventEmail(scope, command), prepareStaffEventEmail(scope, command)]); prepared = both[0]; assert.equal(both[1].id, prepared.id);
      assert.equal(await db.auditEvent.count({ where: { entityId: prepared.id, action: "staff_email.policy.prepared" } }), 1);
      assert.equal(await db.communicationLog.count({ where: { organisationId: org.id } }), 0); assert.equal(await db.payment.count({ where: { account: { customerId: customer.id } } }), 0);
    });
    await t.test("stale preview, arbitrary recipient and forged store authority are rejected", async () => {
      await assert.rejects(prepareStaffEventEmail(scope, { action: "prepare", input, requestKey: randomUUID(), expectedFingerprint: "a".repeat(64) }), /SOURCE_CHANGED/);
      await assert.rejects(previewStaffEventEmail({ ...scope, unrestrictedFacilities: true }, { action: "preview", input: { ...input, facilityId: other.id }, requestKey: randomUUID() }), /FORBIDDEN/);
      await assert.rejects(readStaffEventEmails({ ...scope, unrestrictedFacilities: true }, { facilityId: other.id }), /FORBIDDEN/);
    });
    await t.test("physical row copy and clear status tampering fail authenticated envelope verification", async () => {
      const row = await db.configurationProfile.findUniqueOrThrow({ where: { id: prepared.id } });
      assert.throws(() => staffEmailDecode({ ...row, id: staffEmailPolicyKey(randomUUID()) })); assert.throws(() => staffEmailDecode({ ...row, facilityId: other.id })); assert.throws(() => staffEmailDecode({ ...row, status: "APPROVED" }));
      assert.doesNotMatch(JSON.stringify(row.config), new RegExp(recipient.email.replaceAll(".", "\\.")));
    });
    await t.test("preparer cannot self-approve; independent current review is required before evaluation", async () => {
      await assert.rejects(reviewStaffEventEmail(scope, { action: "review", id: prepared.id, revision: prepared.revision, decision: "APPROVE", reference: "Not independent" }), /SELF_APPROVAL/);
      await assert.rejects(evaluateStaffEventEmail(scope, { action: "evaluate", id: prepared.id, revision: prepared.revision }), /NOT_APPROVED/);
      prepared = await approve(prepared); assert.equal(prepared.status, "APPROVED");
    });
    await t.test("concurrent evaluation and overlapping policies share one source-recipient durable identity", async () => {
      const command = { action: "evaluate", id: prepared.id, revision: prepared.revision };
      const results = await Promise.all([evaluateStaffEventEmail(scope, command), evaluateStaffEventEmail(scope, command)]); assert.equal(results.reduce((sum, r) => sum + r.prepared, 0), 1);
      const second = await approve(await newPolicy()); assert.equal((await evaluateStaffEventEmail(scope, { action: "evaluate", id: second.id, revision: second.revision })).duplicates, 1);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, domain: STAFF_EMAIL_OUTBOX_DOMAIN } }), 1);
    });
    await t.test("recipient revocation is checked again immediately before provider claim", async () => {
      process.env.STAFF_EVENT_EMAIL_ENABLED = "true"; process.env.STAFF_EVENT_EMAIL_APPROVED_FINGERPRINT = prepared.policyFingerprint;
      await db.user.update({ where: { id: recipient.id }, data: { active: false } }); let calls = 0;
      await assert.rejects(processStaffEventEmail({ send: async () => { calls++; } }), /RECIPIENT_FORBIDDEN/); assert.equal(calls, 0);
      await db.user.update({ where: { id: recipient.id }, data: { active: true } });
    });
    await t.test("unknown provider outcome is attempted only once and never automatically replayed", async () => {
      let calls = 0; const provider = { send: async () => { calls++; throw Error("Synthetic timeout after possible acceptance"); } };
      const first = await processStaffEventEmail(provider); assert.equal(first.claimed, 1); assert.equal(first.reviewRequired, 1); assert.equal(calls, 1);
      const second = await processStaffEventEmail(provider); assert.equal(second.claimed, 0); assert.equal(calls, 1);
      const rows = await readStaffEventEmails(scope, { facilityId: facility.id, policyId: prepared.id }); assert.equal(rows.outbox[0].status, "REVIEW_REQUIRED");
    });
    await t.test("fresh source drift blocks a held message before any provider call", async () => {
      await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, createdAt: new Date(`${yesterday}T11:00:00Z`) } });
      await evaluateStaffEventEmail(scope, { action: "evaluate", id: prepared.id, revision: prepared.revision });
      await db.customer.update({ where: { id: customer.id }, data: { firstName: "Changed source" } }); let calls = 0;
      await assert.rejects(processStaffEventEmail({ send: async () => { calls++; } }), /SOURCE_CHANGED/); assert.equal(calls, 0);
      await db.customer.update({ where: { id: customer.id }, data: { firstName: "Synthetic customer" } });
    });
    await t.test("provider acceptance retains exact DLP scope and never means inbox delivery", async () => {
      let calls = 0;
      const result = await processStaffEventEmail({ send: async message => { calls++; assert.equal(message.to, recipient.email); assert.equal(message.dlp?.approvedRecipient, recipient.email); assert.equal(message.dlp?.organisationId, org.id); assert.equal(message.dlp?.facilityId, facility.id); assert.equal(message.dlp?.actorId, reviewer.id); assert.match(message.dlp?.resourceId ?? "", /^staff-event-email:/); } });
      assert.equal(calls, 1); assert.equal(result.accepted, 1);
      assert.equal((await processStaffEventEmail({ send: async () => { calls++; } })).claimed, 0); assert.equal(calls, 1);
      const rows = await readStaffEventEmails(scope, { policyId: prepared.id }); assert.ok(rows.outbox.some(row => row.status === "ACCEPTED" && row.acceptedAt));
    });
    await t.test("failed final audit retains SENDING claim and never repeats an accepted provider request", async () => {
      await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, createdAt: new Date(`${yesterday}T12:00:00Z`) } });
      let calls = 0;
      try {
        const result = await processStaffEventEmail({ send: async () => { calls++; await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_staff_email_final_audit CHECK (action <> 'staff_email.outcome') NOT VALID`); } });
        assert.equal(calls, 1); assert.equal(result.reviewRequired, 1);
        const rows = await readStaffEventEmails(scope, { policyId: prepared.id }); assert.ok(rows.outbox.some(row => row.status === "SENDING" && row.attemptedAt && !row.acceptedAt));
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT IF EXISTS ci_staff_email_final_audit'); }
      assert.equal((await processStaffEventEmail({ send: async () => { calls++; } })).claimed, 0); assert.equal(calls, 1);
    });
    await t.test("cancellation blocks future evaluation without recalling uncertain attempts", async () => {
      prepared = await reviewStaffEventEmail(scope, { action: "review", id: prepared.id, revision: prepared.revision, decision: "CANCEL", reference: "Synthetic cancellation" });
      await assert.rejects(evaluateStaffEventEmail(scope, { action: "evaluate", id: prepared.id, revision: prepared.revision }), /NOT_APPROVED/);
      const rows = await readStaffEventEmails(scope, { policyId: prepared.id }); assert.ok(rows.outbox.some(row => row.status === "REVIEW_REQUIRED")); assert.ok(rows.outbox.some(row => row.status === "SENDING")); assert.equal(rows.selectedPolicy?.status, "CANCELLED");
    });
    await t.test("current reviewer permission revocation blocks retained review authority", async () => {
      const next = await approve(await newPolicy()); await db.role.update({ where: { id: role.id }, data: { permissions: grants.filter(g => g !== "staff_event_emails.approve") } });
      await assert.rejects(evaluateStaffEventEmail(scope, { action: "evaluate", id: next.id, revision: next.revision }), /FORBIDDEN/);
    });
    await t.test("raw orphan positions cannot hide older sources and reviewed outbox has stable scoped older pages", async () => {
      await db.role.update({ where: { id: role.id }, data: { permissions: grants } });
      await db.auditEvent.createMany({ data: Array.from({ length: 21 }, () => ({ organisationId: org.id, facilityId: facility.id, action: "tenancy.key_handover_confirmed", entityType: "Tenancy", entityId: "deleted-synthetic-tenancy", occurredAt: new Date(`${yesterday}T20:00:00Z`) })) });
      await db.reservation.createMany({ data: Array.from({ length: 28 }, () => ({ facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, createdAt: new Date(`${yesterday}T09:00:00Z`) })) });
      const policy = await approve(await newPolicy()); let more = true, pages = 0, preparedCount = 0;
      while (more) { assert.ok(pages++ < 10); const result = await evaluateStaffEventEmail(scope, { action: "evaluate", id: policy.id, revision: policy.revision }); more = result.more; preparedCount += result.prepared; }
      assert.ok(pages > 3); assert.equal(preparedCount, 28);
      const first = await readStaffEventEmails(scope, { facilityId: facility.id, policyId: policy.id }); assert.equal(first.outbox.length, 25); assert.ok(first.nextOutboxCursor);
      const second = await readStaffEventEmails(scope, { facilityId: facility.id, policyId: policy.id, outboxCursor: first.nextOutboxCursor }); assert.equal(second.outbox.length, 3); assert.equal(second.nextOutboxCursor, null);
      assert.equal(new Set([...first.outbox, ...second.outbox].map(row => row.id)).size, 28);
      await assert.rejects(readStaffEventEmails(reviewScope, { facilityId: facility.id, policyId: policy.id, outboxCursor: first.nextOutboxCursor }), /CURSOR_INVALID/);
      assert.equal(await db.communicationLog.count({ where: { organisationId: org.id } }), 0);
    });
    await t.test("a full25-policy read remains bounded, pages older policies and retains the explicitly selected older record", async () => {
      for (let index = 0; index < 25; index++) await newPolicy();
      const first = await readStaffEventEmails(scope, { facilityId: facility.id, policyId: prepared.id });
      assert.equal(first.policies.length, 25); assert.ok(first.nextCursor); assert.equal(first.selectedPolicy?.id, prepared.id);
      const older = await readStaffEventEmails(scope, { facilityId: facility.id, policyId: prepared.id, cursor: first.nextCursor });
      assert.ok(older.policies.length > 0); assert.equal(older.nextCursor, null);
      assert.equal(new Set([...first.policies, ...older.policies].map(row => row.id)).size, first.policies.length + older.policies.length);
    });
    await t.test("credential rotation invalidates retained sender authority without a provider attempt", async () => {
      const next = await approve(await newPolicy()), before = process.env.RESEND_API_KEY;
      try {
        process.env.RESEND_API_KEY = `synthetic-${randomUUID()}`;
        await assert.rejects(evaluateStaffEventEmail(scope, { action: "evaluate", id: next.id, revision: next.revision }), /SENDER_CHANGED/);
        assert.equal((await readStaffEventEmails(scope, { policyId: next.id })).selectedPolicy?.authorityCurrent, false);
      } finally { if (before === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = before; }
      assert.equal((await readStaffEventEmails(scope, { policyId: next.id })).selectedPolicy?.authorityCurrent, true);
    });
  } finally { delete process.env.STAFF_EVENT_EMAIL_ENABLED; delete process.env.STAFF_EVENT_EMAIL_APPROVED_FINGERPRINT; await db.$disconnect(); }
});
