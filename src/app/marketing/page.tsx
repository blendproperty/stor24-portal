import { requirePermissionScope } from "@/lib/scope";
import { requireSession } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { MarketingDashboard } from "@/components/marketing-dashboard";
export const metadata = { title: "Marketing command centre" };
export default async function MarketingPage() {
  await requirePermissionScope("leads.view");
  const session = await requireSession();
  return (
    <MarketingDashboard
      canManage={hasPermission(session.permissions, "leads.create")}
    />
  );
}
