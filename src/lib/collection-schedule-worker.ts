import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import type { EmailProvider } from "./email";
import { collectionEmailSource } from "./collections-service";
import { noticeHash, renderCollectionNotice } from "./collection-notice-policy";
import { sendCollectionNotice } from "./collection-notice-service";
import { COLLECTION_SCHEDULE_PLAN, collectionScheduleWindow } from "./collection-schedule-policy";
import { collectionPlanAuthority, collectionPlanRecord, collectionRunKey, collectionRunRecord, collectionScheduleActivated, collectionScheduleActor, decodeCollectionSchedule, evaluateCollectionSchedule, SCHEDULE_APPROVE, type CollectionScheduleRun } from "./collection-schedule-service";

/** Only a real current-day staff review can authorise a run. No pending run is approved by this worker. */
export async function processCollectionSchedules(provider?: EmailProvider) {
  const fingerprint = process.env.COLLECTION_SCHEDULE_APPROVED_FINGERPRINT ?? "";
  if (!collectionScheduleActivated(fingerprint)) return { disabled: true, prepared: false, accepted: 0, held: 0 };
  const candidates = await db.configurationProfile.findMany({ where: { domain: COLLECTION_SCHEDULE_PLAN, status: "ACTIVE", config: { path: ["fingerprint"], equals: fingerprint } }, take: 2 });
  if (candidates.length !== 1) throw Error("COLLECTION_SCHEDULE_PLAN_REQUIRED");
  const row = candidates[0], plan = decodeCollectionSchedule(row);
  if (plan.kind !== "PLAN" || !row.facilityId) throw Error("COLLECTION_SCHEDULE_INTEGRITY");
  const creator = { userId: plan.creatorId, organisationId: row.organisationId, facilityIds: [row.facilityId], unrestrictedFacilities: false };
  const window = collectionScheduleWindow(plan.input, new Date());
  if (!window.eligible) return { disabled: false, prepared: false, accepted: 0, held: 0 };
  const runId = await evaluateCollectionSchedule(creator, row.id, plan.revision, true);
  const run = await collectionRunRecord(db, row.organisationId, runId);
  if (run.state.status !== "APPROVED" || !run.state.reviewerId) return { disabled: false, prepared: true, accepted: 0, held: run.state.items.length };
  const reviewer = { ...creator, userId: run.state.reviewerId };
  const expectedRunRevision = run.state.revision;
  async function guard(tx: Prisma.TransactionClient, item: CollectionScheduleRun["items"][number]) {
    const currentPlan = await collectionPlanRecord(tx, row.organisationId, row.id), currentRun = await collectionRunRecord(tx, row.organisationId, runId);
    const at = new Date(), range = collectionScheduleWindow(currentPlan.state.input, at);
    if (!collectionScheduleActivated(fingerprint) || currentPlan.state.fingerprint !== fingerprint || currentRun.state.planFingerprint !== fingerprint || currentRun.state.status !== "APPROVED" || currentRun.state.revision !== expectedRunRevision || currentRun.state.reviewerId !== reviewer.userId || currentPlan.state.creatorId === reviewer.userId || currentRun.state.day !== range.day || !range.eligible || at >= new Date(currentRun.state.expires) || collectionRunKey(row.id, range.day) !== runId) throw Error("COLLECTION_SCHEDULE_EXPIRED");
    await collectionPlanAuthority(tx, currentPlan.row, currentPlan.state);
    const fresh = await collectionScheduleActor(tx, reviewer, SCHEDULE_APPROVE, row.facilityId!, true);
    const source = await collectionEmailSource(tx, fresh, item.accountId, range.day);
    if (source.facilityId !== row.facilityId || source.blockers.length || source.fingerprint !== item.sourceFingerprint) throw Error("COLLECTION_SCHEDULE_CHANGED");
    const notice = await tx.configurationProfile.findFirst({ where: { id: item.noticeId, organisationId: row.organisationId, facilityId: row.facilityId, domain: "COLLECTION_EMAIL_NOTICE" } });
    const saved = notice?.config;
    if (!notice || !["APPROVED", "SENDING", "ACCEPTED", "REVIEW_REQUIRED"].includes(notice.status) || !saved || typeof saved !== "object" || Array.isArray(saved) || saved.scheduledRunId !== runId || saved.revision !== item.revision || saved.approvedBy !== reviewer.userId || saved.sourceFingerprint !== source.fingerprint || saved.payloadHash !== noticeHash(renderCollectionNotice(source))) throw Error("COLLECTION_SCHEDULE_CHANGED");
  }
  let accepted = 0, held = 0;
  for (const item of run.state.items) {
    try {
      const result = await sendCollectionNotice(reviewer, { id: item.noticeId, revision: item.revision, confirm: true }, provider, { runId, check: tx => guard(tx, item) });
      if (result.accepted) accepted++; else held++;
    } catch { held++; /* No blind retry after conflicts, expired review or a durable sending claim. */ }
  }
  return { disabled: false, prepared: true, accepted, held };
}
