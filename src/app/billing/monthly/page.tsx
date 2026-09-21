import { PageHeader } from "@/components/page-header";
import { MonthlyBillingWorkspace } from "@/components/monthly-billing-workspace";
import { requirePermissionScope } from "@/lib/scope";
export const metadata = { title: "Monthly billing" };
export default async function MonthlyBillingPage() {
  await requirePermissionScope("billing.view");
  return <div className="page-stack"><PageHeader eyebrow="Financial operations" title="Monthly billing" description="Approve account terms, review this month's charges, then post the invoice and ledger together."/><MonthlyBillingWorkspace/></div>;
}
