import { createHash } from "node:crypto";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { currentRoleAccess } from "./current-role-access";
import { facilityWhere, type RequestScope } from "./scope";
import { floorIsOperational } from "./floor-availability";
import { CHECKLIST_PURPOSE, checklistCreateSchema, checklistChangeSchema, checklistNeedsTrolleyCount, checklistRecordSchema, checklistRouteResultReady, checklistTemplates, checklistDates, checklistRows, checklistUsesRoute, checklistWeek, validateChecklistSubmission, type ChecklistCreate, type ChecklistChange, type ChecklistRow, type ChecklistTemplate } from "./operational-checklist-policy";

type Client = Prisma.TransactionClient;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const summarySelect = { id: true, title: true, facilityId: true, assigneeId: true, coverId: true, status: true, startAt: true, dueAt: true, completedAt: true, updatedAt: true, facility: { select: { name: true } }, assignee: { select: { name: true } }, cover: { select: { name: true } } } as const;

async function staff(tx: Client, scope: RequestScope, id: string, facilityId: string, permission = "operations.view") {
  const user = await tx.user.findFirst({ where: { id, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  if (!user || !["operations.view", permission].every(p => currentRoleAccess(user.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), p, facilityId).allowed)) throw new Error("FORBIDDEN");
  return user;
}
// The built-in CSO grant includes operations.manage for ordinary operations work.
// A separate role must supply the reviewer grant for padlock counts.
function canReviewPadlocks(user: Awaited<ReturnType<typeof staff>>, organisationId: string, facilityId: string) {
  const roles = user.roleAssignments.filter(a => a.role.organisationId === organisationId && a.role.name !== "Customer service operator");
  return currentRoleAccess(roles, "operations.manage", facilityId).allowed;
}

async function assignments(tx: Client, scope: RequestScope, input: { assigneeId: string; coverId: string | null; reviewerId: string; facilityId: string; template: ChecklistTemplate }) {
  if (input.assigneeId === input.reviewerId || input.coverId === input.reviewerId || input.coverId === input.assigneeId) throw new Error("CHECKLIST_REVIEWER_REQUIRED");
  await staff(tx, scope, input.assigneeId, input.facilityId);
  if (input.coverId) await staff(tx, scope, input.coverId, input.facilityId);
  const reviewer = await staff(tx, scope, input.reviewerId, input.facilityId, "operations.manage");
  if (input.template === "PADLOCK" && !canReviewPadlocks(reviewer, scope.organisationId, input.facilityId)) throw new Error("CHECKLIST_PADLOCK_REVIEWER_REQUIRED");
}
async function snapshot(tx: Client, scope: RequestScope, facilityId: string) {
  const units = await tx.unit.findMany({ where: { facilityId, facility: facilityWhere(scope), combinedIntoUnitId: null }, select: { id: true, number: true, status: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, endDate: null }, select: { tenancy: { select: { facilityId: true, status: true, customer: { select: { organisationId: true } } } } } } }, orderBy: { number: "asc" }, take: 1501 });
  if (units.length > 1500) throw new Error("CHECKLIST_LIMIT");
  const overlocks = new Set((await tx.task.findMany({ where: { organisationId: scope.organisationId, facilityId, purpose: "PHYSICAL_OVERLOCK", status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { unitId: true } })).map(task => task.unitId));
  const rows: ChecklistRow[] = units.sort((a,b) => a.number.localeCompare(b.number, "en", { numeric: true })).map(u => ({
    id: u.id, label: `Unit ${u.number}`, expected: u.status === "OCCUPIED" && u.occupancies.length === 1 && u.occupancies.every(o => o.tenancy.facilityId === facilityId && o.tenancy.customer.organisationId === scope.organisationId && ["ACTIVE", "NOTICE_GIVEN"].includes(o.tenancy.status)) ? "OCCUPIED" : !u.occupancies.length && u.status === "AVAILABLE" ? "VACANT" : "REVIEW",
    state: "PENDING", notes: "", evidence: "", lockCount: null, overlockTask: overlocks.has(u.id),
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
    let observationAudit: { before: Prisma.InputJsonValue; after: Prisma.InputJsonValue } | undefined;
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
    } else if (input.action === "OBSERVE") {
      if ((!checklistUsesRoute(record.template) && record.template !== "PADLOCK") || before.status !== "IN_PROGRESS" || !record.sourceAt) throw new Error("CONFLICT");
      const index = record.rows.findIndex(row => row.id === input.row.id);
      if (index < 0) throw new Error("CONFLICT");
      const previous = record.rows[index], result = { ...previous, ...input.row };
      if (record.template === "PADLOCK") {
        if (!["VACANT", "OCCUPIED", "OVERLOCKED"].includes(result.state) || result.lockCount === null) throw new Error("CHECKLIST_INCOMPLETE");
      } else if (!checklistRouteResultReady(result) || input.row.comparisonDiscrepancy !== undefined ||
        (!checklistNeedsTrolleyCount(result) && result.lockCount !== previous.lockCount)) {
        throw new Error("CHECKLIST_INCOMPLETE");
      }
      observationAudit = {
        before: json({ row: previous, summary: record.summary, comparisonReference: record.comparisonReference }),
        after: json({ row: result, summary: input.summary, comparisonReference: input.comparisonReference }),
      };
      record.rows[index] = result;
      record.summary = input.summary;
      record.comparisonReference = input.comparisonReference;
    } else if (input.action === "SAVE" || input.action === "SUBMIT") {
      if (before.status !== "IN_PROGRESS" || !record.sourceAt) throw new Error("CONFLICT");
      const byId = new Map(input.rows.map(row => [row.id, row]));
      if (byId.size !== record.rows.length || input.rows.length !== record.rows.length) throw new Error("CONFLICT");
      record.rows = record.rows.map(row => {
        const result = byId.get(row.id);
        if (!result) throw new Error("CONFLICT");
        if (checklistUsesRoute(record.template) && (result.state !== row.state || result.notes !== row.notes ||
          result.evidence !== row.evidence || result.lockCount !== row.lockCount)) throw new Error("CHECKLIST_SAVE_EACH");
        const allowed = record.template === "PADLOCK" ? ["PENDING", "VACANT", "OCCUPIED", "OVERLOCKED"] : ["PENDING", "PASS", "ISSUE", "NA"];
        if (!allowed.includes(result.state) || (record.template !== "PADLOCK" && result.comparisonDiscrepancy !== undefined)) throw new Error("CHECKLIST_INCOMPLETE");
        return { ...row, ...result };
      });
      record.summary = input.summary; record.comparisonReference = input.comparisonReference;
      if (input.action === "SUBMIT") {
        validateChecklistSubmission(record);
        if (record.template === "PADLOCK" && (await snapshot(tx, scope, before.facilityId)).sourceHash !== record.sourceHash) throw new Error("CHECKLIST_SOURCE_CHANGED");
        record.submittedBy = scope.userId; record.submittedAt = now.toISOString(); status = "WAITING";
      }
    } else if (input.action === "APPROVE" || input.action === "RETURN") {
      if (record.template === "PADLOCK" && !canReviewPadlocks(actor, scope.organisationId, before.facilityId)) throw new Error("FORBIDDEN");
      if (before.status !== "WAITING" || record.reviewerId !== scope.userId || record.submittedBy === scope.userId) throw new Error("FORBIDDEN");
      validateChecklistSubmission(record);
      record.reviewNote = input.note;
      if (input.action === "APPROVE") {
        record.reviewedBy = scope.userId; record.reviewedAt = now.toISOString(); status = "COMPLETED";
      } else { status = "IN_PROGRESS"; record.submittedAt = null; record.submittedBy = null; }
    } else if (input.action === "ASSIGN") {
      await assignments(tx, scope, { ...input, facilityId: before.facilityId, template: record.template });
      if (input.reviewerId === record.submittedBy) throw new Error("CHECKLIST_REVIEWER_REQUIRED");
      record.reviewerId = input.reviewerId; data.assigneeId = input.assigneeId; data.coverId = input.coverId;
    } else if (input.action === "CANCEL") status = "CANCELLED";
    const saved = await tx.task.updateMany({ where: { id: before.id, updatedAt: before.updatedAt, status: before.status }, data: { ...data, status, operationalChecklist: json(record), completedAt: status === "COMPLETED" ? now : null, updatedAt: new Date(Math.max(now.getTime(), before.updatedAt.getTime() + 1)) } });
    if (saved.count !== 1) throw new Error("CONFLICT");
    const audit = observationAudit ?? { before: json(before), after: json(await tx.task.findUniqueOrThrow({ where: { id: before.id } })) };
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: before.facilityId, actorId: scope.userId, action: `operationalChecklist.${input.action.toLowerCase()}`, entityType: "Task", entityId: before.id, ...audit } });
    return before.id;
  }, { timeout: 30000 });
}

