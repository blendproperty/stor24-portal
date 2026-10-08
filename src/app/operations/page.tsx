import { OperationsWorkspace } from "@/components/operations-workspace";
import { OperationsReminders } from "@/components/operations-reminders";

export const metadata = { title: "Operations" };

export default function OperationsPage() {
  return <OperationsWorkspace reminders={<OperationsReminders/>} />;
}
