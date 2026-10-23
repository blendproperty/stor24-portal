import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { currentRoleAccess } from "@/lib/current-role-access";
import { facilityWhere, requireFacility, type RequestScope } from "@/lib/scope";
import { scheduledOccurrences, scheduledWorkPurposes, scheduledWorkSchema, type ScheduledWorkInput } from "@/lib/scheduled-work-policy";
import type { Prisma } from "@/generated/prisma/client";

const include = { assignee: { select: { id: true, name: true } }, unit: { select: { id: true, number: true } }, facility: { select: { id: true, name: true } } };
async function validateLinks(tx: Prisma.TransactionClient, scope: RequestScope, input: ScheduledWorkInput) {
  const staff = await tx.user.findFirst({ where: { id: input.assigneeId, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  if (!staff || !currentRoleAccess(staff.roleAssignments, "operations.view", input.facilityId).allowed) throw new Error("FORBIDDEN");
  if (input.unitId && !await tx.unit.count({ where: { id: input.unitId, facilityId: input.facilityId, combinedIntoUnitId: null } })) throw new Error("FORBIDDEN");
}

export async function createScheduledWork(scope: RequestScope, raw: ScheduledWorkInput, requestKey: string) {
  const input = scheduledWorkSchema.parse(raw);
  const facility = await requireFacility(scope, input.facilityId);
  if (facility.timezone !== "Africa/Johannesburg") throw new Error("SCHEDULE_TIMEZONE_UNSUPPORTED");
  const hash = createHash("sha256").update(JSON.stringify({ actor: scope.userId, input })).digest("hex");
  const occurrences = scheduledOccurrences(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scheduled-work:${requestKey}`}, 0))`;
    const existing = await tx.task.findFirst({ where: { requestKey: `scheduled-work:${requestKey}:0` } });
    if (existing) {
      if (existing.organisationId !== scope.organisationId || existing.createdById !== scope.userId || existing.requestHash !== hash) throw new Error("CONFLICT");
      return { id: existing.id, count: occurrences.length };
    }
    await validateLinks(tx, scope, input);
    const { repeat, occurrences: count, ...values } = input;
    let firstId = "";
    for (const [index, dates] of occurrences.entries()) {
      const task = await tx.task.create({ data: { ...values, ...dates, dueAt: dates.endAt, organisationId: scope.organisationId, createdById: scope.userId, requestKey: `scheduled-work:${requestKey}:${index}`, requestHash: hash } });
      if (!index) firstId = task.id;
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, facilityId: input.facilityId, action: "scheduledWork.create", entityType: "task", entityId: task.id, after: JSON.parse(JSON.stringify({ task, repeat, count, series: requestKey })) } });
    }
    return { id: firstId, count: occurrences.length };
  }, { timeout: 30_000 });
}

export async function changeScheduledWork(scope: RequestScope, id: string, version: string, raw: ScheduledWorkInput, status: "OPEN" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | "CANCELLED") {
  const input = scheduledWorkSchema.parse(raw);
  const { repeat, occurrences, ...values } = input;
  if (repeat !== "ONCE" || occurrences !== 1) throw new Error("CONFLICT");
  const facility = await requireFacility(scope, input.facilityId);
  if (facility.timezone !== "Africa/Johannesburg") throw new Error("SCHEDULE_TIMEZONE_UNSUPPORTED");
  return db.$transaction(async tx => {
    const before = await tx.task.findFirst({ where: { id, organisationId: scope.organisationId, facilityId: input.facilityId, purpose: { in: [...scheduledWorkPurposes] }, facility: facilityWhere(scope) } });
    if (!before) throw new Error("NOT_FOUND");
    if (["COMPLETED", "CANCELLED"].includes(before.status)) throw new Error("SCHEDULE_CLOSED");
    await validateLinks(tx, scope, input);
    const saved = await tx.task.updateMany({ where: { id, updatedAt: new Date(version), status: before.status }, data: { ...values, startAt: new Date(input.startAt), endAt: new Date(input.endAt), dueAt: new Date(input.endAt), status, completedAt: status === "COMPLETED" ? new Date() : null, updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)) } });
    if (saved.count !== 1) throw new Error("CONFLICT");
    const task = await tx.task.findUniqueOrThrow({ where: { id }, include });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, facilityId: input.facilityId, action: "scheduledWork.update", entityType: "task", entityId: id, before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(task)) } });
    return task;
  });
}

export async function scheduledWorkPage(scope: RequestScope, start: Date, end: Date) {
  const facilities = await db.facility.findMany({ where: { ...facilityWhere(scope), active: true }, select: { id: true, name: true, timezone: true, units: { where: { combinedIntoUnitId: null }, select: { id: true, number: true }, orderBy: { number: "asc" } } }, orderBy: { name: "asc" } });
  const [tasks, users] = await Promise.all([
    db.task.findMany({ where: { organisationId: scope.organisationId, facility: facilityWhere(scope), purpose: { in: [...scheduledWorkPurposes] }, startAt: { gte: start, lt: end } }, include, orderBy: [{ startAt: "asc" }, { id: "asc" }], take: 501 }),
    db.user.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { id: true, name: true, roleAssignments: { select: { facilityId: true, role: { select: { name: true, permissions: true } } } } } }),
  ]);
  return { tasks: tasks.slice(0, 500), truncated: tasks.length > 500, facilities, staff: users.flatMap(u => { const facilityIds = facilities.filter(f => currentRoleAccess(u.roleAssignments, "operations.view", f.id).allowed).map(f => f.id); return facilityIds.length ? [{ id: u.id, name: u.name, facilityIds }] : []; }) };
}
