import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import type { RequestScope } from "./scope";
import { currentRoleAccess } from "./current-role-access";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "./integrations/integration-secret-vault";
import { collectionEmailSource } from "./collections-service";
import { noticeHash } from "./collection-notice-policy";
import { prepareInTransaction, reviewInTransaction } from "./collection-notice-service";
import { staffEmailSender } from "./staff-event-email-source";
import { COLLECTION_SCHEDULE_PLAN, COLLECTION_SCHEDULE_RUN, collectionScheduleCommand, collectionScheduleWindow, scheduleInput, scheduleHash, schedulePlanId, scheduleRunId } from "./collection-schedule-policy";

type Tx = Prisma.TransactionClient;
export const SCHEDULE_VIEW = "collection_schedules.view", SCHEDULE_MANAGE = "collection_schedules.manage", SCHEDULE_APPROVE = "collection_schedules.approve";
const planSchema = z.object({ kind: z.literal("PLAN"), revision: z.uuid(), input: scheduleInput, creatorId: z.cuid(), senderFingerprint: scheduleHash, fingerprint: scheduleHash, status: z.enum(["ACTIVE", "CANCELLED"]) }).strict();
const itemSchema = z.object({ accountId: z.string(), noticeId: z.string(), revision: z.uuid(), recipient: z.email(), subject: z.string(), text: z.string(), sourceFingerprint: scheduleHash });
const runSchema = z.object({ kind: z.literal("RUN"), revision: z.uuid(), planId: schedulePlanId, planFingerprint: scheduleHash, day: z.iso.date(), expires: z.iso.datetime(), status: z.enum(["PENDING_REVIEW", "APPROVED", "CANCELLED"]), items: z.array(itemSchema).max(20), held: z.array(z.object({ accountId: z.string(), reason: z.string() })).max(20), fingerprint: scheduleHash, reviewerId: z.cuid().nullable(), reviewedAt: z.iso.datetime().nullable(), reference: z.string().nullable() }).strict();
export type CollectionSchedulePlan = z.infer<typeof planSchema>;
export type CollectionScheduleRun = z.infer<typeof runSchema>;
type State = CollectionSchedulePlan | CollectionScheduleRun;
type Row = { id: string; organisationId: string; facilityId: string | null; domain: string; status: string; config: Prisma.JsonValue; createdAt: Date };
const mac = (value: unknown) => {
  const key = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim();
  if (!key || key.length < 32) throw Error("COLLECTION_SCHEDULE_VAULT");
  return createHmac("sha256", key).update("collection-schedule-v1:").update(JSON.stringify(value)).digest("hex");
};
const runFingerprint = (value: Pick<CollectionScheduleRun, "planId" | "planFingerprint" | "day" | "expires" | "items" | "held">) => mac([value.planId, value.planFingerprint, value.day, value.expires, value.items, value.held]);
export function decodeCollectionSchedule(row: Row): State {
  const config = z.object({ version: z.literal(1), encrypted: z.string(), integrity: scheduleHash, planId: z.string(), fingerprint: scheduleHash }).strict().parse(row.config);
  const frame = z.object({ id: z.string(), organisationId: z.string(), facilityId: z.cuid(), value: z.discriminatedUnion("kind", [planSchema, runSchema]) }).strict().parse(JSON.parse(decryptIntegrationSecret(config.encrypted)));
  const value = frame.value;
  if (frame.id !== row.id || frame.organisationId !== row.organisationId || frame.facilityId !== row.facilityId || mac(frame) !== config.integrity || value.status !== row.status || value.fingerprint !== config.fingerprint) throw Error("COLLECTION_SCHEDULE_INTEGRITY");
  if (value.kind === "PLAN") {
    if (row.domain !== COLLECTION_SCHEDULE_PLAN || config.planId !== row.id || value.input.facilityId !== row.facilityId || value.fingerprint !== mac([row.id, row.organisationId, row.facilityId, value.input, value.creatorId, value.senderFingerprint])) throw Error("COLLECTION_SCHEDULE_INTEGRITY");
  } else if (row.domain !== COLLECTION_SCHEDULE_RUN || config.planId !== value.planId || row.id !== collectionRunKey(value.planId, value.day) || value.fingerprint !== runFingerprint(value) || value.status === "APPROVED" && (!value.reviewerId || !value.reviewedAt || !value.reference)) throw Error("COLLECTION_SCHEDULE_INTEGRITY");
  return value;
}
export async function storeCollectionSchedule(tx: Tx, row: { id: string; organisationId: string; facilityId: string; domain: string }, value: State, exists: boolean) {
  const frame = { id: row.id, organisationId: row.organisationId, facilityId: row.facilityId, value };
  const data = { status: value.status, config: { version: 1, encrypted: encryptIntegrationSecret(JSON.stringify(frame)), integrity: mac(frame), planId: value.kind === "PLAN" ? row.id : value.planId, fingerprint: value.fingerprint } };
  return exists ? tx.configurationProfile.update({ where: { id: row.id }, data }) : tx.configurationProfile.create({ data: { ...row, name: row.id, ...data } });
}
export const collectionRunKey = (planId: string, day: string) => `collection-run:${noticeHash([planId, day])}`;
async function lock(tx: Tx, id: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`collection-schedule:${id}`}, 0))`; }
export async function collectionScheduleActor(tx: Tx, scope: RequestScope, permission: string, facilityId?: string, sending = false): Promise<RequestScope> {
  if (facilityId && !scope.unrestrictedFacilities && !scope.facilityIds.includes(facilityId)) throw Error("FORBIDDEN");
  const user = await tx.user.findFirst({ where: { id: scope.userId, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  const keys = [SCHEDULE_VIEW, "collections.view", permission, ...(permission !== SCHEDULE_VIEW ? ["collections.manage"] : []), ...(sending ? ["billing.documents.send"] : [])];
  if (!user || !keys.every(key => currentRoleAccess(user.roleAssignments, key, facilityId).allowed)) throw Error("FORBIDDEN");
  let allowed: string[] | null = scope.unrestrictedFacilities ? null : scope.facilityIds;
  for (const key of keys) {
    const ids = currentRoleAccess(user.roleAssignments, key).allowedFacilityIds;
    if (ids !== null) allowed = allowed === null ? ids : allowed.filter(id => ids.includes(id));
  }
  return { userId: user.id, organisationId: user.organisationId, unrestrictedFacilities: allowed === null, facilityIds: allowed ?? [] };
}
export async function collectionPlanRecord(tx: Tx, organisationId: string, id: string) {
  const row = await tx.configurationProfile.findFirst({ where: { id: schedulePlanId.parse(id), organisationId, domain: COLLECTION_SCHEDULE_PLAN } });
  if (!row?.facilityId) throw Error("COLLECTION_SCHEDULE_NOT_FOUND");
  const state = decodeCollectionSchedule(row); if (state.kind !== "PLAN") throw Error("COLLECTION_SCHEDULE_INTEGRITY"); return { row, state };
}
export async function collectionRunRecord(tx: Tx, organisationId: string, id: string) {
  const row = await tx.configurationProfile.findFirst({ where: { id: scheduleRunId.parse(id), organisationId, domain: COLLECTION_SCHEDULE_RUN } });
  if (!row?.facilityId) throw Error("COLLECTION_SCHEDULE_NOT_FOUND");
  const state = decodeCollectionSchedule(row); if (state.kind !== "RUN") throw Error("COLLECTION_SCHEDULE_INTEGRITY"); return { row, state };
}
const scoped = (userId: string, row: Row): RequestScope => ({ userId, organisationId: row.organisationId, unrestrictedFacilities: false, facilityIds: [row.facilityId!] });
export async function collectionPlanAuthority(tx: Tx, row: Row, value: CollectionSchedulePlan) {
  if (value.status !== "ACTIVE") throw Error("COLLECTION_SCHEDULE_CANCELLED");
  await collectionScheduleActor(tx, scoped(value.creatorId, row), SCHEDULE_MANAGE, row.facilityId!);
  if ((await staffEmailSender()).fingerprint !== value.senderFingerprint) throw Error("COLLECTION_SCHEDULE_SENDER_CHANGED");
}
async function audit(tx: Tx, scope: RequestScope | null, row: { id: string; organisationId: string; facilityId: string | null }, action: string, after: Prisma.InputJsonValue) {
  await tx.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, actorId: scope?.userId ?? null, action: `collection.schedule.${action}`, entityType: "ConfigurationProfile", entityId: row.id, after } });
}
export function collectionScheduleActivated(fingerprint: string) { return process.env.COLLECTION_SCHEDULE_ENABLED === "true" && scheduleHash.safeParse(fingerprint).success && process.env.COLLECTION_SCHEDULE_APPROVED_FINGERPRINT === fingerprint; }
async function evaluateIn(tx: Tx, incoming: RequestScope, id: string, revision: string, system: boolean) {
  await lock(tx, id); const plan = await collectionPlanRecord(tx, incoming.organisationId, id);
  const scope = await collectionScheduleActor(tx, incoming, SCHEDULE_MANAGE, plan.row.facilityId!);
  if (plan.state.revision !== revision) throw Error("COLLECTION_SCHEDULE_CHANGED");
  await collectionPlanAuthority(tx, plan.row, plan.state);
  const window = collectionScheduleWindow(plan.state.input, new Date());
  if (!window.eligible) throw Error("COLLECTION_SCHEDULE_NOT_DUE");
  const runId = collectionRunKey(id, window.day), old = await tx.configurationProfile.findUnique({ where: { id: runId } });
  if (old) { decodeCollectionSchedule(old); return runId; }
  const items: CollectionScheduleRun["items"] = [], held: CollectionScheduleRun["held"] = [];
  for (const accountId of plan.state.input.accountIds) {
    const source = await collectionEmailSource(tx, scope, accountId, window.day);
    if (source.facilityId !== plan.row.facilityId) throw Error("FORBIDDEN");
    if (source.blockers.length) { held.push({ accountId, reason: "Current account, payment, identity or consent requires review." }); continue; }
    // A previous uncertain send is never silently replaced by a new daily reminder.
    const prior = await tx.configurationProfile.findMany({ where: { organisationId: scope.organisationId, facilityId: source.facilityId, domain: "COLLECTION_EMAIL_NOTICE", status: { in: ["SENDING", "REVIEW_REQUIRED"] }, config: { path: ["accountId"], equals: accountId } }, take: 1, select: { id: true } });
    if (prior.length) { held.push({ accountId, reason: "A previous delivery outcome needs investigation." }); continue; }
    const noticeId = `collection-email:${noticeHash([scope.organisationId, accountId, window.day])}`;
    const existing = await tx.configurationProfile.findUnique({ where: { id: noticeId }, select: { status: true } });
    if (existing && existing.status !== "DRAFT") { held.push({ accountId, reason: "Today's notice already has a review or delivery record." }); continue; }
    const owned = await tx.configurationProfile.findUnique({ where: { id: noticeId }, select: { config: true } });
    const binding = owned?.config && typeof owned.config === "object" && !Array.isArray(owned.config) ? owned.config.scheduledRunId : null;
    if (binding && binding !== runId) { held.push({ accountId, reason: "Today's draft belongs to another retained run." }); continue; }
    const value = await prepareInTransaction(tx, scoped(plan.state.creatorId, plan.row), accountId, source.fingerprint, window.day, true, runId, system, system ? undefined : scope.userId);
    items.push({ accountId, noticeId: value.id, revision: value.revision, recipient: value.recipient, subject: value.subject, text: value.text, sourceFingerprint: source.fingerprint });
  }
  if (!collectionScheduleWindow(plan.state.input, new Date()).eligible) throw Error("COLLECTION_SCHEDULE_EXPIRED");
  const value: CollectionScheduleRun = { kind: "RUN", revision: randomUUID(), planId: id, planFingerprint: plan.state.fingerprint, day: window.day, expires: window.expires.toISOString(), status: "PENDING_REVIEW", items, held, fingerprint: "", reviewerId: null, reviewedAt: null, reference: null };
  value.fingerprint = runFingerprint(value);
  const row = { id: runId, organisationId: scope.organisationId, facilityId: plan.row.facilityId!, domain: COLLECTION_SCHEDULE_RUN };
  await storeCollectionSchedule(tx, row, value, false);
  await audit(tx, system ? null : scope, row, "run_prepared", { execution: system ? "SYSTEM" : "STAFF", policyCreatorId: plan.state.creatorId, fingerprint: value.fingerprint, recipients: items.length, held: held.length, approved: false, emailSent: false });
  return runId;
}
export async function evaluateCollectionSchedule(scope: RequestScope, id: string, revision: string, system = false) {
  return db.$transaction(tx => evaluateIn(tx, scope, id, revision, system), { isolationLevel: "Serializable", timeout: 30000 });
}
export async function commandCollectionSchedule(incoming: RequestScope, raw: unknown) {
  const command = collectionScheduleCommand.parse(raw);
  if (command.action === "evaluate") return { id: await evaluateCollectionSchedule(incoming, command.id, command.revision), emailSent: false };
  return db.$transaction(async tx => {
    if (command.action === "create") {
      const scope = await collectionScheduleActor(tx, incoming, SCHEDULE_MANAGE, command.input.facilityId);
      if (command.input.to < collectionScheduleWindow(command.input, new Date()).day) throw Error("COLLECTION_SCHEDULE_EXPIRED");
      const facility = await tx.facility.findFirst({ where: { id: command.input.facilityId, organisationId: scope.organisationId } }); if (!facility) throw Error("FORBIDDEN");
      for (const accountId of command.input.accountIds) { const source = await collectionEmailSource(tx, scope, accountId, collectionScheduleWindow(command.input, new Date()).day); if (source.facilityId !== facility.id) throw Error("FORBIDDEN"); }
      const id = `collection-plan:${command.requestKey}`; await lock(tx, id);
      const old = await tx.configurationProfile.findUnique({ where: { id } });
      if (old) { const value = decodeCollectionSchedule(old); if (old.organisationId !== scope.organisationId || old.facilityId !== facility.id || value.kind !== "PLAN" || value.creatorId !== scope.userId || noticeHash(value.input) !== noticeHash(command.input)) throw Error("COLLECTION_SCHEDULE_CHANGED"); return { id, emailSent: false }; }
      const sender = await staffEmailSender();
      const value: CollectionSchedulePlan = { kind: "PLAN", revision: randomUUID(), input: command.input, creatorId: scope.userId, senderFingerprint: sender.fingerprint, fingerprint: mac([id, scope.organisationId, facility.id, command.input, scope.userId, sender.fingerprint]), status: "ACTIVE" };
      const row = { id, organisationId: scope.organisationId, facilityId: facility.id, domain: COLLECTION_SCHEDULE_PLAN };
      await storeCollectionSchedule(tx, row, value, false); await audit(tx, scope, row, "plan_created", { fingerprint: value.fingerprint, mode: "STAFF_REVIEW_EACH_RUN", emailSent: false }); return { id, emailSent: false };
    }
    if (command.action === "cancel-plan") {
      await lock(tx, command.id); const value = await collectionPlanRecord(tx, incoming.organisationId, command.id);
      const scope = await collectionScheduleActor(tx, incoming, SCHEDULE_MANAGE, value.row.facilityId!);
      if (value.state.revision !== command.revision) throw Error("COLLECTION_SCHEDULE_CHANGED");
      value.state.status = "CANCELLED"; value.state.revision = randomUUID();
      await storeCollectionSchedule(tx, { ...value.row, facilityId: value.row.facilityId! }, value.state, true); await audit(tx, scope, value.row, "plan_cancelled", { reference: command.reference }); return { id: value.row.id, emailSent: false };
    }
    const initial = await collectionRunRecord(tx, incoming.organisationId, command.id); await lock(tx, initial.state.planId); await lock(tx, command.id);
    const run = await collectionRunRecord(tx, incoming.organisationId, command.id), plan = await collectionPlanRecord(tx, incoming.organisationId, run.state.planId);
    const scope = await collectionScheduleActor(tx, incoming, command.decision === "APPROVE" ? SCHEDULE_APPROVE : SCHEDULE_MANAGE, run.row.facilityId!, command.decision === "APPROVE");
    if (run.state.revision !== command.revision || run.state.fingerprint !== command.fingerprint || !["PENDING_REVIEW", "APPROVED"].includes(run.state.status)) throw Error("COLLECTION_SCHEDULE_CHANGED");
    if (command.decision === "APPROVE") {
      await collectionPlanAuthority(tx, plan.row, plan.state);
      if (plan.state.creatorId === scope.userId || run.state.status !== "PENDING_REVIEW") throw Error("COLLECTION_SCHEDULE_SELF_APPROVAL");
      if (!run.state.items.length || run.state.planFingerprint !== plan.state.fingerprint || !collectionScheduleWindow(plan.state.input, new Date()).eligible || run.state.day !== collectionScheduleWindow(plan.state.input, new Date()).day || new Date() >= new Date(run.state.expires)) throw Error("COLLECTION_SCHEDULE_EXPIRED");
      for (const item of run.state.items) {
        const source = await collectionEmailSource(tx, scope, item.accountId, run.state.day);
        if (source.facilityId !== run.row.facilityId || source.fingerprint !== item.sourceFingerprint) throw Error("COLLECTION_SCHEDULE_CHANGED");
        const notice = await reviewInTransaction(tx, scope, { id: item.noticeId, revision: item.revision, action: "approve", reference: command.reference }, item.accountId, run.row.id);
        if (notice.recipient !== item.recipient || notice.text !== item.text || notice.subject !== item.subject) throw Error("COLLECTION_SCHEDULE_CHANGED");
        item.revision = notice.revision;
      }
      run.state.status = "APPROVED"; run.state.reviewerId = scope.userId; run.state.reviewedAt = new Date().toISOString();
      run.state.fingerprint = runFingerprint(run.state);
    } else run.state.status = "CANCELLED";
    run.state.reference = command.reference; run.state.revision = randomUUID();
    await storeCollectionSchedule(tx, { ...run.row, facilityId: run.row.facilityId! }, run.state, true);
    await audit(tx, scope, run.row, command.decision === "APPROVE" ? "run_reviewed" : "run_cancelled", { fingerprint: run.state.fingerprint, reference: command.reference, recipients: run.state.items.length, emailSent: false });
    return { id: run.row.id, emailSent: false };
  }, { isolationLevel: "Serializable", timeout: 30000 });
}

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.string().max(120) });
function cursorWhere(raw: string) { if (!raw) return {}; const value = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString())); return { OR: [{ createdAt: { lt: new Date(value.at) } }, { createdAt: new Date(value.at), id: { lt: value.id } }] }; }
const nextCursor = (rows: Row[]) => rows.length > 25 ? Buffer.from(JSON.stringify({ at: rows[24].createdAt.toISOString(), id: rows[24].id })).toString("base64url") : null;
export async function readCollectionSchedules(incoming: RequestScope, query: { facilityId?: string; planId?: string; cursor?: string; runCursor?: string; accountSearch?: string }) {
  return db.$transaction(async tx => {
    const scope = await collectionScheduleActor(tx, incoming, SCHEDULE_VIEW, query.facilityId || undefined);
    const facilities = await tx.facility.findMany({ where: { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { id: { in: scope.facilityIds } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const facilityId = query.facilityId || "";
    const where = { organisationId: scope.organisationId, ...(facilityId ? { facilityId } : scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) };
    const plans = await tx.configurationProfile.findMany({ where: { ...where, domain: COLLECTION_SCHEDULE_PLAN, ...cursorWhere(query.cursor ?? "") }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26 });
    const selected = query.planId ? await collectionPlanRecord(tx, scope.organisationId, query.planId) : null;
    if (selected) await collectionScheduleActor(tx, scope, SCHEDULE_VIEW, selected.row.facilityId!);
    const runs = selected ? await tx.configurationProfile.findMany({ where: { ...where, facilityId: selected.row.facilityId, domain: COLLECTION_SCHEDULE_RUN, config: { path: ["planId"], equals: selected.row.id }, ...cursorWhere(query.runCursor ?? "") }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26 }) : [];
    const search = (query.accountSearch ?? "").trim();
    const accounts = facilityId ? await tx.account.findMany({ where: { customer: { organisationId: scope.organisationId }, tenancy: { facilityId }, ...(search ? { OR: [{ accountNumber: { contains: search, mode: "insensitive" } }, { customer: { OR: [{ firstName: { contains: search, mode: "insensitive" } }, { lastName: { contains: search, mode: "insensitive" } }, { companyName: { contains: search, mode: "insensitive" } }] } }] } : {}) }, select: { id: true, accountNumber: true, customer: { select: { firstName: true, lastName: true, companyName: true } } }, orderBy: [{ accountNumber: "asc" }, { id: "asc" }], take: 26 }) : [];
    async function allowed(permission: string, sending = false) { if (!facilityId) return false; try { await collectionScheduleActor(tx, scope, permission, facilityId, sending); return true; } catch { return false; } }
    return { actorId: scope.userId, facilities, facilityId, accounts: accounts.slice(0, 25).map(a => ({ id: a.id, accountNumber: a.accountNumber, customer: a.customer.companyName || `${a.customer.firstName} ${a.customer.lastName}` })), moreAccounts: accounts.length > 25, plans: plans.slice(0, 25).map(row => ({ id: row.id, createdAt: row.createdAt.toISOString(), state: decodeCollectionSchedule(row) })), selectedPlan: selected ? { id: selected.row.id, state: selected.state } : null, runs: runs.slice(0, 25).map(row => ({ id: row.id, createdAt: row.createdAt.toISOString(), state: decodeCollectionSchedule(row) })), nextCursor: nextCursor(plans), nextRunCursor: nextCursor(runs), canManage: await allowed(SCHEDULE_MANAGE), canApprove: await allowed(SCHEDULE_APPROVE, true), sendingEnabled: process.env.COLLECTION_SCHEDULE_ENABLED === "true" };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
