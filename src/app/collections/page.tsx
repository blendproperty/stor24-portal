import { PageHeader } from "@/components/page-header";
import { CollectionsWorkspace } from "@/components/collections-workspace";
import "@/styles/collection-notices.css";
export const metadata = { title: "Collections" };
export default function CollectionsPage() {
  return <div className="page-stack"><PageHeader eyebrow="Receivables" title="Collections" description="Review aged debt, assign follow-ups and record payment promises."/><p><a href="/collections/notices">Prepare and review email notices</a> · <a href="/collections/schedules">Scheduled collection letters</a></p><CollectionsWorkspace/></div>;
}
