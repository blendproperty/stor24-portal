import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import Link from "next/link";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export const metadata = { title: "System audit" };
export const dynamic = "force-dynamic";

function targetHref(entityType: string, entityId: string) {
  if (entityType === "Document") return `/operations/accounts?documentId=${encodeURIComponent(entityId)}`;
  if (entityType === "Integration" && entityId === "NETCASH") return "/settings/integrations/netcash";
  return null;
}

function netcashDetails(action: string, after: unknown) {
  if (!action.startsWith("integration.netcash.validation.") || !after || typeof after !== "object" || Array.isArray(after)) return null;
  const value = after as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof value.failureCode === "string") parts.push(`Failure: ${value.failureCode}`);
  if (typeof value.accountStatus === "string") parts.push(`Account ${value.accountStatus}${typeof value.accountMessage === "string" ? ` (${value.accountMessage})` : ""}`);
  if (Array.isArray(value.services)) {
    for (const item of value.services) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const service = item as Record<string, unknown>;
      if (typeof service.label === "string" && typeof service.status === "string") {
        parts.push(`${service.label} ${service.status}${typeof service.message === "string" ? ` (${service.message})` : ""}`);
      }
    }
  }
  if (typeof value.credentialsStored === "boolean") parts.push(value.credentialsStored ? "Credentials stored" : "No credentials stored");
  return parts.length ? parts.join(" | ") : null;
}

export default async function AuditPage() {
  const auth = await requirePermission("audit.view");
  const events = await db.auditEvent.findMany({ where: { organisationId: auth.user.organisationId }, include: { actor: { select: { name: true, email: true } } }, orderBy: { occurredAt: "desc" }, take: 200 });
  return <div className="page-stack"><PageHeader eyebrow="System" title="System audit" description="Recent authentication, configuration, integration, recovery and operational events for this organisation." /><section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th><th>Request reference</th></tr></thead><tbody>{events.length ? events.map((event) => {
    const href = targetHref(event.entityType, event.entityId);
    const target = <>{event.entityType}<span className="secondary-cell">{event.entityId}</span></>;
    const details = netcashDetails(event.action, event.after);
    return <tr key={event.id}><td>{formatSouthAfricaDateTime(event.occurredAt)}</td><td className="primary-cell">{event.action}</td><td>{event.actor?.name ?? "System"}<span className="secondary-cell">{event.actor?.email ?? "Automated or unavailable"}</span></td><td>{href ? <Link href={href} className="primary-cell">{target}</Link> : target}</td><td>{details ?? "—"}</td><td>{event.requestId ?? "—"}</td></tr>;
  }) : <tr><td colSpan={6} className="empty-cell">No system audit events have been recorded.</td></tr>}</tbody></table></div></section></div>;
}
