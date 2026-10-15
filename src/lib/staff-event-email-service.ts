import { z } from "zod";
import { db } from "./db";
import type { RequestScope } from "./scope";
import { facilityWhere } from "./scope";
import { currentRoleAccess } from "./current-role-access";
import { historyDateRange } from "./customer-history-policy";
import { staffOperationalEmailPage, staffOperationalEmailSource } from "./staff-operational-events";
import { STAFF_EMAIL_POLICY_DOMAIN, STAFF_EMAIL_OUTBOX_DOMAIN, STAFF_EMAIL_TEMPLATE_VERSION, staffEmailCommand, staffEmailPreview, staffEmailQuery, staffEmailSastTime, type StaffEmailInput, type StaffEmailRead } from "./staff-event-email-policy";
import { STAFF_EMAIL_VIEW, STAFF_EMAIL_MANAGE, STAFF_EMAIL_APPROVE, staffEmailActor, staffEmailScope, staffEmailRecipients, staffEmailDigest, staffEmailMac, staffEmailSender, staffEmailDecode, staffEmailStore, staffEmailPolicyKey, staffEmailOutboxKey, staffEmailSourceFingerprint, staffEmailRender, staffEmailLock, staffEmailTransaction, freshStaffEmailRevision, type StaffEmailClient, type StaffEmailRecord, type StaffEmailPolicyState, type StaffEmailOutboxState } from "./staff-event-email-source";

