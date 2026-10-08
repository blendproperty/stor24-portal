import { OperationsRemindersPanel, type OperationsReminder as Reminder } from "@/components/operations-reminders-panel";
import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope, type RequestScope } from "@/lib/scope";
import { collectionsWorkspace } from "@/lib/collections-service";
import { collectionCallCount, reorderItemCount } from "@/lib/operations-reminder-policy";
import { southAfricaDateKey } from "@/lib/south-africa-time";

// Authorise and scope each queue separately: navigation permissions alone do not
// establish permission to read another facility's aggregate counts.
async function queue(permission: string, item: Omit<Reminder, "count">, read: (scope: RequestScope) => Promise<number>): Promise<Reminder | null> {
  let scope: RequestScope;
  try { scope = await requirePermissionScope(permission); }
  catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return null;
    throw error;
  }
  try { return { ...item, count: await read(scope) }; }
  catch { return { ...item, count: null }; }
}

export async function OperationsReminders() {
  const now = new Date();
  const tomorrow = new Date(`${southAfricaDateKey(new Date(now.getTime() + 86_400_000))}T00:00:00+02:00`);
  const items = await Promise.all([
    queue("operations.view", { label: "Reminders", description: "Open tasks due today or overdue", href: "/operations#operations-tasks" }, scope => db.task.count({ where: { organisationId: scope.organisationId, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueAt: { lt: tomorrow }, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) } })),
    queue("collections.view", { label: "Call past dues", description: "Due follow-ups with verified overdue debt and no collection hold", href: "/collections" }, async scope => { const data = await collectionsWorkspace(scope, southAfricaDateKey(now)); return collectionCallCount(data.rows, data.today); }),
    queue("inventory.view", { label: "Reorder", description: "Active products at or below their available-stock threshold", href: "/operations/merchandise" }, async scope => reorderItemCount(await db.product.findMany({ where: { organisationId: scope.organisationId, active: true, facility: facilityWhere(scope) }, select: { quantityOnHand: true, quantityReserved: true, reorderPoint: true } }))),
    queue("ledger.view", { label: "Move-out", description: "Notice-given tenancies scheduled today or overdue", href: "/operations/accounts" }, scope => db.tenancy.count({ where: { facility: facilityWhere(scope), status: "NOTICE_GIVEN", endDate: { lt: tomorrow } } })),
    queue("operations.view", { label: "Service required", description: "Open and in-progress maintenance requests", href: "/operations#operations-maintenance" }, scope => db.maintenanceRequest.count({ where: { organisationId: scope.organisationId, facility: facilityWhere(scope), status: { notIn: ["COMPLETED", "CANCELLED"] } } })),
  ]);
  const visible = items.filter((item): item is Reminder => item !== null);
  return <OperationsRemindersPanel items={visible} updatedAt={now}/>;
}
