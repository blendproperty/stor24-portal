import { billingPeriodSchema } from "@/lib/monthly-billing-policy";
import { PageHeader } from "@/components/page-header";
import { DebitOrderWorkspace } from "@/components/debit-order-workspace";
import { requirePermissionScope } from "@/lib/scope";
export const metadata = { title: "Debit-order runs" };
export default async function DebitOrdersPage({searchParams}: {searchParams: Promise<{facilityId?:string;period?:string}>}) {
  const requested=await searchParams;
  const period=billingPeriodSchema.safeParse(requested.period);
  await requirePermissionScope("debit_orders.view");
  return <div className="page-stack"><PageHeader eyebrow="Financial operations" title="Debit-order runs" description="Review signed mandates and monthly invoices, prepare a batch, and track its upload outcome."/><DebitOrderWorkspace initialFacilityId={typeof requested.facilityId === "string" ? requested.facilityId.slice(0,100) : undefined} initialPeriod={period.success ? period.data : undefined}/></div>;
}
