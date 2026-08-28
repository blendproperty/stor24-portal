import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export const metadata = { title: "Offline readiness" };
export const dynamic = "force-dynamic";

type DownloadDetails = {
  deviceId?: string;
  deviceLabel?: string;
  expiresAt?: string;
  revisionAt?: string;
};

function details(value: unknown): DownloadDetails {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DownloadDetails : {};
}

function serverNow() {
  return Date.now();
}

export default async function OfflineReadinessPage() {
  const auth = await requirePermission("operations.manage");
  const events = await db.auditEvent.findMany({
    where: {
      organisationId: auth.organisationId,
      action: "offline.snapshot.downloaded",
      ...(auth.allowedFacilityIds ? { facilityId: { in: auth.allowedFacilityIds } } : {}),
    },
    include: { facility: { select: { name: true } }, actor: { select: { name: true, email: true } } },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });
  const devices = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const info = details(event.after);
    const key = info.deviceId ? `${event.facilityId}:${info.deviceId}` : event.id;
    if (!devices.has(key)) devices.set(key, event);
  }
  const rows = [...devices.values()];
  const now = serverNow();

  return <div className="page-stack">
    <PageHeader eyebrow="Redundancy" title="Offline readiness" description="Latest encrypted snapshot preparation recorded for each facility device. Passphrases and offline data never reach this screen." />
    <section className="panel"><div className="table-wrap"><table className="data-table">
      <thead><tr><th>Device</th><th>Facility</th><th>Prepared by</th><th>Last refreshed</th><th>Snapshot state</th></tr></thead>
      <tbody>{rows.length ? rows.map((event) => {
        const info = details(event.after);
        const expiresAt = info.expiresAt ? new Date(info.expiresAt) : null;
        const state = !expiresAt ? "Unknown" : expiresAt.getTime() <= now ? "Expired" : expiresAt.getTime() - now <= 2 * 60 * 60 * 1000 ? "Expiring soon" : "Ready";
        return <tr key={event.id}><td className="primary-cell">{info.deviceLabel || "Unnamed device"}<span className="secondary-cell">{info.deviceId || "Legacy snapshot"}</span></td><td>{event.facility?.name ?? "Unavailable"}</td><td>{event.actor?.name ?? "Unknown"}<span className="secondary-cell">{event.actor?.email ?? "—"}</span></td><td>{formatSouthAfricaDateTime(event.occurredAt)}</td><td>{state}<span className="secondary-cell">{expiresAt ? `Expires ${formatSouthAfricaDateTime(expiresAt)} SAST` : "No expiry recorded"}</span></td></tr>;
      }) : <tr><td colSpan={5} className="empty-cell">No offline devices have prepared a tracked snapshot yet.</td></tr>}</tbody>
    </table></div></section>
  </div>;
}
