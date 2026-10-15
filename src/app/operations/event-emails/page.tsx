import { requirePermissionScope } from "@/lib/scope";
import { StaffEventEmails } from "@/components/staff-event-emails";
export default async function Page() {
  await requirePermissionScope("staff_event_emails.view");
  return <StaffEventEmails />;
}