export function staffEmailActivationMatches(fingerprint: string) { return process.env.STAFF_EVENT_EMAIL_ENABLED === "true" && /^[a-f0-9]{64}$/.test(fingerprint) && process.env.STAFF_EVENT_EMAIL_APPROVED_FINGERPRINT === fingerprint; }
function range(input: StaffEmailInput) { const dates = historyDateRange(input); return { from: dates.gte!, to: dates.lt! }; }
export function withinStaffEmailRange(input: StaffEmailInput, at: string) { const dates = range(input), date = new Date(at); return date >= dates.from && date < dates.to; }
export function requireStaffEmailTiming(input: StaffEmailInput) { if (staffEmailSastTime(input.expires) <= new Date()) throw Error("STAFF_EMAIL_TIMING_EXPIRED"); }
export async function staffEmailPolicyRecord(tx: StaffEmailClient, organisationId: string, id: string) {
  const row = await tx.configurationProfile.findFirst({ where: { id, organisationId, domain: STAFF_EMAIL_POLICY_DOMAIN } });
  if (!row?.facilityId) throw Error("STAFF_EMAIL_NOT_FOUND");
  const state = staffEmailDecode(row); if (state.kind !== "POLICY") throw Error("STAFF_EMAIL_INTEGRITY");
  return { row, state };
}
export async function staffEmailAuthority(tx: StaffEmailClient, row: StaffEmailRecord, state: StaffEmailPolicyState, reviewed = false) {
  if (!row.facilityId) throw Error("STAFF_EMAIL_INTEGRITY");
  const facility = await tx.facility.findFirst({ where: { id: row.facilityId, organisationId: row.organisationId }, select: { id: true, name: true } });
  if (!facility || facility.name !== state.facility) throw Error("STAFF_EMAIL_SOURCE_CHANGED");
  if ((await staffEmailSender()).fingerprint !== state.senderFingerprint) throw Error("STAFF_EMAIL_SENDER_CHANGED");
  await staffEmailActor(tx, state.createdById, row.organisationId, STAFF_EMAIL_MANAGE, row.facilityId);
  const recipients = await staffEmailRecipients(tx, row.organisationId, row.facilityId, state.input.recipientIds);
  if (staffEmailDigest(recipients) !== staffEmailDigest(state.recipients)) throw Error("STAFF_EMAIL_RECIPIENT_CHANGED");
  if (reviewed) {
    if (state.status !== "APPROVED" || !state.reviewedById || state.createdById === state.reviewedById) throw Error("STAFF_EMAIL_NOT_APPROVED");
    await staffEmailActor(tx, state.reviewedById, row.organisationId, STAFF_EMAIL_APPROVE, row.facilityId);
  }
  return facility;
}
async function policyView(tx: StaffEmailClient, scope: RequestScope, value: Awaited<ReturnType<typeof staffEmailPolicyRecord>>) {
  const { row, state } = value; const actor = await staffEmailActor(tx, scope.userId, scope.organisationId, STAFF_EMAIL_VIEW, row.facilityId!);
  const blockers: string[] = []; try { await staffEmailAuthority(tx, row, state, state.status === "APPROVED"); } catch { blockers.push("Staff, recipient, store or review authority changed. A new review is required."); }
  if (staffEmailSastTime(state.input.expires) <= new Date()) blockers.push("The approved delivery window has expired.");
  const manage = currentRoleAccess(actor.roleAssignments, STAFF_EMAIL_MANAGE, row.facilityId!).allowed, approve = currentRoleAccess(actor.roleAssignments, STAFF_EMAIL_APPROVE, row.facilityId!).allowed;
  return { id: row.id, revision: state.revision, label: state.input.label, status: state.status, facilityId: row.facilityId!, facility: state.facility, createdAt: row.createdAt.toISOString(), createdByName: state.createdByName, createdById: state.createdById, reviewedAt: state.reviewedAt, reviewedByName: state.reviewedByName, reference: state.reference, input: state.input, recipients: state.recipients, policyFingerprint: state.policyFingerprint, authorityCurrent: !blockers.length, blockers, activationConfigured: staffEmailActivationMatches(state.policyFingerprint), canReview: approve && scope.userId !== state.createdById && state.status === "PENDING_REVIEW" && !blockers.length, canCancel: manage && ["PENDING_REVIEW", "APPROVED"].includes(state.status), scanMore: !!state.scanCursor };
}
async function previewIn(tx: StaffEmailClient, scope: RequestScope, input: StaffEmailInput, requestKey: string) {
  const actor = await staffEmailActor(tx, scope.userId, scope.organisationId, STAFF_EMAIL_MANAGE, input.facilityId); requireStaffEmailTiming(input);
  const facility = await tx.facility.findFirst({ where: { id: input.facilityId, organisationId: scope.organisationId }, select: { id: true, name: true } }); if (!facility) throw Error("STAFF_EMAIL_FORBIDDEN");
  const recipients = await staffEmailRecipients(tx, scope.organisationId, input.facilityId, input.recipientIds);
  const selectedScope = { ...scope, unrestrictedFacilities: false, facilityIds: [input.facilityId] };
  const sources = await staffOperationalEmailPage(selectedScope, range(input), tx), events = sources.events.filter(event => input.kinds.includes(event.kind));
  const sender = await staffEmailSender(), id = staffEmailPolicyKey(requestKey), policyFingerprint = staffEmailMac([id, scope.organisationId, input.facilityId, input, facility.name, recipients, sender.fingerprint, STAFF_EMAIL_TEMPLATE_VERSION]);
  const examples = events.map(event => { const message = staffEmailRender(event, recipients[0]); return { sourceKey: event.sourceKey, sourceHash: event.sourceHash, at: event.at, subject: message.subject, text: message.text }; });
  const previewFingerprint = staffEmailMac([policyFingerprint, examples, !!sources.nextCursor]);
  return { actor, sender, preview: staffEmailPreview.parse({ requestKey, input, facility: facility.name, sender: sender.label, recipients, examples, moreSourcePages: !!sources.nextCursor, policyFingerprint, previewFingerprint }) };
}
export async function previewStaffEventEmail(scope: RequestScope, input: unknown) {
  const command = staffEmailCommand.parse(input); if (command.action !== "preview") throw Error("STAFF_EMAIL_INVALID");
  return staffEmailTransaction(async tx => (await previewIn(tx, scope, command.input, command.requestKey)).preview);
}
export async function prepareStaffEventEmail(scope: RequestScope, input: unknown) {
  const command = staffEmailCommand.parse(input); if (command.action !== "prepare") throw Error("STAFF_EMAIL_INVALID");
  const id = staffEmailPolicyKey(command.requestKey);
  const run = () => staffEmailTransaction(async tx => {
    await staffEmailActor(tx, scope.userId, scope.organisationId, STAFF_EMAIL_MANAGE, command.input.facilityId); await staffEmailLock(tx, id);
    const old = await tx.configurationProfile.findUnique({ where: { id } });
    if (old) {
      if (old.organisationId !== scope.organisationId || old.facilityId !== command.input.facilityId) throw Error("STAFF_EMAIL_FORBIDDEN");
      const state = staffEmailDecode(old); if (state.kind !== "POLICY" || state.createdById !== scope.userId || staffEmailDigest(state.input) !== staffEmailDigest(command.input)) throw Error("STAFF_EMAIL_REQUEST_CONFLICT");
      return policyView(tx, scope, { row: old, state });
    }
    const { actor, sender, preview } = await previewIn(tx, scope, command.input, command.requestKey); if (preview.previewFingerprint !== command.expectedFingerprint) throw Error("STAFF_EMAIL_SOURCE_CHANGED");
    const state: StaffEmailPolicyState = { kind: "POLICY", version: 1, revision: freshStaffEmailRevision(), requestKey: command.requestKey, input: preview.input, facility: preview.facility, sender: sender.label, senderFingerprint: sender.fingerprint, recipients: preview.recipients, policyFingerprint: preview.policyFingerprint, status: "PENDING_REVIEW", createdById: actor.id, createdByName: actor.name, reviewedById: null, reviewedByName: null, reviewedAt: null, reference: null, scanCursor: null, lastScannedAt: null };
    const row = await staffEmailStore(tx, { id, organisationId: scope.organisationId, facilityId: preview.input.facilityId, domain: STAFF_EMAIL_POLICY_DOMAIN, name: preview.input.label }, state, false);
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: row.facilityId, actorId: scope.userId, action: "staff_email.policy.prepared", entityType: "ConfigurationProfile", entityId: id, after: { policyFingerprint: state.policyFingerprint, recipientCount: state.recipients.length, kinds: state.input.kinds, from: state.input.from, to: state.input.to, notBefore: state.input.notBefore, expires: state.input.expires, status: state.status, sends: 0 } } });
    return policyView(tx, scope, { row, state });
  });
  try { return await run(); } catch (failure) { if (failure && typeof failure === "object" && "code" in failure && failure.code === "P2002") return run(); throw failure; }
}
export async function reviewStaffEventEmail(scope: RequestScope, input: unknown) {
  const command = staffEmailCommand.parse(input); if (command.action !== "review") throw Error("STAFF_EMAIL_INVALID");
  return staffEmailTransaction(async tx => {
    await staffEmailLock(tx, command.id); const value = await staffEmailPolicyRecord(tx, scope.organisationId, command.id), { row, state } = value;
    const actor = await staffEmailActor(tx, scope.userId, scope.organisationId, command.decision === "CANCEL" ? STAFF_EMAIL_MANAGE : STAFF_EMAIL_APPROVE, row.facilityId!);
    if (state.revision !== command.revision) throw Error("STAFF_EMAIL_SOURCE_CHANGED");
    if (command.decision === "CANCEL") { if (!["PENDING_REVIEW", "APPROVED"].includes(state.status)) throw Error("STAFF_EMAIL_IMMUTABLE"); state.status = "CANCELLED"; }
    else {
      if (state.status !== "PENDING_REVIEW") throw Error("STAFF_EMAIL_IMMUTABLE"); if (state.createdById === scope.userId) throw Error("STAFF_EMAIL_SELF_APPROVAL");
      await staffEmailAuthority(tx, row, state); requireStaffEmailTiming(state.input);
      state.status = command.decision === "APPROVE" ? "APPROVED" : "REJECTED"; state.reviewedById = actor.id; state.reviewedByName = actor.name; state.reviewedAt = new Date().toISOString();
    }
    state.reference = command.reference; state.revision = freshStaffEmailRevision();
    const saved = await staffEmailStore(tx, { id: row.id, organisationId: row.organisationId, facilityId: row.facilityId!, domain: row.domain, name: state.input.label }, state, true);
    await tx.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, actorId: scope.userId, action: `staff_email.policy.${command.decision.toLowerCase()}`, entityType: "ConfigurationProfile", entityId: row.id, after: { revision: state.revision, policyFingerprint: state.policyFingerprint, reference: command.reference, status: state.status, sends: 0 } } });
    return policyView(tx, scope, { row: saved, state });
  });
}
export async function evaluateStaffEventEmail(scope: RequestScope, input: unknown, worker = false) {
  const command = staffEmailCommand.parse(input); if (command.action !== "evaluate") throw Error("STAFF_EMAIL_INVALID");
  return staffEmailTransaction(async tx => {
    await staffEmailLock(tx, command.id); const { row, state } = await staffEmailPolicyRecord(tx, scope.organisationId, command.id);
    await staffEmailActor(tx, scope.userId, scope.organisationId, worker ? STAFF_EMAIL_APPROVE : STAFF_EMAIL_MANAGE, row.facilityId!);
    if (state.revision !== command.revision) throw Error("STAFF_EMAIL_SOURCE_CHANGED"); await staffEmailAuthority(tx, row, state, true); requireStaffEmailTiming(state.input);
    const sourceScope = { ...scope, unrestrictedFacilities: false, facilityIds: [row.facilityId!] }, sources = await staffOperationalEmailPage(sourceScope, { ...range(state.input), cursor: state.scanCursor ?? undefined }, tx);
    let prepared = 0, duplicates = 0;
    for (const event of sources.events.filter(event => state.input.kinds.includes(event.kind))) {
      const current = await staffOperationalEmailSource(sourceScope, event.sourceKey, tx); if (!current || staffEmailSourceFingerprint(current) !== staffEmailSourceFingerprint(event) || !withinStaffEmailRange(state.input, current.at)) throw Error("STAFF_EMAIL_SOURCE_CHANGED");
      for (const recipient of state.recipients) {
        const id = staffEmailOutboxKey(row.organisationId, row.facilityId!, event.sourceKey, recipient.id); await staffEmailLock(tx, id);
        const previous = await tx.configurationProfile.findUnique({ where: { id } });
        if (previous) { const prior = staffEmailDecode(previous); if (prior.kind !== "OUTBOX" || previous.organisationId !== row.organisationId || previous.facilityId !== row.facilityId || prior.recipient.id !== recipient.id || prior.sourceKey !== event.sourceKey) throw Error("STAFF_EMAIL_INTEGRITY"); duplicates++; continue; }
        const message = staffEmailRender(current, recipient), value: StaffEmailOutboxState = { kind: "OUTBOX", version: 1, policyId: row.id, policyFingerprint: state.policyFingerprint, status: "HELD_ACTIVATION", sourceKey: current.sourceKey, sourceHash: current.sourceHash, eventAt: current.at, sourceFingerprint: staffEmailSourceFingerprint(current), recipient, message, messageFingerprint: staffEmailDigest(message), attemptedAt: null, acceptedAt: null, failureCode: null };
        await staffEmailStore(tx, { id, organisationId: row.organisationId, facilityId: row.facilityId!, domain: STAFF_EMAIL_OUTBOX_DOMAIN, name: id }, value, false); prepared++;
      }
    }
    state.scanCursor = sources.nextCursor; state.lastScannedAt = new Date().toISOString();
    await staffEmailStore(tx, { id: row.id, organisationId: row.organisationId, facilityId: row.facilityId!, domain: row.domain, name: state.input.label }, state, true);
    await tx.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, actorId: worker ? null : scope.userId, action: "staff_email.outbox.evaluated", entityType: "ConfigurationProfile", entityId: row.id, after: { policyFingerprint: state.policyFingerprint, prepared, duplicates, more: !!sources.nextCursor, worker, sends: 0 } } });
    return { prepared, duplicates, more: !!sources.nextCursor, sends: 0 as const };
  });
}

