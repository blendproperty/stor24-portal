import { LeadsWorkspace } from "@/components/leads-workspace";
import { requirePermissionScope } from "@/lib/scope";
export const metadata = { title: "Leads & sales performance" };
export default async function LeadsPage() {
  await requirePermissionScope("leads.view");
  return <LeadsWorkspace />;
}
