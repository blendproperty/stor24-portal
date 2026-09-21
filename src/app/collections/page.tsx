import { PageHeader } from "@/components/page-header";
import { CollectionsWorkspace } from "@/components/collections-workspace";
export const metadata = { title: "Collections" };
export default function CollectionsPage() {
  return <div className="page-stack"><PageHeader eyebrow="Receivables" title="Collections" description="Review aged debt, assign follow-ups and record payment promises."/><CollectionsWorkspace/></div>;
}
