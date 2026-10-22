import { CustomerOperationsWorkspace } from "@/components/customer-operations-workspace";
import { requireSession } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";

export const metadata = { title: "Customers & tenants" };
export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ customer?: string; section?: string }> }) { const params = await searchParams; const auth = await requireSession(); return <CustomerOperationsWorkspace canDeleteTests={currentRoleAccess(auth.user.roleAssignments).owner} initialCustomerId={params.customer} initialFollowups={params.section === "followups"}/>; }
