import Link from "next/link";
import { ArrowUpRight, CalendarClock, DoorOpen, ListChecks, Users } from "lucide-react";
import { PortfolioOverview } from "@/components/portfolio-overview";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getOperationsHome } from "@/lib/dashboard-service";
import { requireScope } from "@/lib/scope";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

const actionLabel = (value: string) => value.replaceAll("_", " ").replaceAll(".", " · ");

export default async function DashboardPage() {
  const data = await getOperationsHome(await requireScope());
  const queue = [
    { label: "Reservations needing attention", description: "Active holds expiring within three days", count: data.queue.expiringReservations, href: "/reservations", icon: CalendarClock, tone: "warning" },
    { label: "Operational tasks due", description: "Open work due within three days", count: data.queue.dueTasks, href: "/operations", icon: ListChecks, tone: "danger" },
    { label: "Lead follow-ups due", description: "Open leads with an upcoming or overdue next action", count: data.queue.followUpLeads, href: "/leads", icon: Users, tone: "default" },
  ] as const;

  return <div className="page-stack overview-workspace">
    <PageHeader eyebrow="Operations centre" title="Stor24 operational overview" description="Live, facility-scoped occupancy, receivables, leads and priority work." action={<Link className="button button-primary" href="/operations/move-in"><DoorOpen size={17}/>New move-in</Link>}/>
    <PortfolioOverview {...data.metrics}/>
    <section className="dashboard-grid">
      <article className="panel panel-spacious" data-guide="dashboard-queue">
        <div className="panel-heading"><div><p className="eyebrow">Now</p><h2>Priority work queue</h2></div><Link className="text-link" href="/operations">View operations <ArrowUpRight size={15}/></Link></div>
        <div className="work-list">{queue.map((item) => <Link className="work-row" href={item.href} key={item.label}><span className={`work-icon work-icon-${item.tone}`}><item.icon size={18}/></span><span className="work-copy"><strong>{item.label}</strong><small>{item.description}</small></span><span className="work-count">{item.count}</span></Link>)}</div>
      </article>
      <article className="panel panel-spacious" data-guide="dashboard-activity">
        <div className="panel-heading"><div><p className="eyebrow">Audit pulse</p><h2>Recent operational activity</h2></div><CalendarClock className="muted-icon" size={21}/></div>
        <div className="timeline">{data.activity.length ? data.activity.map((activity) => <div className="timeline-row" key={activity.id}><span className="timeline-dot"/><div><div className="timeline-meta"><span>{formatSouthAfricaDateTime(activity.occurredAt)} SAST</span><StatusPill tone="neutral">{activity.entityType}</StatusPill></div><strong>{actionLabel(activity.action)}</strong><p>{activity.facility?.name ?? "Organisation-wide"}{activity.actor?.name ? ` · ${activity.actor.name}` : " · System"}</p></div></div>) : <div className="empty-state"><strong>No operational activity yet</strong><p>Audited staff and system actions will appear here.</p></div>}</div>
      </article>
    </section>
    <section className="daily-workflows" aria-label="Daily workflows">
      <div><p className="eyebrow">Keep things moving</p><h2>Your daily workflows</h2></div>
      {[
        ["01", "Capture an enquiry", "Find a customer. Start the next conversation.", "/leads"],
        ["02", "Reserve a unit", "Choose a space and agree the move-in date.", "/reservations"],
        ["03", "Welcome a tenant", "Work through the lease and handover checks.", "/operations/move-in"],
        ["04", "Review the numbers", "Check performance and export the detail.", "/reports"],
      ].map(([number, title, copy, href]) => <Link href={href} className="daily-workflow" key={number}><span>{number}</span><div><strong>{title}</strong><p>{copy}</p></div><ArrowUpRight size={18}/></Link>)}
    </section>
  </div>;
}
