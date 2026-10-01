import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { DLP_MAX_BYTES, DLP_MAX_ROWS, DLP_POLICY_VERSION } from "@/lib/dlp-policy";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
export const metadata = { title: "Data protection" };
export const dynamic = "force-dynamic";
export default async function DataProtectionPage() {
  const auth = await requirePermission("audit.view");
  const events = await db.auditEvent.findMany({ where: { organisationId: auth.organisationId, entityType: "DlpExport", ...(auth.allowedFacilityIds === null ? {} : { facilityId: { in: auth.allowedFacilityIds } }) }, orderBy: { occurredAt: "desc" }, take: 100 });
  return <div className="page-stack"><PageHeader eyebrow="Security" title="Data protection" description="Report export policy and recent decisions for your organisation."/>
    <section className="panel panel-spacious"><h2>Application export controls</h2><p>Policy {DLP_POLICY_VERSION}: reports are confidential. Exports containing detected credentials, payment card patterns or restricted fields are blocked. The limit is {DLP_MAX_ROWS.toLocaleString()} rows and {DLP_MAX_BYTES / 1024 / 1024} MB of report data.</p><p>Every policy decision must be recorded before a report is released. No matching sensitive content is stored in the decision log.</p><p>Coverage: CSV and JSON report downloads. File labels that enforce permissions after download, email filtering, cloud repositories and staff-device controls require separate implementation and configuration. Backup restoration and recovery validation remain separate readiness gates.</p><Link href="/audit">Open system audit</Link></section>
    <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Report</th><th>Decision</th><th>Request reference</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{formatSouthAfricaDateTime(event.occurredAt)}</td><td>{event.entityId}</td><td>{event.action === "dlp.export.blocked" ? "Blocked" : "Allowed"}</td><td>{event.requestId}</td></tr>)}{!events.length ? <tr><td colSpan={4}>No DLP export decisions recorded yet.</td></tr> : null}</tbody></table></div></section>
  </div>;
}
