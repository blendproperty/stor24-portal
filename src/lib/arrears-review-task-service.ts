import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import { arrearsAuthority } from "./arrears-authority";
import type { RequestScope } from "./scope";

export function assertReviewTaskTransition(previous: TaskStatus, next: TaskStatus) {
  if (["COMPLETED", "CANCELLED"].includes(previous) && !["COMPLETED", "CANCELLED"].includes(next)) throw Error("ARREARS_REVIEW_TASK_CLOSED");
}

/** Progress only. A closed review cannot reopen behind a replacement request. */
export async function updateArrearsReviewTaskStatus(tx: Prisma.TransactionClient, scope: RequestScope, id: string, status: TaskStatus) {
  const where = { id, organisationId: scope.organisationId, purpose: "ARREARS_ESCALATION_REVIEW", facility: { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { id: { in: scope.facilityIds } }) } };
  if (!await tx.task.findFirst({ where, select: { id: true } })) throw Error("ARREARS_REVIEW_TASK_NOT_FOUND");
  await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${id} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;
  const before = await tx.task.findFirst({ where });
  if (!before?.facilityId) throw Error("ARREARS_REVIEW_TASK_NOT_FOUND");
  await arrearsAuthority(tx, scope, before.facilityId, ["operations.manage"]);
  assertReviewTaskTransition(before.status, status);
  const updated = await tx.task.update({ where: { id }, data: { status, completedAt: status === "COMPLETED" ? new Date() : null } });
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: before.facilityId, actorId: scope.userId, action: "task.status.change", entityType: "task", entityId: id, before, after: updated } });
  return updated;
}
