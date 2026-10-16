import { StaffEventInbox } from "@/components/staff-attention-workspace";
import { requirePermission } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";
export const metadata = { title: "Booking & move-in events" };
export default async function StaffEventsPage() {
  const auth = await requirePermission("operations.view");
  return <StaffEventInbox canReviewEmails={currentRoleAccess(auth.user.roleAssignments, "staff_event_emails.view").allowed} />;
}