export async function padlockWalkthrough(scope: RequestScope, id: string) {
  return db.$transaction(async tx => {
    const task = await tx.task.findFirst({
      where: {
        id, organisationId: scope.organisationId, facility: facilityWhere(scope), purpose: CHECKLIST_PURPOSE,
        status: { not: "CANCELLED" }, operationalChecklist: { path: ["template"], equals: "PADLOCK" },
      },
      select: { facilityId: true, facility: { select: { name: true } }, assigneeId: true, coverId: true, dueAt: true, operationalChecklist: true },
    });
    if (!task?.facilityId || !task.facility) throw new Error("NOT_FOUND");
    const actor = await staff(tx, scope, scope.userId, task.facilityId);
    if (scope.userId !== task.assigneeId && scope.userId !== task.coverId && !canReviewPadlocks(actor, scope.organisationId, task.facilityId)) throw new Error("FORBIDDEN");
    const record = checklistRecordSchema.parse(task.operationalChecklist);
    const rows = record.sourceAt ? record.rows : (await snapshot(tx, scope, task.facilityId)).rows;
    return { store: task.facility.name, dueAt: task.dueAt, rows };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}

export async function operationalChecklists(scope: RequestScope, query: { facilityId?: string; id?: string; closed?: boolean; cursor?: string; kind?: "checklists" | "padlocks" }) {
  return db.$transaction(async tx => {
    const users = await tx.user.findMany({ where: { organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } }, take: 1001 });
    if (users.length > 1000) throw new Error("CHECKLIST_LIMIT");
    const actor = users.find(u => u.id === scope.userId);
    if (!actor) throw new Error("FORBIDDEN");
    const access = (user: typeof actor, permission: string, facilityId: string) => ["operations.view", permission].every(p => currentRoleAccess(user.roleAssignments.filter(a => a.role.organisationId === scope.organisationId), p, facilityId).allowed);
    const facilities = (await tx.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } })).filter(f => access(actor, "operations.view", f.id));
    if (query.facilityId && !facilities.some(f => f.id === query.facilityId)) throw new Error("FORBIDDEN");
    const base = { organisationId: scope.organisationId, facilityId: { in: facilities.filter(f => !query.facilityId || f.id === query.facilityId).map(f => f.id) }, purpose: CHECKLIST_PURPOSE };
    const metadata = {
      actorId: scope.userId,
      facilities,
      managerFacilityIds: facilities.filter(f => access(actor, "operations.manage", f.id)).map(f => f.id),
      staff: users.map(user => ({
        id: user.id, name: user.name,
        facilityIds: facilities.filter(f => access(user, "operations.view", f.id)).map(f => f.id),
        reviewerFacilityIds: facilities.filter(f => access(user, "operations.manage", f.id)).map(f => f.id),
        padlockReviewerFacilityIds: facilities.filter(f => access(user, "operations.manage", f.id) && canReviewPadlocks(user, scope.organisationId, f.id)).map(f => f.id),
      })).filter(user => user.facilityIds.length > 0),
    };
    if (query.id) {
      const task = await tx.task.findFirst({ where: { ...base, id: query.id }, select: { ...summarySelect, operationalChecklist: true } });
      if (!task) throw new Error("NOT_FOUND");
      const record = checklistRecordSchema.parse(task.operationalChecklist);
      if (record.template === "PADLOCK" && task.facilityId) {
        const facilityId = task.facilityId;
        const layout = await tx.facility.findFirstOrThrow({
          where: { id: facilityId, organisationId: scope.organisationId },
          select: { closedFloors: true, maps: {
            orderBy: { name: "asc" },
            select: { id: true, name: true, width: true, height: true, elements: {
              orderBy: { sortOrder: "asc" },
              select: { id: true, type: true, x: true, y: true, width: true, height: true, rotation: true, label: true, unit: { select: { id: true, facilityId: true } } },
            } },
          } },
        });
        const units = task.status === "OPEN" ? (await tx.unit.findMany({
          where: { facilityId, combinedIntoUnitId: null }, select: { id: true, number: true }, take: 1501,
        })).sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true })).map(unit => ({ id: unit.id, label: `Unit ${unit.number}` })) : [];
        const floors = layout.maps.map(map => ({
          ...map, operational: floorIsOperational(map.name, layout.closedFloors),
          elements: map.elements.map(({ unit, ...element }) => ({
            ...element, unitId: element.type === "UNIT" && unit?.facilityId === facilityId ? unit.id : null,
          })),
        }));
        return { ...metadata, task: { ...task, operationalChecklist: record }, padlockMap: { units, floors }, week: undefined, tasks: undefined, nextCursor: undefined };
      }
      const week = [];
      if (record.template !== "PADLOCK" && task.startAt) {
        const days = checklistWeek(task.startAt);
        for (const [index, date] of days.slice(0, 7).entries()) {
          if (task.startAt >= date && task.startAt < days[index + 1]) continue;
          // One saved run per date in the grid. Any additional runs remain available in the queue.
          const sibling = await tx.task.findFirst({
            where: { ...base, facilityId: task.facilityId, startAt: { gte: date, lt: days[index + 1] },
              status: { not: "CANCELLED" }, operationalChecklist: { path: ["template"], equals: record.template } },
            orderBy: [{ startAt: "asc" }, { id: "asc" }],
            select: { id: true, assignee: { select: { name: true } }, operationalChecklist: true },
          });
          if (sibling) {
            const saved = checklistRecordSchema.parse(sibling.operationalChecklist);
            week.push({ id: sibling.id, day: index, name: sibling.assignee?.name ?? null,
              rows: saved.rows.length ? saved.rows : checklistRows(record.template, date) });
          }
        }
      }
      return { ...metadata, task: { ...task, operationalChecklist: record }, week, tasks: undefined, nextCursor: undefined };
    }
    const padlockTemplate = { operationalChecklist: { path: ["template"], equals: "PADLOCK" } };
    const where: Prisma.TaskWhereInput = {
      ...base,
      ...(query.kind === "padlocks" ? padlockTemplate : query.kind === "checklists" ? { NOT: padlockTemplate } : {}),
      status: query.closed ? { in: ["COMPLETED", "CANCELLED"] } : { notIn: ["COMPLETED", "CANCELLED"] },
    };
    if (query.cursor && !await tx.task.count({ where: { ...where, id: query.cursor } })) throw new Error("CONFLICT");
    const tasks = await tx.task.findMany({ where, select: summarySelect, orderBy: [{ dueAt: "asc" }, { id: "asc" }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: 51 });
    return { ...metadata, week: undefined, tasks: tasks.slice(0, 50), nextCursor: tasks.length > 50 ? tasks[49].id : null };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
