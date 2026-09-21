import { PageHeader } from "@/components/page-header";
import { SettlementWorkspace } from "@/components/settlement-workspace";
export const metadata = { title: "Settlement reconciliation" };
export default function SettlementsPage() {
  return <div className="page-stack"><PageHeader eyebrow="Finance review" title="Settlement reconciliation" description="Trace Netcash statement movements to receipts, corrections and bank payouts."/><SettlementWorkspace/></div>;
}
