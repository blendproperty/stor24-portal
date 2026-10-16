import { OperationsRemindersPanel, type OperationsReminder as Reminder, type OperationsShortcut } from "@/components/operations-reminders-panel";
import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope, type RequestScope } from "@/lib/scope";
import { collectionsWorkspace } from "@/lib/collections-service";
import { collectionCallCount, reorderItemCount } from "@/lib/operations-reminder-policy";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { staffPaymentReviewCount } from "@/lib/staff-payment-review-service";
import { staffOperationalUnreadCount } from "@/lib/staff-operational-events";

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
    queue("operations.view", { label: "Agreed follow-ups", description: "Customer appointments due today or overdue", href: "/operations/followups?view=due" }, scope => db.task.count({ where: { organisationId: scope.organisationId, purpose: "AGREED_FOLLOWUP", facility: { ...facilityWhere(scope), active: true }, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueAt: { lt: tomorrow } } })),
    queue("collections.view", { label: "Call past dues", description: "Due follow-ups with verified overdue debt and no collection hold", href: "/collections" }, async scope => { const data = await collectionsWorkspace(scope, southAfricaDateKey(now)); return collectionCallCount(data.rows, data.today); }),
    queue("inventory.view", { label: "Reorder", description: "Active products at or below their available-stock threshold", href: "/operations/merchandise" }, async scope => reorderItemCount(await db.product.findMany({ where: { organisationId: scope.organisationId, active: true, facility: facilityWhere(scope) }, select: { quantityOnHand: true, quantityReserved: true, reorderPoint: true } }))),
    queue("ledger.view", { label: "Move-out", description: "Notice-given tenancies scheduled today or overdue", href: "/operations/accounts" }, scope => db.tenancy.count({ where: { facility: facilityWhere(scope), status: "NOTICE_GIVEN", endDate: { lt: tomorrow } } })),
    queue("operations.view", { label: "Service required", description: "Open and in-progress maintenance requests", href: "/operations#operations-maintenance" }, scope => db.maintenanceRequest.count({ where: { organisationId: scope.organisationId, facility: facilityWhere(scope), status: { notIn: ["COMPLETED", "CANCELLED"] } } })),
    queue("payments.view", { label: "Payments awaiting review", description: "Pending payments and unresolved receipt evidence; excludes test records", href: "/operations/payment-review" }, staffPaymentReviewCount),
    queue("operations.view", { label: "Unread booking & move-in events", description: "Recorded store events not yet read by your account", href: "/operations/events" }, staffOperationalUnreadCount),
  ]);
  const today = southAfricaDateKey(now);
  const through = southAfricaDateKey(new Date(now.getTime() + 6 * 86_400_000));
  const arrivalHref = `/operations/arrivals?from=${today}&to=${through}`;
  const [moveIns, followups, arrivals] = await Promise.all([
    queue("reservations.manage", { label: "Move in", description: "Active rental bookings awaiting move-in", href: "/operations/move-in" }, scope => db.reservation.count({ where: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId }, status: "ACTIVE", journey: "RENTAL", convertedTenancyId: null } })),
    queue("operations.view", { label: "Customer follow-ups", description: "Open appointments · all dates", href: "/operations/followups" }, scope => db.task.count({ where: { organisationId: scope.organisationId, purpose: "AGREED_FOLLOWUP", facility: { ...facilityWhere(scope), active: true }, status: { notIn: ["COMPLETED", "CANCELLED"] } } })),
    queue("operations.view", { label: "Expected arrivals", description: "Dated rentals · today and the next six days", href: arrivalHref }, scope => db.reservation.count({ where: { facility: facilityWhere(scope), customer: { organisationId: scope.organisationId }, status: "ACTIVE", journey: "RENTAL", convertedTenancyId: null, intendedMoveIn: { gte: new Date(`${today}T00:00:00+02:00`), lt: new Date(new Date(`${through}T00:00:00+02:00`).getTime() + 86_400_000) } } })),
  ]);
  const visible = items.filter((item): item is Reminder => item !== null);
  const find = (label: string) => visible.find(item => item.label === label);
  const workflows: OperationsShortcut[] = [];
  const add = (item: Reminder | null | undefined, icon: OperationsShortcut["icon"], label?: string, href?: string) => { if (item) workflows.push({ ...item, icon, label: label ?? item.label, href: href ?? item.href }); };
  if (moveIns) workflows.push({ label: "Walk-in on tablet", description: "Start the customer booking journey", href: "/operations/walk-in", icon: "walkin" });
  add(moveIns, "movein");
  add(find("Payments awaiting review"), "payments");
  if (find("Payments awaiting review") || find("Move-out")) workflows.push({ label: "Customer accounts", description: "Open an account to record payments or manage a tenancy", href: "/operations/accounts", icon: "payments" });
  if (find("Move-out")) workflows.push({ label: "Transfer", description: "Move an active tenant to another unit", href: "/operations/accounts", icon: "transfer" });
  add(find("Move-out"), "moveout", "Move out");
  add(followups, "followup"); add(arrivals, "arrivals");
  add(find("Unread booking & move-in events"), "events", "Booking and move-in events");
  add(find("Reorder"), "stock", "Merchandise");
  return <OperationsRemindersPanel items={visible} workflows={workflows} updatedAt={now}/>;
}
