import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { currentRoleAccess } from "@/lib/current-role-access";
import { customerNoteFacilities } from "@/lib/customer-history-service";
import { leasingCustomerWhere } from "@/lib/leasing-service";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { staffFollowupSchema, staffFollowupChangeSchema, staffFollowupViewSchema, followupDayEnd, type StaffFollowupView } from "@/lib/staff-followup-policy";

type Client = Prisma.TransactionClient;
const staffSelect = { id: true, name: true } as const;
const include = { facility: { select: { id: true, name: true } }, customer: { select: { id: true, firstName: true, lastName: true, companyName: true } }, assignee: { select: staffSelect }, cover: { select: staffSelect } };

async function eligibleStaff(tx: Client, organisationId: string, userId: string, facilityId: string) {
  const user = await tx.user.findFirst({ where: { id: userId, organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  if (!user || !currentRoleAccess(user.roleAssignments, "operations.view", facilityId).allowed) throw new Error("FOLLOWUP_STAFF_FORBIDDEN");
  return user;
}

export async function listStaffFollowups(scope: RequestScope, search = "", cursor?: string, view: StaffFollowupView = "all", now = new Date()) {
  staffFollowupViewSchema.parse(view);
  const facilities = await db.facility.findMany({ where: { ...facilityWhere(scope), active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const where: Prisma.TaskWhereInput = { organisationId: scope.organisationId, facilityId: { in: facilities.map(f => f.id) }, purpose: "AGREED_FOLLOWUP", status: { notIn: ["COMPLETED", "CANCELLED"] } };
  if (view !== "all") where.dueAt = view === "due" ? { lt: followupDayEnd(now) } : { gte: followupDayEnd(now) };
  if (cursor && !await db.task.count({ where: { AND: [where, { id: cursor }] } })) throw new Error("CONFLICT");
  const [tasks, customers, users] = await Promise.all([
    db.task.findMany({ where, include, orderBy: [{ dueAt: "asc" }, { id: "asc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: 101 }),
    search.trim().length >= 2 ? db.customer.findMany({ where: { AND: [leasingCustomerWhere(scope, facilities.map(f => f.id)), { OR: ["firstName", "lastName", "companyName"].map(key => ({ [key]: { contains: search.trim().slice(0, 100), mode: "insensitive" } })) }] }, select: { id: true, firstName: true, lastName: true, companyName: true }, orderBy: { id: "asc" }, take: 20 }) : [],
    db.user.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { ...staffSelect, roleAssignments: { include: { role: true } } }, orderBy: { name: "asc" } }),
  ]);
  return { tasks: tasks.slice(0, 100), nextCursor: tasks.length > 100 ? tasks[99].id : null, facilities, customers, staff: users.flatMap(u => { const facilityIds = facilities.filter(f => currentRoleAccess(u.roleAssignments, "operations.view", f.id).allowed).map(f => f.id); return facilityIds.length ? [{ id: u.id, name: u.name, facilityIds }] : []; }), userId: scope.userId };
}

export async function createStaffFollowup(scope: RequestScope, input: unknown) {
  const data = staffFollowupSchema.parse(input);
  return db.$transaction(async tx => {
    const { facilities } = await customerNoteFacilities(scope, data.customerId, tx);
    if (!facilities.some(f => f.id === data.facilityId)) throw new Error("FORBIDDEN");
    await eligibleStaff(tx, scope.organisationId, data.assigneeId, data.facilityId);
    if (data.coverId) await eligibleStaff(tx, scope.organisationId, data.coverId, data.facilityId);
    const requestKey = createHash("sha256").update(JSON.stringify([scope.organisationId, scope.userId, data.requestKey])).digest("hex");
    const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
    const previous = await tx.task.findUnique({ where: { requestKey } });
    if (previous) { if (previous.requestHash !== requestHash) throw new Error("CONFLICT"); return previous; }
    const task = await tx.task.create({ data: { organisationId: scope.organisationId, createdById: scope.userId, facilityId: data.facilityId, customerId: data.customerId, assigneeId: data.assigneeId, coverId: data.coverId, title: data.title, description: data.description, dueAt: new Date(data.dueAt), purpose: "AGREED_FOLLOWUP", requestKey, requestHash } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: data.facilityId, actorId: scope.userId, entityType: "Task", entityId: task.id, action: "staff_followup.created", after: task } });
    return task;
  });
}

export async function changeStaffFollowup(scope: RequestScope, id: string, input: unknown) {
  const data = staffFollowupChangeSchema.parse(input);
  return db.$transaction(async tx => {
    const before = await tx.task.findFirst({ where: { id, organisationId: scope.organisationId, facility: facilityWhere(scope), purpose: "AGREED_FOLLOWUP" } });
    if (!before || !before.facilityId) throw new Error("FORBIDDEN");
    if (["COMPLETED", "CANCELLED"].includes(before.status)) throw new Error("CONFLICT");
    let changes: Prisma.TaskUncheckedUpdateManyInput;
    if (data.action === "ACKNOWLEDGE") {
      if (before.coverId !== scope.userId) throw new Error("FORBIDDEN");
      await eligibleStaff(tx, scope.organisationId, scope.userId, before.facilityId);
      if (before.coverAcknowledgedAt && before.updatedAt.toISOString() === data.expectedUpdatedAt) return before;
      changes = { coverAcknowledgedAt: new Date() };
    } else if (data.action === "UPDATE") {
      await eligibleStaff(tx, scope.organisationId, data.assigneeId, before.facilityId);
      if (data.coverId) await eligibleStaff(tx, scope.organisationId, data.coverId, before.facilityId);
      changes = { title: data.title, description: data.description, dueAt: new Date(data.dueAt), assigneeId: data.assigneeId, coverId: data.coverId,
        ...(data.assigneeId !== before.assigneeId || data.coverId !== before.coverId ? { coverAcknowledgedAt: null } : {}) };
    } else if (data.action === "HANDOVER") {
      if (data.coverId) await eligibleStaff(tx, scope.organisationId, data.coverId, before.facilityId);
      changes = { coverId: data.coverId, coverAcknowledgedAt: null };
    } else {
      changes = { status: data.action === "COMPLETE" ? "COMPLETED" : "CANCELLED", completedAt: data.action === "COMPLETE" ? new Date() : null };
    }
    const updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
    const updated = await tx.task.updateMany({ where: { id, updatedAt: new Date(data.expectedUpdatedAt), status: before.status }, data: { ...changes, updatedAt } });
    if (updated.count !== 1) throw new Error("CONFLICT");
    const after = await tx.task.findUniqueOrThrow({ where: { id } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: before.facilityId, actorId: scope.userId, entityType: "Task", entityId: id, action: `staff_followup.${data.action.toLowerCase()}`, before, after } });
    return after;
  });
}
