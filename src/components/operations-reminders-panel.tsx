import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowRightLeft, ArrowUpRight, Bell, CalendarDays, ClipboardCheck, ClipboardList, CreditCard, LogOut, Package, Tablet, Wrench } from "lucide-react";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export type OperationsReminder = { label: string; description: string; href: string; count: number | null };
const icons = { walkin: Tablet, movein: ArrowDownLeft, payments: CreditCard, transfer: ArrowRightLeft, moveout: LogOut, followup: ClipboardCheck, arrivals: CalendarDays, events: Bell, stock: Package };
export type OperationsShortcut = { label: string; description: string; href: string; icon: keyof typeof icons; count?: number | null };

export function OperationsRemindersPanel({ items, workflows = [], updatedAt }: { items: OperationsReminder[]; workflows?: OperationsShortcut[]; updatedAt: Date }) {
  if (!items.length && !workflows.length) return null;
  const largest = Math.max(1, ...items.map(item => item.count ?? 0));
  return <div className="operations-dashboard">
    {workflows.length ? <section className="panel panel-spacious operations-workflow-panel operations-dashboard-shortcuts" aria-label="Operations workspaces">
      <div className="panel-heading"><div><p className="eyebrow">Quick access</p><h2>Customer and store workflows</h2><p className="panel-subtitle">Your daily shortcuts, with the queue size beside each workflow.</p></div><span className="operations-dashboard-stamp">Store access applied</span></div>
      <div className="operations-dashboard-shortcut-grid">{workflows.map(item => { const Icon = icons[item.icon]; return <Link href={item.href} key={item.label} className={`operations-dashboard-shortcut operations-dashboard-${item.icon}`}>
        <div className="operations-dashboard-shortcut-top"><span className="operations-dashboard-icon"><Icon size={21} aria-hidden="true"/></span>{item.count !== undefined ? <span className="operations-dashboard-badge" data-state={item.count === null ? "unavailable" : item.count > 0 ? "active" : "clear"} aria-label={item.count === null ? `${item.label}: count unavailable` : `${item.label}: ${item.count} items`}>{item.count ?? "Unavailable"}</span> : <ArrowUpRight size={18} aria-hidden="true"/>}</div>
        <strong>{item.label}</strong><span className="operations-dashboard-shortcut-description">{item.description}</span><span className="operations-dashboard-open">Open workspace <ArrowRight size={14} aria-hidden="true"/></span>
      </Link>; })}</div>
      <p className="operations-dashboard-caption">Updated {formatSouthAfricaDateTime(updatedAt)} SAST · Permitted stores only · Reload the page to refresh counts.</p>
    </section> : null}
    {items.length ? <section className="panel panel-spacious operations-attention-panel operations-dashboard-attention" aria-label="Operations reminders">
      <div className="panel-heading"><div><p className="eyebrow">Daily attention</p><h2>Today at a glance</h2><p className="panel-subtitle">See the queues that need a closer look.</p></div><ClipboardList size={22} aria-hidden="true"/></div>
      <div className="operations-attention-grid">{items.map((item, index) => { const Icon = item.label.includes("Service") ? Wrench : item.label.includes("payment") || item.label.includes("Payment") ? CreditCard : item.label.includes("event") ? Bell : item.label === "Reorder" ? Package : ClipboardList; return <Link className="operations-attention-card operations-dashboard-metric" href={item.href} key={item.label} data-tone={index % 4}>
        <div className="operations-dashboard-metric-heading"><span>{item.label === "Reminders" ? "Tasks due" : item.label}</span><Icon size={18} aria-hidden="true"/></div>
        <strong className="work-count" aria-label={item.count === null ? "Count unavailable" : `${item.count} items`}>{item.count ?? "Unavailable"}</strong>
        <small>{item.description}</small>
        <span className="operations-dashboard-bar" aria-hidden="true"><span style={{ width: item.count === null ? "0%" : `${item.count / largest * 100}%` }}/></span>
      </Link>; })}</div>
      <p className="operations-dashboard-caption">Updated {formatSouthAfricaDateTime(updatedAt)} SAST. Queue sizes can overlap; they are not an overall total. Unavailable means the count could not be checked.</p>
    </section> : null}
  </div>;
}
