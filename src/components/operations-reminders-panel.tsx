import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export type OperationsReminder = { label: string; description: string; href: string; count: number | null };

export function OperationsRemindersPanel({ items, updatedAt }: { items: OperationsReminder[]; updatedAt: Date }) {
  if (!items.length) return null;
  return <section className="panel panel-spacious operations-attention-panel" aria-label="Operations reminders">
    <div className="panel-heading"><div><p className="eyebrow">Daily attention</p><h2>Reminders</h2><p className="panel-subtitle">Updated {formatSouthAfricaDateTime(updatedAt)} SAST. Reload this page to refresh counts.</p></div><ClipboardList size={22}/></div>
    <div className="operations-attention-grid">{items.map(item => <Link className="operations-attention-card" href={item.href} key={item.label}><div><strong>{item.label}</strong><span className="work-count" aria-label={item.count === null ? "Count unavailable" : `${item.count} items`}>{item.count ?? "Unavailable"}</span></div><small>{item.description}</small></Link>)}</div>
    <p className="panel-subtitle">Counts cover your permitted stores. Choose a queue to review its records.</p>
  </section>;
}
