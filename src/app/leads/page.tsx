import { LeadsWorkspace } from "@/components/leads-workspace";
import { requirePermissionScope } from "@/lib/scope";
export const metadata = { title: "Leads & sales performance" };
export default async function LeadsPage({ searchParams }: {searchParams: Promise<{customer?: string; lead?: string}>}) {
  const params = await searchParams;
  await requirePermissionScope("leads.view");
  return <LeadsWorkspace initialCustomerId={params.customer} initialLeadId={params.lead}/>;
}
