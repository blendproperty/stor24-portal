import { PageHeader } from "@/components/page-header";
import { CollectionsWorkspace } from "@/components/collections-workspace";
import "@/styles/collection-notices.css";
export const metadata = { title: "Collections" };
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ facility?: string; mode?: string }> }) {
  const { facility, mode } = await searchParams;
  return <div className="page-stack"><PageHeader eyebrow="Receivables" title="Collections" description="Review aged debt, assign follow-ups and record payment promises."/><p><a href="/collections/notices">Prepare and review email notices</a> · <a href="/collections/schedules">Scheduled collection letters</a></p><CollectionsWorkspace initialFacility={typeof facility === "string" ? facility : ""} initialMode={mode === "follow-up" ? "follow-up" : "all"}/></div>;
}
