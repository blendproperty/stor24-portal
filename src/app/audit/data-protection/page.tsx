import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { DLP_MAX_BYTES, DLP_MAX_ROWS, DLP_POLICY_VERSION } from "@/lib/dlp-policy";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import { dlpBackupStatus } from "@/lib/dlp-backup-status";
export const metadata = { title: "Data protection" };
export const dynamic = "force-dynamic";
export default async function DataProtectionPage() {
  const auth = await requirePermission("audit.view");
  const backup = await dlpBackupStatus();
  const events = await db.auditEvent.findMany({ where: { organisationId: auth.organisationId, action: { startsWith: "dlp." }, ...(auth.allowedFacilityIds === null ? {} : { facilityId: { in: auth.allowedFacilityIds } }) }, include: { actor: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 100 });
  return <div className="page-stack privacy-workspace"><PageHeader eyebrow="Security" title="Data protection" description="Report export policy and recent decisions for your organisation."/>
    <section className="panel panel-spacious"><h2>Backup recovery</h2><p>{backup.fresh ? "Encrypted database backup verified within the last 26 hours." : "Backup evidence unavailable or overdue — administrator review required."}</p><p>Latest verified backup: {backup.completedAt ? formatSouthAfricaDateTime(new Date(backup.completedAt)) : "Not verified"}. Restoration proof: {backup.restoredAt ? formatSouthAfricaDateTime(new Date(backup.restoredAt)) : "Not verified"}.</p><p>Off-site copy: {backup.offSite ? "Verified" : "Not verified — remains an open recovery gate"}.</p></section>
    <section className="panel panel-spacious"><h2>Application data protection</h2><p>Policy {DLP_POLICY_VERSION}: operational reports are confidential. Personal-data exports require Super Admin (Organisation owner) access or an explicit personal-export grant from that owner; broad roles do not grant it. Exports containing detected credentials, payment card patterns or restricted fields are blocked. The report limit is {DLP_MAX_ROWS.toLocaleString()} rows and {DLP_MAX_BYTES / 1024 / 1024} MB of report data.</p><p>Downloads and outbound messages require a saved policy decision. Transfers are limited to 60 per hour per actor or destination; document downloads are restricted and bounded to 20 MB. No matching sensitive content is stored in decision logs.</p><p>Coverage includes application reports, collection and settlement CSVs, private documents and identity/photo previews, and outbound email/SMS/WhatsApp. Authorised customer PDFs retain their original signed content. File restrictions after download, Microsoft 365 email/cloud policies and staff-device controls remain open.</p><Link href="/audit">Open system audit and investigate blocked transfers</Link></section>
    <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Resource</th><th>Channel / format</th><th>Rows / bytes</th><th>Decision / reason</th><th>Request reference</th></tr></thead><tbody>{events.map(event => {
      const metadata = event.after && typeof event.after === "object" && !Array.isArray(event.after) ? event.after as Record<string, unknown> : {};
      return <tr key={event.id}><td>{formatSouthAfricaDateTime(event.occurredAt)}</td><td>{event.actor?.name ?? "System"}</td><td>{event.entityId}</td><td>{String(metadata.channel ?? "Unknown")}{typeof metadata.format === "string" ? ` / ${metadata.format}` : ""}</td><td>{typeof metadata.rowCount === "number" ? `${metadata.rowCount} rows` : typeof metadata.byteCount === "number" ? `${metadata.byteCount} bytes` : "�"}</td><td>{event.action.endsWith(".blocked") ? "Blocked — review required" : "Allowed"}{Array.isArray(metadata.reasons) && metadata.reasons.length ? <span className="secondary-cell">{metadata.reasons.join(", ")}</span> : null}</td><td>{event.requestId}</td></tr>; })}{!events.length ? <tr><td colSpan={7}>No DLP decisions recorded yet.</td></tr> : null}</tbody></table></div></section>
  </div>;
}
