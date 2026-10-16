import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "@/lib/scope";
import { operationsTaskQuerySchema } from "@/lib/operations-task-policy";
import { followupDayEnd } from "@/lib/staff-followup-policy";

export async function operationsTaskPage(scope: RequestScope, input: unknown = {}, now = new Date()) {
  const { cursor, ...filters } = operationsTaskQuerySchema.parse(input);
  return db.$transaction(async tx => {
    const facilityScope = { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { id: { in: scope.facilityIds } }) };
    const facilities = await tx.facility.findMany({ where: facilityScope, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    if (filters.facility === "portfolio" && !scope.unrestrictedFacilities || !["all", "portfolio"].includes(filters.facility) && !facilities.some(f => f.id === filters.facility)) throw new Error("FORBIDDEN");
    const base: Prisma.TaskWhereInput = { organisationId: scope.organisationId,
      ...(scope.unrestrictedFacilities ? { OR: [{ facilityId: null }, { facility: facilityScope }] } : { facility: facilityScope }),
      ...(filters.facility === "portfolio" ? { facilityId: null } : filters.facility !== "all" ? { facilityId: filters.facility } : {}),
    };
    const constraints: Prisma.TaskWhereInput[] = [base];
    if (filters.status === "active") constraints.push({ status: { notIn: ["COMPLETED", "CANCELLED"] } });
    else if (filters.status !== "all") constraints.push({ status: filters.status });
    if (filters.assignee === "mine") constraints.push({ assigneeId: scope.userId });
    else if (filters.assignee === "unassigned") constraints.push({ assigneeId: null });
    else if (filters.assignee === "search") constraints.push({ assignee: { organisationId: scope.organisationId, name: { contains: filters.person, mode: "insensitive" } } });
    else if (filters.assignee !== "all") constraints.push({ assigneeId: filters.assignee, assignee: { organisationId: scope.organisationId } });
    const end = followupDayEnd(now), start = new Date(end.getTime() - 86_400_000);
    if (filters.due === "overdue") constraints.push({ dueAt: { lt: now }, status: { notIn: ["COMPLETED", "CANCELLED"] } });
    if (filters.due === "today") constraints.push({ dueAt: { gte: start, lt: end } });
    if (filters.due === "upcoming") constraints.push({ dueAt: { gte: end } });
    if (filters.due === "undated") constraints.push({ dueAt: null });
    if (filters.q) constraints.push({ OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { description: { contains: filters.q, mode: "insensitive" } }] });
    const where: Prisma.TaskWhereInput = { AND: constraints };
    if (cursor && !await tx.task.count({ where: { AND: [where, { id: cursor }] } })) throw new Error("CONFLICT");
    const [rows, total, people] = await Promise.all([
      tx.task.findMany({ where, select: { id: true, title: true, description: true, customerId: true, purpose: true, status: true, priority: true, dueAt: true, facility: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true, organisationId: true } } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: 26 }),
      tx.task.count({ where }),
      tx.user.findMany({ where: { organisationId: scope.organisationId, assignedTasks: { some: base } }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 201 }),
    ]);
    if (rows.some(row => row.assignee && row.assignee.organisationId !== scope.organisationId)) throw new Error("TASK_QUEUE_INTEGRITY");
    return { items: rows.slice(0, 25).map(row => ({ ...row, assignee: row.assignee ? { id: row.assignee.id, name: row.assignee.name } : null })), total, nextCursor: rows.length > 25 ? rows[24].id : null, filters, asOf: now.toISOString(), userId: scope.userId, unrestrictedFacilities: scope.unrestrictedFacilities, facilities, assignees: people.slice(0, 200), assigneesComplete: people.length <= 200 };
  }, { isolationLevel: "RepeatableRead", timeout: 20_000 });
}
