import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import Link from "next/link";

export const metadata = { title: "Security audit" };
export const dynamic = "force-dynamic";

function targetHref(entityType: string, entityId: string) {
  if (entityType === "Document") return `/operations/accounts?documentId=${encodeURIComponent(entityId)}`;
  return null;
}

export default async function AuditPage() {
  const auth = await requirePermission("audit.view");
  const events = await db.auditEvent.findMany({ where: { organisationId: auth.user.organisationId }, include: { actor: { select: { name: true, email: true } } }, orderBy: { occurredAt: "desc" }, take: 200 });
  return <div className="page-stack"><PageHeader eyebrow="Security" title="Audit trail" description="Recent authentication, recovery, invitation and access-control events for this organisation." /><section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>Request reference</th></tr></thead><tbody>{events.length ? events.map((event) => {
    const href = targetHref(event.entityType, event.entityId);
    const target = <>{event.entityType}<span className="secondary-cell">{event.entityId}</span></>;
    return <tr key={event.id}><td>{event.occurredAt.toLocaleString("en-ZA")}</td><td className="primary-cell">{event.action}</td><td>{event.actor?.name ?? "System"}<span className="secondary-cell">{event.actor?.email ?? "Automated or unavailable"}</span></td><td>{href ? <Link href={href} className="primary-cell">{target}</Link> : target}</td><td>{event.requestId ?? "—"}</td></tr>;
  }) : <tr><td colSpan={5} className="empty-cell">No security audit events have been recorded.</td></tr>}</tbody></table></div></section></div>;
}
