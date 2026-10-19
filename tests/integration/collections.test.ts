import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../src/generated/prisma/client";
import { db } from "../../src/lib/db";
import { collectionsWorkspace, updateCollection, processArrearsReviewSchedules } from "../../src/lib/collections-service";
import { ARREARS_REVIEW_CURSOR, ARREARS_REVIEW_SCHEDULE } from "../../src/lib/arrears-review-schedule-policy";
import { readArrearsReviewCursor, readArrearsReviewPlan, saveArrearsReviewCursor } from "../../src/lib/arrears-review-schedule-state";
import { POST as reviewWorkerPost } from "../../src/app/api/internal/arrears-review-schedules/route";
import { operationsTaskPage } from "../../src/lib/operations-task-service";
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
    await t.test("explicit escalation tasks preserve holds, deduplicate open work and require fresh authority", async () => {
      const f = await fixture();
      const request = { ...await base(f), action: "escalation-review-task" as const, target: "FEE" as const, channel: "EMAIL" as const, reviewOn: today, policyReference: "Unapproved policy evidence" };
      await assert.rejects(updateCollection(f.scope, request), /FORBIDDEN/);
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
      await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.*", "operations.view", "operations.manage"] } });
      await updateCollection(f.scope, { ...await base(f), action: "dispute", disputed: true });
      const before = JSON.stringify(await db.account.findUnique({ where: { id: f.account.id }, include: { ledgerEntries: true, payments: true, tenancy: { include: { occupancies: true } } } }));
      const command = { ...request, ...await base(f) };
      const saved = await updateCollection(f.scope, command);
      assert.equal((await updateCollection(f.scope, command)).repeated, true);
      const task = await db.task.findFirstOrThrow({ where: { organisationId: f.org.id } });
      assert.equal(task.assigneeId, f.user.id); assert.equal(task.facilityId, f.facility.id); assert.equal(task.customerId, (await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).customerId);
      assert.equal(task.purpose, "ARREARS_ESCALATION_REVIEW"); assert.equal(task.status, "OPEN");
      assert.equal(southAfricaDateKey(task.dueAt!), today); assert.match(task.description!, /does not approve/); assert.match(task.description!, /amount remains unset/);
      assert.equal(task.description!.includes(command.note), false);
      const tomorrow = southAfricaDateKey(new Date(new Date(`${today}T12:00:00+02:00`).getTime() + 86400000));
      const linked = await updateCollection(f.scope, { ...command, ...await base(f), reviewOn: tomorrow, channel: "WHATSAPP" });
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).dueAt?.getTime(), task.dueAt?.getTime());
      const activity = await db.collectionActivity.findUniqueOrThrow({ where: { id: saved.id } }); assert.match(activity.note, /Completing it is not financial or access approval/);
      const audit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: f.org.id, action: "collections.escalation-review-task", after: { path: ["activityId"], equals: linked.id } } });
      const review = (audit.after as { review: { task: { created: boolean }; feeAmount: null; financialApproval: boolean; accessApproval: boolean } }).review;
      assert.equal(review.task.created, false); assert.equal(review.feeAmount, null); assert.equal(review.financialApproval, false); assert.equal(review.accessApproval, false);
      const queue = await operationsTaskPage(f.scope, { assignee: "mine" }); assert.ok(queue.items.some(item => item.id === task.id));
      await db.task.update({ where: { id: task.id }, data: { assigneeId: null } });
      await assert.rejects(updateCollection(f.scope, { ...command, ...await base(f) }), /COLLECTION_REVIEW_TASK_OWNER/);
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
      await db.task.update({ where: { id: task.id }, data: { assigneeId: f.user.id } });
      await db.task.update({ where: { id: task.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await updateCollection(f.scope, { ...command, ...await base(f) });
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 2);
      assert.equal(await db.task.count({ where: { organisationId: f.org.id, status: "OPEN" } }), 1);
      assert.equal(JSON.stringify(await db.account.findUnique({ where: { id: f.account.id }, include: { ledgerEntries: true, payments: true, tenancy: { include: { occupancies: true } } } })), before);
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0); assert.equal(await db.webhookOutbox.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal((await row(f)).disputed, true);
      await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.*"] } });
      await assert.rejects(updateCollection(f.scope, command), /FORBIDDEN/);
      await assert.rejects(updateCollection({ ...f.scope, facilityIds: [] }, command), /COLLECTION_NOT_FOUND/);
    });
    await t.test("escalation task and case record roll back together on audit failure", async () => {
      const f = await fixture();
      await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.*", "operations.view", "operations.manage"] } });
      const command = { ...await base(f), action: "escalation-review-task" as const, target: "ACCESS" as const, channel: "EMAIL" as const, reviewOn: today, policyReference: "" };
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_escalation_task_failure CHECK (action <> 'collections.escalation-review-task') NOT VALID`);
      try { await assert.rejects(updateCollection(f.scope, command)); } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_escalation_task_failure'); }
      assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal((await row(f)).revision, 0); assert.equal((await row(f)).activities.length, 0);
    });
    await t.test("daily internal review plans keep source, permission and financial boundaries", async timed => {
      const old = { key: process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY, enabled: process.env.ARREARS_REVIEW_SCHEDULE_ENABLED, worker: process.env.ARREARS_REVIEW_WORKER_KEY, organisation: process.env.ARREARS_REVIEW_ORGANISATION_ID };
      process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "synthetic-arrears-review-vault-key-at-least-32-characters";
      process.env.ARREARS_REVIEW_SCHEDULE_ENABLED = "true";
      process.env.ARREARS_REVIEW_WORKER_KEY = "synthetic-internal-review-worker-key-at-least-32";
      const tomorrow = southAfricaDateKey(new Date(new Date(`${today}T12:00:00+02:00`).getTime() + 86400000));
      const at = () => new Date(`${today}T09:00:00+02:00`);
      const qualified = async () => {
        const f = await fixture(); await terms(f);
        await db.tenancy.update({ where: { accountId: f.account.id }, data: { paymentMethod: "EFT" } });
        await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.*", "operations.view", "operations.manage"] } });
        return f;
      };
      type F = Awaited<ReturnType<typeof qualified>>;
      const plan = (f: F) => readArrearsReviewPlan(db, f.org.id, f.account.id);
      const schedule = async (f: F, until = tomorrow) => updateCollection(f.scope, { ...await base(f), action: "schedule-access-review", input: { from: today, until, time: "09:00" }, scheduleRevision: (await plan(f))?.state.revision ?? null, confirm: true });
      const finances = async (f: F) => JSON.stringify(await db.account.findUnique({ where: { id: f.account.id }, include: { ledgerEntries: true, payments: true, tenancy: { include: { occupancies: true } } } }));
      async function check(name: string, fn: (f: F) => Promise<void>) {
        await timed.test(name, async () => {
          const f = await qualified();
          process.env.ARREARS_REVIEW_ORGANISATION_ID = f.org.id;
          try { await fn(f); }
          finally { await db.configurationProfile.deleteMany({ where: { organisationId: f.org.id, domain: { in: [ARREARS_REVIEW_SCHEDULE, ARREARS_REVIEW_CURSOR] } } }); }
        });
      }
      try {
        await check("authenticated default-off worker and manual/scheduled race deduplicate the same debt", async f => {
          await schedule(f); const before = await finances(f);
          assert.equal((await reviewWorkerPost(new Request("http://localhost/api/internal/arrears-review-schedules", { method: "POST" }))).status, 401);
          assert.equal((await reviewWorkerPost(new Request("http://localhost/api/internal/arrears-review-schedules", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status, 401);
          process.env.ARREARS_REVIEW_SCHEDULE_ENABLED = "false";
          const off = await reviewWorkerPost(new Request("http://localhost/api/internal/arrears-review-schedules", { method: "POST", headers: { authorization: `Bearer ${process.env.ARREARS_REVIEW_WORKER_KEY}` } }));
          assert.equal((await off.json()).data.disabled, true);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          process.env.ARREARS_REVIEW_SCHEDULE_ENABLED = "true";
          await processArrearsReviewSchedules(() => new Date(`${today}T08:59:00+02:00`));
          assert.equal((await plan(f))!.state.last, null);
          const manual = { ...await base(f), action: "access-review-task" as const };
          await Promise.allSettled([processArrearsReviewSchedules(at), updateCollection(f.scope, manual)]);
          await processArrearsReviewSchedules(at);
          const tasks = await db.task.findMany({ where: { organisationId: f.org.id } });
          assert.equal(tasks.length, 1); assert.equal(tasks[0].assigneeId, f.user.id);
          assert.equal(southAfricaDateKey(tasks[0].dueAt!), "2026-01-08");
          const queue = await operationsTaskPage(f.scope, { assignee: "mine" });
          assert.ok(queue.items.some(task => task.id === tasks[0].id && task.purpose === "ARREARS_ACCESS_REVIEW"));
          assert.equal((await plan(f))!.state.last!.taskId, tasks[0].id);
          assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "collections.access-review-schedule.evaluated" } }), 1);
          assert.equal(await finances(f), before);
          assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0);
          assert.equal(await db.webhookOutbox.count({ where: { organisationId: f.org.id } }), 0);
        });
        for (const kind of ["PENDING", "FAILED", "SUCCEEDED", "DEBIT_ORDER", "dispute", "promise"] as const) {
          await check(`${kind} remains held during automatic evaluation`, async f => {
            await schedule(f);
            if (kind === "DEBIT_ORDER") await db.tenancy.update({ where: { accountId: f.account.id }, data: { paymentMethod: "DEBIT_ORDER" } });
            else if (kind === "dispute") await updateCollection(f.scope, { ...await base(f), action: "dispute", disputed: true });
            else if (kind === "promise") await updateCollection(f.scope, { ...await base(f), action: "promise", amount: "50", dueDate: today, confirm: true });
            else await db.payment.create({ data: { accountId: f.account.id, amount: 100, status: kind, method: "EFT", environment: "live", idempotencyKey: randomUUID() } });
            const before = await finances(f); await processArrearsReviewSchedules(at);
            assert.equal((await plan(f))!.state.last!.outcome, "HELD");
            assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
            assert.equal(await finances(f), before);
          });
        }
        await check("creator permission revocation and foreign-organisation owner roles do not authorise a worker", async f => {
          await schedule(f);
          await db.role.updateMany({ where: { organisationId: f.org.id }, data: { permissions: ["collections.*"] } });
          const foreign = await fixture();
          const role = await db.role.create({ data: { organisationId: foreign.org.id, name: "Organisation owner", permissions: ["*"] } });
          await db.roleAssignment.create({ data: { userId: f.user.id, roleId: role.id, facilityId: null } });
          await processArrearsReviewSchedules(at);
          assert.equal((await plan(f))!.state.last!.outcome, "HELD");
          assert.equal((await row(f)).accessReviewSchedule.canManage, false);
          await assert.rejects(schedule(f), /FORBIDDEN/);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          const other = { ...f.scope, facilityIds: [] };
          await assert.rejects(updateCollection(other, { ...await base(f), action: "cancel-access-review-schedule", scheduleRevision: (await plan(f))!.state.revision }), /NOT_FOUND/);
        });
        await check("an inactive delegating staff member is held without a task", async f => {
          await schedule(f); await db.user.update({ where: { id: f.user.id }, data: { active: false } });
          await processArrearsReviewSchedules(at);
          assert.equal((await plan(f))!.state.last!.outcome, "HELD");
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
        });
        await check("a verified settled account is not turned into an arrears task", async f => {
          await schedule(f);
          const payment = await db.payment.create({ data: { accountId: f.account.id, amount: 100, status: "SUCCEEDED", method: "EFT", environment: "live", idempotencyKey: randomUUID() } });
          await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "PAYMENT", amount: 100, description: "Isolated verified settlement", effectiveAt: new Date(), metadata: { paymentId: payment.id } } });
          await db.auditEvent.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, actorId: f.user.id, entityType: "Payment", entityId: payment.id, action: "payment.posted" } });
          await db.account.update({ where: { id: f.account.id }, data: { balance: 0 } });
          const before = await finances(f); await processArrearsReviewSchedules(at);
          assert.equal((await plan(f))!.state.last!.outcome, "HELD");
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          assert.equal(await finances(f), before);
        });
        await check("cancellation works after method changes; completed tasks and explicit expiry stay closed", async f => {
          await schedule(f); await db.tenancy.update({ where: { accountId: f.account.id }, data: { paymentMethod: "DEBIT_ORDER" } });
          await updateCollection(f.scope, { ...await base(f), action: "cancel-access-review-schedule", scheduleRevision: (await plan(f))!.state.revision });
          await processArrearsReviewSchedules(at);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          await db.tenancy.update({ where: { accountId: f.account.id }, data: { paymentMethod: "CARD" } });
          await schedule(f, today); await processArrearsReviewSchedules(at);
          const saved = (await plan(f))!; assert.equal(saved.state.status, "EXPIRED");
          const taskId = saved.state.last!.taskId!;
          await db.task.update({ where: { id: taskId }, data: { status: "COMPLETED" } });
          await schedule(f); await processArrearsReviewSchedules(at);
          assert.equal((await plan(f))!.state.last!.outcome, "ALREADY_PREPARED");
          assert.equal((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status, "COMPLETED");
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
        });
        await check("task, case, plan outcome and system audit roll back atomically", async f => {
          await schedule(f); const saved = (await plan(f))!, before = await finances(f), revision = (await row(f)).revision;
          await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_timed_arrears_audit_failure CHECK (action <> 'collections.access-review-schedule.evaluated') NOT VALID`);
          try { await processArrearsReviewSchedules(at); }
          finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_timed_arrears_audit_failure'); }
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          assert.equal((await row(f)).revision, revision); assert.equal(await finances(f), before);
          assert.deepEqual((await plan(f))!.state, saved.state);
          await processArrearsReviewSchedules(at);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
        });
        await check("tampered plan metadata is held and never clears the manual source checks", async f => {
          await schedule(f); const saved = (await plan(f))!;
          const config = saved.row.config as Record<string, Prisma.JsonValue>;
          await db.configurationProfile.update({ where: { id: saved.row.id }, data: { config: { ...config, nextDueAt: "2020-01-01T00:00:00.000Z" } } });
          await processArrearsReviewSchedules(at);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          assert.equal((await row(f)).accessReviewSchedule.unavailable, true);
          assert.equal((await row(f)).accessReview.eligible, true);
        });
        await check("durable scan progress reaches a valid plan after 25 invalid plans", async f => {
          await schedule(f); const saved = (await plan(f))!;
          const ids = Array.from({ length: 25 }, (_, index) => `arrears-review-plan:${index.toString(16).padStart(64, "0")}`);
          assert.ok(ids.every(id => id < saved.row.id));
          await db.configurationProfile.createMany({ data: ids.map(id => ({ id, organisationId: f.org.id, facilityId: f.facility.id, domain: ARREARS_REVIEW_SCHEDULE, name: id, status: "ACTIVE", config: { version: 1, encrypted: "invalid", integrity: "0".repeat(64), nextDueAt: at().toISOString() } })) });
          const first = await processArrearsReviewSchedules(at);
          assert.equal(first.held, 25); assert.equal(first.prepared, 0); assert.equal(first.more, true);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          await processArrearsReviewSchedules(at);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
          assert.equal((await plan(f))!.state.last!.outcome, "PREPARED");
          assert.equal(await db.configurationProfile.count({ where: { organisationId: f.org.id, domain: ARREARS_REVIEW_CURSOR } }), 1);
        });
        await check("the configured organisation is an execution boundary", async f => {
          await schedule(f); const other = await fixture();
          process.env.ARREARS_REVIEW_ORGANISATION_ID = other.org.id;
          assert.equal((await collectionsWorkspace(f.scope, today)).reviewScheduleWorkerEnabled, false);
          await processArrearsReviewSchedules(at);
          assert.equal((await plan(f))!.state.last, null);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          process.env.ARREARS_REVIEW_ORGANISATION_ID = f.org.id;
          await processArrearsReviewSchedules(at);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
        });
        await check("partial budget stops preserve the untouched tail across repeated invocations", async f => {
          await schedule(f); const saved = (await plan(f))!;
          const ids = [0, 1].map(index => `arrears-review-plan:${index.toString(16).padStart(64, "0")}`);
          assert.ok(ids.every(id => id < saved.row.id));
          await db.configurationProfile.createMany({ data: ids.map(id => ({ id, organisationId: f.org.id, facilityId: f.facility.id, domain: ARREARS_REVIEW_SCHEDULE, name: id, status: "ACTIVE", config: { version: 1, encrypted: "invalid", integrity: "0".repeat(64), nextDueAt: at().toISOString() } })) });
          const oneAttempt = () => { let calls = 0; return () => calls++ < 2 ? 0 : 26000; };
          await processArrearsReviewSchedules(at, oneAttempt());
          assert.equal((await readArrearsReviewCursor(db, f.org.id))!.cursor, ids[0]);
          await processArrearsReviewSchedules(at, oneAttempt());
          assert.equal((await readArrearsReviewCursor(db, f.org.id))!.cursor, ids[1]);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          await processArrearsReviewSchedules(at, oneAttempt());
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
          assert.equal((await plan(f))!.state.last!.outcome, "PREPARED");
        });
        await check("an active run lease is respected and an expired lease can recover", async f => {
          await schedule(f); const token = randomUUID();
          await db.$transaction(tx => saveArrearsReviewCursor(tx, f.org.id, { cursor: null, lease: { token, until: new Date(Date.now() + 60000).toISOString() } }));
          const busy = await processArrearsReviewSchedules(at);
          assert.equal(busy.prepared, 0); assert.equal(busy.more, true);
          assert.equal((await readArrearsReviewCursor(db, f.org.id))!.lease!.token, token);
          await db.$transaction(tx => saveArrearsReviewCursor(tx, f.org.id, { cursor: null, lease: { token, until: new Date(Date.now() - 1000).toISOString() } }));
          await processArrearsReviewSchedules(at);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
          assert.equal((await readArrearsReviewCursor(db, f.org.id))!.lease, null);
        });
        await check("concurrent worker invocations retain one task and one case preparation", async f => {
          await schedule(f);
          await Promise.allSettled([processArrearsReviewSchedules(at), processArrearsReviewSchedules(at)]);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 1);
          assert.equal(await db.collectionActivity.count({ where: { caseId: (await db.collectionCase.findUniqueOrThrow({ where: { accountId: f.account.id } })).id, action: "Scheduled internal review task prepared" } }), 1);
          assert.equal((await readArrearsReviewCursor(db, f.org.id))!.lease, null);
        });
        await check("a corrupted scan cursor holds rather than silently resetting signed progress", async f => {
          await schedule(f); const saved = (await plan(f))!;
          await db.$transaction(tx => saveArrearsReviewCursor(tx, f.org.id, { cursor: saved.row.id, lease: null }));
          const cursor = await db.configurationProfile.findFirstOrThrow({ where: { organisationId: f.org.id, domain: ARREARS_REVIEW_CURSOR } });
          await db.configurationProfile.update({ where: { id: cursor.id }, data: { config: { ...(cursor.config as Record<string, Prisma.JsonValue>), integrity: "0".repeat(64) } } });
          await assert.rejects(processArrearsReviewSchedules(at), /INTEGRITY/);
          assert.equal(await db.task.count({ where: { organisationId: f.org.id } }), 0);
          assert.equal((await plan(f))!.state.last, null);
        });
      } finally {
        for (const [name, value] of Object.entries({ INTEGRATION_CONFIG_ENCRYPTION_KEY: old.key, ARREARS_REVIEW_SCHEDULE_ENABLED: old.enabled, ARREARS_REVIEW_WORKER_KEY: old.worker, ARREARS_REVIEW_ORGANISATION_ID: old.organisation })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      }
    });
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
