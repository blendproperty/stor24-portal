import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import { recogniseScheduledBillingCharge } from "@/lib/scheduled-billing-recognition";

// No production route or timer invokes these isolated-test-only operations.
function requireIsolated() {
  if (process.env.NODE_ENV !== "test" || process.env.MERCHANDISE_DB_TEST !== "isolated-ci" || !process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).hostname !== "localhost") throw new Error("BILLING_ISOLATED_TEST_ONLY");
}
const safeCode = (error: unknown) => error instanceof Error && /^BILLING_[A-Z_]+$/.test(error.message) ? error.message : "BILLING_WORKER_REVIEW_REQUIRED";
type DueGroup = { groupKey: string; representativeId: string; accountId: string; facilityId: string };

export async function runRecognitionWorkerInIsolatedTest(organisationId: string, dueAt: Date) {
  requireIsolated();
  if (!organisationId || !Number.isFinite(dueAt.getTime())) throw new Error("BILLING_WORKER_INPUT_INVALID");
  const token = randomUUID();
  const run = await db.$transaction(async tx => {
    const lease = await tx.$queryRaw<{ organisationId: string }[]>`INSERT INTO "BillingRecognitionLease" ("organisationId", "token", "expiresAt", "updatedAt") VALUES (${organisationId}, ${token}, CURRENT_TIMESTAMP + INTERVAL '5 minutes', CURRENT_TIMESTAMP) ON CONFLICT ("organisationId") DO UPDATE SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = CURRENT_TIMESTAMP WHERE "BillingRecognitionLease"."expiresAt" <= CURRENT_TIMESTAMP RETURNING "organisationId"`;
    if (!lease.length) throw new Error("BILLING_WORKER_ALREADY_RUNNING");
    return tx.billingRecognitionRun.create({ data: { organisationId, status: "RUNNING" } });
  });
  let processed = 0, held = 0;
  try {
    // Held invoices are excluded before the limit, so one broken invoice cannot starve later ones.
    const due = await db.$queryRaw<DueGroup[]>`SELECT c."invoiceId" AS "groupKey", MIN(c."id") AS "representativeId", MIN(c."accountId") AS "accountId", MIN(c."facilityId") AS "facilityId" FROM "ScheduledBillingCharge" c WHERE c."organisationId" = ${organisationId} AND c."invoiceId" IS NOT NULL AND c."recognisedAt" IS NULL AND c."effectiveAt" <= ${dueAt} AND NOT EXISTS (SELECT 1 FROM "BillingRecognitionIssue" i WHERE i."organisationId" = c."organisationId" AND i."groupKey" = c."invoiceId" AND i."status" = 'HELD') GROUP BY c."invoiceId" ORDER BY MIN(c."effectiveAt"), c."invoiceId" LIMIT 25`;
    for (const item of due) {
      if (!await db.billingRecognitionLease.findFirst({ where: { organisationId, token, expiresAt: { gt: new Date() } }, select: { organisationId: true } })) throw new Error("BILLING_WORKER_LEASE_EXPIRED");
      try { const result = await recogniseScheduledBillingCharge(item.representativeId, dueAt); if (!result.alreadyRecognised) processed++; }
      catch (error) {
        const code = safeCode(error);
        await db.billingRecognitionIssue.upsert({ where: { organisationId_groupKey: { organisationId, groupKey: item.groupKey } }, create: { organisationId, facilityId: item.facilityId, accountId: item.accountId, groupKey: item.groupKey, representativeId: item.representativeId, code, status: "HELD" }, update: { facilityId: item.facilityId, accountId: item.accountId, representativeId: item.representativeId, code, status: "HELD" } });
        held++;
      }
    }
    await db.billingRecognitionRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date(), processed, held } });
    return { runId: run.id, processed, held };
  } catch {
    await db.billingRecognitionRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), processed, held } });
    throw new Error("BILLING_WORKER_FAILED");
  } finally {
    // A timed-out prior run must never release a newer run's lease.
    await db.billingRecognitionLease.deleteMany({ where: { organisationId, token } });
  }
}

export async function recognitionWorkerHealthInIsolatedTest(organisationId: string, dueAt: Date, wallClock = new Date()) {
  requireIsolated();
  if (!organisationId || !Number.isFinite(dueAt.getTime()) || !Number.isFinite(wallClock.getTime())) throw new Error("BILLING_WORKER_INPUT_INVALID");
  const [latest, lease, issues, unlinked, due] = await Promise.all([
    db.billingRecognitionRun.findFirst({ where: { organisationId }, orderBy: { startedAt: "desc" } }),
    db.billingRecognitionLease.findUnique({ where: { organisationId } }),
    db.billingRecognitionIssue.count({ where: { organisationId, status: "HELD" } }),
    db.scheduledBillingCharge.count({ where: { organisationId, invoiceId: null, recognisedAt: null, effectiveAt: { lte: dueAt } } }),
    db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(DISTINCT "invoiceId")::bigint AS count FROM "ScheduledBillingCharge" WHERE "organisationId" = ${organisationId} AND "invoiceId" IS NOT NULL AND "recognisedAt" IS NULL AND "effectiveAt" <= ${dueAt}`,
  ]);
  const overdue = Number(due[0].count);
  const running = latest?.status === "RUNNING" && !!lease && lease.expiresAt > wallClock;
  const stale = !!latest && (latest.status === "RUNNING" ? !running : !latest.finishedAt || wallClock.getTime() - latest.finishedAt.getTime() > 15 * 60_000);
  return { status: issues || unlinked ? "REVIEW_REQUIRED" : !latest ? "NEVER_RUN" : latest.status === "FAILED" ? "FAILED" : running ? "RUNNING" : stale ? "STALE" : overdue ? "BACKLOG" : "HEALTHY", running, stale, overdue, held: issues, unlinked, latest: latest ? { status: latest.status, startedAt: latest.startedAt, finishedAt: latest.finishedAt, processed: latest.processed, held: latest.held } : null };
}

export async function releaseRecognitionIssueInIsolatedTest(scope: RequestScope, issueId: string, expectedCode: string, expectedUpdatedAt: Date) {
  requireIsolated();
  if (!Number.isFinite(expectedUpdatedAt.getTime())) throw new Error("BILLING_WORKER_ISSUE_CHANGED");
  return db.$transaction(async tx => {
    const issue = await tx.billingRecognitionIssue.findFirst({ where: { id: issueId, organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) } });
    if (!issue || issue.status !== "HELD" || issue.code !== expectedCode || issue.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("BILLING_WORKER_ISSUE_CHANGED");
    const result = await tx.billingRecognitionIssue.updateMany({ where: { id: issue.id, status: "HELD", code: expectedCode, updatedAt: expectedUpdatedAt }, data: { status: "RELEASED" } });
    if (result.count !== 1) throw new Error("BILLING_WORKER_ISSUE_CHANGED");
    await tx.auditEvent.create({ data: { organisationId: issue.organisationId, facilityId: issue.facilityId, actorId: scope.userId, action: "billing.recognition_issue_released", entityType: "Account", entityId: issue.accountId, after: { issueId, code: expectedCode } } });
    return { released: true };
  }, { isolationLevel: "Serializable" });
}