const cursorSchema = z.object({ kind: z.enum(["POLICY", "OUTBOX"]), at: z.iso.datetime(), id: z.string().max(120), snapshot: z.iso.datetime(), binding: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function cursorBinding(scope: RequestScope, facility: string, policy: string) { return staffEmailDigest([scope.userId, scope.organisationId, scope.unrestrictedFacilities, [...scope.facilityIds].sort(), facility, policy]); }
function readCursor(value: string, kind: "POLICY" | "OUTBOX", binding: string) {
  if (!value) return null;
  try { const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); if (parsed.kind !== kind || parsed.binding !== binding || parsed.at > parsed.snapshot || new Date(parsed.snapshot).getTime() > Date.now() + 30000) throw Error(); return parsed; } catch { throw Error("STAFF_EMAIL_CURSOR_INVALID"); }
}
export async function readStaffEventEmails(incoming: RequestScope, input: unknown): Promise<StaffEmailRead> {
  const query = staffEmailQuery.parse(input), scope = await staffEmailScope(db, incoming), where = { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) };
  const facilities = await db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (query.facilityId && !facilities.some(facility => facility.id === query.facilityId)) throw Error("STAFF_EMAIL_FORBIDDEN");
  const actor = await staffEmailActor(db, scope.userId, scope.organisationId), staff = query.facilityId ? await staffEmailRecipients(db, scope.organisationId, query.facilityId) : [];
  const binding = cursorBinding(scope, query.facilityId, query.policyId);
  async function page(domain: string, value: string, kind: "POLICY" | "OUTBOX") {
    const cursor = readCursor(value, kind, binding), snapshot = cursor?.snapshot ?? new Date().toISOString();
    const filter = { ...where, domain, ...(query.facilityId ? { facilityId: query.facilityId } : {}), ...(kind === "OUTBOX" ? { config: { path: ["policyId"], equals: query.policyId } } : {}), createdAt: { lte: new Date(snapshot) } };
    if (cursor && !await db.configurationProfile.findFirst({ where: { AND: [filter, { id: cursor.id, createdAt: new Date(cursor.at) }] }, select: { id: true } })) throw Error("STAFF_EMAIL_CURSOR_INVALID");
    const records = await db.configurationProfile.findMany({ where: { AND: [filter, ...(cursor ? [{ OR: [{ createdAt: { lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), id: { lt: cursor.id } }] }] : [])] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26 });
    const rows = records.slice(0, 25), last = rows.at(-1); return { rows, next: records.length > 25 && last ? Buffer.from(JSON.stringify({ kind, at: last.createdAt.toISOString(), id: last.id, snapshot, binding })).toString("base64url") : null };
  }
  const policies = await page(STAFF_EMAIL_POLICY_DOMAIN, query.cursor, "POLICY"), selected = query.policyId ? await staffEmailPolicyRecord(db, scope.organisationId, query.policyId) : null;
  if (selected) { await staffEmailActor(db, scope.userId, scope.organisationId, STAFF_EMAIL_VIEW, selected.row.facilityId!); if (query.facilityId && selected.row.facilityId !== query.facilityId) throw Error("STAFF_EMAIL_FORBIDDEN"); }
  if (!selected && query.outboxCursor) throw Error("STAFF_EMAIL_CURSOR_INVALID");
  const outbox = selected ? await page(STAFF_EMAIL_OUTBOX_DOMAIN, query.outboxCursor, "OUTBOX") : { rows: [], next: null };
  return { facilities, staff, selectedFacilityId: query.facilityId, selectedPolicyId: query.policyId, selectedPolicy: selected ? await policyView(db, scope, selected) : null,
    capabilities: { canManage: currentRoleAccess(actor.roleAssignments, STAFF_EMAIL_MANAGE, query.facilityId || undefined).allowed, canApprove: currentRoleAccess(actor.roleAssignments, STAFF_EMAIL_APPROVE, query.facilityId || undefined).allowed }, sendingEnabled: process.env.STAFF_EVENT_EMAIL_ENABLED === "true",
    policies: await Promise.all(policies.rows.map(async row => { const state = staffEmailDecode(row); if (state.kind !== "POLICY") throw Error("STAFF_EMAIL_INTEGRITY"); return policyView(db, scope, { row, state }); })), nextCursor: policies.next,
    outbox: outbox.rows.map(row => { const state = staffEmailDecode(row); if (state.kind !== "OUTBOX" || state.policyId !== query.policyId) throw Error("STAFF_EMAIL_INTEGRITY"); return { id: row.id, policyId: state.policyId, status: state.status, sourceKey: state.sourceKey, eventAt: state.eventAt, queuedAt: row.createdAt.toISOString(), recipient: state.recipient, subject: state.message.subject, text: state.message.text, failureCode: state.failureCode, attemptedAt: state.attemptedAt, acceptedAt: state.acceptedAt }; }), nextOutboxCursor: outbox.next };
}
