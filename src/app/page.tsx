import Link from "next/link";
import { ArrowUpRight, CalendarClock, CheckCircle2, CreditCard, DoorOpen, ListChecks, TrendingUp, Users } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getOperationsHome } from "@/lib/dashboard-service";
import { requireScope } from "@/lib/scope";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

const money = (value: number) => value.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
const actionLabel = (value: string) => value.replaceAll("_", " ").replaceAll(".", " · ");

export default async function DashboardPage() {
  const data = await getOperationsHome(await requireScope());
  const queue = [
    { label: "Reservations needing attention", description: "Active holds expiring within three days", count: data.queue.expiringReservations, href: "/reservations", icon: CalendarClock, tone: "warning" },
    { label: "Operational tasks due", description: "Open work due within three days", count: data.queue.dueTasks, href: "/operations", icon: ListChecks, tone: "danger" },
    { label: "Lead follow-ups due", description: "Open leads with an upcoming or overdue next action", count: data.queue.followUpLeads, href: "/leads", icon: Users, tone: "default" },
  ] as const;

  return <div className="page-stack">
    <PageHeader eyebrow="Operations centre" title="Stor24 operational overview" description="Live, facility-scoped occupancy, receivables, leads and priority work." action={<Link className="button button-primary" href="/operations/move-in"><DoorOpen size={17}/>New move-in</Link>}/>
    <section className="metric-grid" aria-label="Portfolio metrics">
      <MetricCard label="Physical occupancy" value={`${data.metrics.occupancyPct.toFixed(1)}%`} detail={`${data.metrics.occupiedUnits} of ${data.metrics.totalUnits} units`} icon={DoorOpen} tone="orange"/>
      <MetricCard label="Occupied units" value={String(data.metrics.occupiedUnits)} detail={`${data.metrics.totalUnits - data.metrics.occupiedUnits} not occupied`} icon={TrendingUp}/>
      <MetricCard label="Receivables" value={money(data.metrics.receivables)} detail={`${data.metrics.overdueAccounts} accounts with balances`} icon={CreditCard} tone="warning"/>
      <MetricCard label="Active leads" value={String(data.metrics.activeLeads)} detail={`${data.metrics.newLeadsThisWeek} created in the last 7 days`} icon={Users} tone="green"/>
    </section>
    <section className="dashboard-grid">
      <article className="panel panel-spacious">
        <div className="panel-heading"><div><p className="eyebrow">Now</p><h2>Priority work queue</h2></div><Link className="text-link" href="/operations">View operations <ArrowUpRight size={15}/></Link></div>
        <div className="work-list">{queue.map((item) => <Link className="work-row" href={item.href} key={item.label}><span className={`work-icon work-icon-${item.tone}`}><item.icon size={18}/></span><span className="work-copy"><strong>{item.label}</strong><small>{item.description}</small></span><span className="work-count">{item.count}</span></Link>)}</div>
      </article>
      <article className="panel panel-spacious">
        <div className="panel-heading"><div><p className="eyebrow">Audit pulse</p><h2>Recent operational activity</h2></div><CalendarClock className="muted-icon" size={21}/></div>
        <div className="timeline">{data.activity.length ? data.activity.map((activity) => <div className="timeline-row" key={activity.id}><span className="timeline-dot"/><div><div className="timeline-meta"><span>{formatSouthAfricaDateTime(activity.occurredAt)} SAST</span><StatusPill tone="neutral">{activity.entityType}</StatusPill></div><strong>{actionLabel(activity.action)}</strong><p>{activity.facility?.name ?? "Organisation-wide"}{activity.actor?.name ? ` · ${activity.actor.name}` : " · System"}</p></div></div>) : <div className="empty-state"><strong>No operational activity yet</strong><p>Audited staff and system actions will appear here.</p></div>}</div>
      </article>
    </section>
    <section className="panel panel-spacious">
      <div className="panel-heading"><div><p className="eyebrow">Readiness</p><h2>Operational foundations</h2></div><StatusPill tone="positive"><CheckCircle2 size={13}/>Database-backed</StatusPill></div>
      <div className="readiness-grid">{[
        ["Tenant lifecycle", "Lead, reservation, move-in, transfer and move-out"],
        ["Scoped permissions", "Organisation and facility access enforced server-side"],
        ["Audit evidence", "Staff and system mutations retained in the operational audit trail"],
        ["Integration gateway", "Provider health, callbacks, retries and exception visibility"],
      ].map(([title, copy]) => <div className="readiness-item" key={title}><CheckCircle2 size={18}/><div><strong>{title}</strong><p>{copy}</p></div></div>)}</div>
    </section>
  </div>;
}
