import { createHash } from "node:crypto";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { currentRoleAccess } from "./current-role-access";
import { facilityWhere, type RequestScope } from "./scope";
import { CHECKLIST_PURPOSE, checklistCreateSchema, checklistChangeSchema, checklistRecordSchema, checklistTemplates, checklistDates, checklistRows, validateChecklistSubmission, type ChecklistCreate, type ChecklistChange, type ChecklistRow } from "./operational-checklist-policy";

type Client = Prisma.TransactionClient;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const summarySelect = { id: true, title: true, facilityId: true, assigneeId: true, coverId: true, status: true, startAt: true, dueAt: true, completedAt: true, updatedAt: true, facility: { select: { name: true } }, assignee: { select: { name: true } }, cover: { select: { name: true } } } as const;

async function staff(tx: Client, scope: RequestScope, id: string, facilityId: string, permission = "operations.view") {
  const user = await tx.user.findFirst({ where: { id, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  if (!user || !["operations.view", permission].every(p => currentRoleAccess(user.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), p, facilityId).allowed)) throw new Error("FORBIDDEN");
  return user;
}
async function assignments(tx: Client, scope: RequestScope, input: { assigneeId: string; coverId: string | null; reviewerId: string; facilityId: string }) {
  if (input.assigneeId === input.reviewerId || input.coverId === input.reviewerId || input.coverId === input.assigneeId) throw new Error("CHECKLIST_REVIEWER_REQUIRED");
  await staff(tx, scope, input.assigneeId, input.facilityId);
  if (input.coverId) await staff(tx, scope, input.coverId, input.facilityId);
  await staff(tx, scope, input.reviewerId, input.facilityId, "operations.manage");
}
async function snapshot(tx: Client, scope: RequestScope, facilityId: string) {
  const units = await tx.unit.findMany({ where: { facilityId, facility: facilityWhere(scope), combinedIntoUnitId: null }, select: { id: true, number: true, status: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, endDate: null }, select: { tenancy: { select: { facilityId: true, status: true, customer: { select: { organisationId: true } } } } } } }, orderBy: { number: "asc" }, take: 1501 });
  if (units.length > 1500) throw new Error("CHECKLIST_LIMIT");
  const overlocks = await tx.task.findMany({ where: { organisationId: scope.organisationId, facilityId, purpose: "PHYSICAL_OVERLOCK", status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { unitId: true } });
  const rows: ChecklistRow[] = units.sort((a,b) => a.number.localeCompare(b.number, "en", { numeric: true })).map(u => ({
    id: u.id, label: `Unit ${u.number}`, expected: u.status === "OCCUPIED" && u.occupancies.length === 1 && u.occupancies.every(o => o.tenancy.facilityId === facilityId && o.tenancy.customer.organisationId === scope.organisationId && ["ACTIVE", "NOTICE_GIVEN"].includes(o.tenancy.status)) ? "OCCUPIED" : !u.occupancies.length && u.status === "AVAILABLE" ? "VACANT" : "REVIEW",
    state: "PENDING", notes: "", evidence: "", lockCount: null, overlockTask: overlocks.some(t => t.unitId === u.id),
  }));
  return { rows, sourceHash: hash(rows) };
}

export async function createOperationalChecklist(scope: RequestScope, raw: ChecklistCreate) {
  const input = checklistCreateSchema.parse(raw), dates = checklistDates(input), requestHash = hash({ actor: scope.userId, input });
  return db.$transaction(async tx => {
    const facility = await tx.facility.findFirst({ where: { ...facilityWhere(scope), id: input.facilityId, active: true } });
    if (!facility) throw new Error("FORBIDDEN");
    if (facility.timezone !== "Africa/Johannesburg") throw new Error("CHECKLIST_TIMEZONE");
    await staff(tx, scope, scope.userId, facility.id, "operations.manage");
    await assignments(tx, scope, input);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`operational-checklist:${input.requestKey}`}, 0))`;
    const existing = await tx.task.findUnique({ where: { requestKey: `operational-checklist:${input.requestKey}:0` } });
    if (existing) {
      if (existing.organisationId !== scope.organisationId || existing.createdById !== scope.userId || existing.requestHash !== requestHash) throw new Error("CONFLICT");
      return { id: existing.id, count: dates.length };
    }
    let id = "";
    for (const [index, date] of dates.entries()) {
      const operationalChecklist = checklistRecordSchema.parse({ version: 1, template: input.template, reviewerId: input.reviewerId, rows: [], sourceAt: null, sourceHash: null, comparisonReference: "", summary: "", submittedBy: null, submittedAt: null, reviewNote: "", reviewedBy: null, reviewedAt: null });
      const task = await tx.task.create({ data: { organisationId: scope.organisationId, facilityId: facility.id, createdById: scope.userId, assigneeId: input.assigneeId, coverId: input.coverId, purpose: CHECKLIST_PURPOSE, title: checklistTemplates[input.template].name, ...date, dueAt: date.endAt, operationalChecklist: json(operationalChecklist), requestKey: `operational-checklist:${input.requestKey}:${index}`, requestHash } });
      if (!index) id = task.id;
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: facility.id, actorId: scope.userId, action: "operationalChecklist.create", entityType: "Task", entityId: task.id, after: json(task) } });
    }
    return { id, count: dates.length };
  }, { timeout: 30000 });
}

export async function changeOperationalChecklist(scope: RequestScope, raw: ChecklistChange, now = new Date()) {
  const input = checklistChangeSchema.parse(raw);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id"=${input.id} AND "organisationId"=${scope.organisationId} FOR UPDATE`;
    const before = await tx.task.findFirst({ where: { id: input.id, organisationId: scope.organisationId, facility: facilityWhere(scope), purpose: CHECKLIST_PURPOSE } });
    if (!before?.facilityId) throw new Error("NOT_FOUND");
    const actor = await staff(tx, scope, scope.userId, before.facilityId);
    const manager = currentRoleAccess(actor.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), "operations.manage", before.facilityId).allowed;
    if (before.updatedAt.toISOString() !== input.expectedUpdatedAt || ["COMPLETED", "CANCELLED"].includes(before.status)) throw new Error("CONFLICT");
    const record = checklistRecordSchema.parse(before.operationalChecklist);
    let status = before.status;
    const data: Prisma.TaskUncheckedUpdateManyInput = {};
    if (["APPROVE", "RETURN", "ASSIGN", "CANCEL"].includes(input.action)) {
      if (!manager) throw new Error("FORBIDDEN");
    } else if (scope.userId !== before.assigneeId && scope.userId !== before.coverId) throw new Error("FORBIDDEN");
    if (input.action === "START" || input.action === "RESTART") {
      if (input.action === "START" ? before.status !== "OPEN" : before.status !== "IN_PROGRESS") throw new Error("CONFLICT");
      if (!before.startAt || before.startAt > now) throw new Error("CHECKLIST_NOT_DUE");
      const source = record.template === "PADLOCK" ? await snapshot(tx, scope, before.facilityId) : { rows: checklistRows(record.template, before.startAt), sourceHash: null };
      if (!source.rows.length) throw new Error("CHECKLIST_EMPTY");
      Object.assign(record, source, { sourceAt: now.toISOString(), summary: "", comparisonReference: "", submittedBy: null, submittedAt: null });
      status = "IN_PROGRESS";
    } else if (input.action === "SAVE" || input.action === "SUBMIT") {
      if (before.status !== "IN_PROGRESS" || !record.sourceAt) throw new Error("CONFLICT");
      if (new Set(input.rows.map(r => r.id)).size !== record.rows.length || input.rows.length !== record.rows.length || input.rows.some(r => !record.rows.some(saved => saved.id === r.id))) throw new Error("CONFLICT");
      record.rows = record.rows.map(row => {
        const result = input.rows.find(r => r.id === row.id)!;
        const allowed = record.template === "PADLOCK" ? ["PENDING", "VACANT", "OCCUPIED", "OVERLOCKED"] : ["PENDING", "PASS", "ISSUE", "NA"];
        if (!allowed.includes(result.state)) throw new Error("CHECKLIST_INCOMPLETE");
        return { ...row, ...result };
      });
      record.summary = input.summary; record.comparisonReference = input.comparisonReference;
      if (input.action === "SUBMIT") {
        validateChecklistSubmission(record);
        if (record.template === "PADLOCK" && (await snapshot(tx, scope, before.facilityId)).sourceHash !== record.sourceHash) throw new Error("CHECKLIST_SOURCE_CHANGED");
        record.submittedBy = scope.userId; record.submittedAt = now.toISOString(); status = "WAITING";
      }
    } else if (input.action === "APPROVE" || input.action === "RETURN") {
      if (before.status !== "WAITING" || record.reviewerId !== scope.userId || record.submittedBy === scope.userId) throw new Error("FORBIDDEN");
      validateChecklistSubmission(record);
      record.reviewNote = input.note;
      if (input.action === "APPROVE") {
        record.reviewedBy = scope.userId; record.reviewedAt = now.toISOString(); status = "COMPLETED";
      } else { status = "IN_PROGRESS"; record.submittedAt = null; record.submittedBy = null; }
    } else if (input.action === "ASSIGN") {
      await assignments(tx, scope, { ...input, facilityId: before.facilityId });
      if (input.reviewerId === record.submittedBy) throw new Error("CHECKLIST_REVIEWER_REQUIRED");
      record.reviewerId = input.reviewerId; data.assigneeId = input.assigneeId; data.coverId = input.coverId;
    } else if (input.action === "CANCEL") status = "CANCELLED";
    const saved = await tx.task.updateMany({ where: { id: before.id, updatedAt: before.updatedAt, status: before.status }, data: { ...data, status, operationalChecklist: json(record), completedAt: status === "COMPLETED" ? now : null, updatedAt: new Date(Math.max(now.getTime(), before.updatedAt.getTime() + 1)) } });
    if (saved.count !== 1) throw new Error("CONFLICT");
    const after = await tx.task.findUniqueOrThrow({ where: { id: before.id } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: before.facilityId, actorId: scope.userId, action: `operationalChecklist.${input.action.toLowerCase()}`, entityType: "Task", entityId: before.id, before: json(before), after: json(after) } });
    return after.id;
  }, { timeout: 30000 });
}

