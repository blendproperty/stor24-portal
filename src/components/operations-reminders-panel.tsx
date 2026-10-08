import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export type OperationsReminder = { label: string; description: string; href: string; count: number | null };

export function OperationsRemindersPanel({ items, updatedAt }: { items: OperationsReminder[]; updatedAt: Date }) {
  if (!items.length) return null;
  return <section className="panel panel-spacious" aria-label="Operations reminders">
    <div className="panel-heading"><div><p className="eyebrow">Daily attention</p><h2>Reminders</h2><p className="panel-subtitle">Updated {formatSouthAfricaDateTime(updatedAt)} SAST. Reload this page to refresh counts.</p></div><ClipboardList size={22}/></div>
    <div className="work-list">{items.map(item => <Link className="work-row" href={item.href} key={item.label}><span className="work-icon"><ClipboardList size={18}/></span><span className="work-copy"><strong>{item.label}</strong><small>{item.description}</small></span><span className="work-count" aria-label={item.count === null ? "Count unavailable" : `${item.count} items`}>{item.count ?? "Unavailable"}</span></Link>)}</div>
    <p className="panel-subtitle">Counts show recorded work in your permitted facilities. Opening a queue does not process payments or change access.</p>
  </section>;
}
