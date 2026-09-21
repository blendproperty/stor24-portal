import { PageHeader } from "@/components/page-header";
import { DebitOrderWorkspace } from "@/components/debit-order-workspace";
import { requirePermissionScope } from "@/lib/scope";
export const metadata = { title: "Debit-order runs" };
export default async function DebitOrdersPage() {
  await requirePermissionScope("debit_orders.view");
  return <div className="page-stack"><PageHeader eyebrow="Financial operations" title="Debit-order runs" description="Review signed mandates and monthly invoices, prepare a batch, and track its upload outcome."/><DebitOrderWorkspace/></div>;
}