export async function operationalChecklists(scope: RequestScope, query: { facilityId?: string; id?: string; closed?: boolean; cursor?: string }) {
  return db.$transaction(async tx => {
    const users = await tx.user.findMany({ where: { organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } }, take: 1001 });
    if (users.length > 1000) throw new Error("CHECKLIST_LIMIT");
    const actor = users.find(u => u.id === scope.userId);
    if (!actor) throw new Error("FORBIDDEN");
    const access = (user: typeof actor, permission: string, facilityId: string) => ["operations.view", permission].every(p => currentRoleAccess(user.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), p, facilityId).allowed);
    const facilities = (await tx.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } })).filter(f => access(actor, "operations.view", f.id));
    if (query.facilityId && !facilities.some(f => f.id === query.facilityId)) throw new Error("FORBIDDEN");
    const base = { organisationId: scope.organisationId, facilityId: { in: facilities.filter(f => !query.facilityId || f.id === query.facilityId).map(f => f.id) }, purpose: CHECKLIST_PURPOSE };
    if (query.id) {
      const task = await tx.task.findFirst({ where: { ...base, id: query.id }, select: { ...summarySelect, operationalChecklist: true } });
      if (!task) throw new Error("NOT_FOUND");
      return { task: { ...task, operationalChecklist: checklistRecordSchema.parse(task.operationalChecklist) }, actorId: scope.userId, facilities, managerFacilityIds: facilities.filter(f => access(actor, "operations.manage", f.id)).map(f => f.id), staff: users.map(u => ({ id: u.id, name: u.name, facilityIds: facilities.filter(f => access(u, "operations.view", f.id)).map(f => f.id), reviewerFacilityIds: facilities.filter(f => access(u, "operations.manage", f.id)).map(f => f.id) })).filter(u => u.facilityIds.length > 0) };
    }
    const where = { ...base, status: query.closed ? { in: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] } : { notIn: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] } };
    if (query.cursor && !await tx.task.count({ where: { ...where, id: query.cursor } })) throw new Error("CONFLICT");
    const tasks = await tx.task.findMany({ where, select: summarySelect, orderBy: [{ dueAt: "asc" }, { id: "asc" }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: 51 });
    return { tasks: tasks.slice(0, 50), nextCursor: tasks.length > 50 ? tasks[49].id : null, actorId: scope.userId, facilities, managerFacilityIds: facilities.filter(f => access(actor, "operations.manage", f.id)).map(f => f.id), staff: users.map(u => ({ id: u.id, name: u.name, facilityIds: facilities.filter(f => access(u, "operations.view", f.id)).map(f => f.id), reviewerFacilityIds: facilities.filter(f => access(u, "operations.manage", f.id)).map(f => f.id) })).filter(u => u.facilityIds.length > 0) };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
