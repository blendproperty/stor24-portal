import Link from "next/link";
import { PhoneCall, UserRoundSearch } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";

export const metadata = { title: "Phone integration" };

export default async function PhonePage() {
  const { organisationId, allowedFacilityIds } = await requirePermission("phone.view");
  const connection = await db.integrationConnection.findFirst({ where: { organisationId, category: { equals: "PHONE", mode: "insensitive" }, ...(allowedFacilityIds ? { OR: [{ facilityId: null }, { facilityId: { in: allowedFacilityIds } }] } : {}) }, orderBy: { updatedAt: "desc" } });
  return (
    <div className="page-stack phone-workspace">
      <PageHeader eyebrow="Telephony" title="Phone integration" description="Review the phone connection and the remaining steps before caller matching is available." />
      <section className="dashboard-grid">
        <article className="panel panel-spacious">
          <div className="panel-heading"><h2>Incoming caller</h2><PhoneCall className="positive-icon" /></div>
          <div className="empty-state"><UserRoundSearch size={36} /><strong>Caller matching is not available yet</strong><p>A telephony provider adapter must be connected and tested before live calls can appear here.</p></div>
        </article>
        <article className="panel panel-spacious">
          <div className="panel-heading"><h2>Caller ID log</h2><span className={`status-pill ${connection?.status === "CONNECTED" && connection.lastHealthAt ? "status-positive" : "status-warning"}`}>{connection?.status === "CONNECTED" && connection.lastHealthAt ? "Connected and verified" : connection?.status ?? "Disconnected"}</span></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Number</th><th>Match</th><th>Action</th></tr></thead><tbody><tr><td colSpan={4} className="empty-cell">No caller events available.</td></tr></tbody></table></div>
          <p className="safe-config-note">This screen is a configuration shell. Caller events will remain empty until a provider adapter is implemented and health-verified.</p><Link className="button button-secondary" href="/integrations">Review integrations</Link>
        </article>
      </section>
    </div>
  );
}

