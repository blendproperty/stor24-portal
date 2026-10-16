"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { trainingDebtorRead, trainingMoney, type TrainingDebtorSnapshot } from "@/lib/training-debtor-contract";

export function TrainingDebtorWorkspace({ initial }: { initial: TrainingDebtorSnapshot }) {
  const [data, setData] = useState(initial);
  const [facilityId, setFacilityId] = useState(initial.facilities[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  async function load(create: boolean) {
    if (busy || (create && uncertain)) return;
    setBusy(true); setError("");
    // Remove previously loaded balances if refreshed access has been revoked.
    if (!create) setData({ canCreate: false, facilities: [], rows: [] });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/v1/training/debtors", { method: create ? "POST" : "GET", cache: "no-store", signal: controller.signal, ...(create ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ facilityId }) } : {}) });
      if (!response.ok) throw new Error("READ_FAILED");
      const next = trainingDebtorRead.parse(await response.json()).data;
      setData(next); setUncertain(false);
    } catch {
      if (create) setUncertain(true);
      setError(create ? "Creation could not be confirmed. Refresh training balances before trying again; the saved example will not be duplicated." : "Training balances could not be loaded. Check your sign-in and store access, then refresh.");
    } finally { clearTimeout(timer); setBusy(false); }
  }
  return <div className="page-stack">
    <PageHeader eyebrow="Staff training" title="Training customer balances" description="Shared examples saved in the portal for staff to review with their own logins." action={<Link className="button button-secondary" href="/tenants">Customers &amp; tenants</Link>}/>
    <section className="panel panel-spacious"><h2>Training only</h2><p>These illustrative balances are separate from live Accounts, billing, receipts, collections and financial reports. No money was received, no real debt is created and no unit or access is assigned.</p>
      <div className="form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void load(false)}>{busy ? "Loading…" : "Refresh training balances"}</button></div>
      {error && <p role="alert">{error}</p>}
      {data.canCreate && <form className="form-actions" onSubmit={event => { event.preventDefault(); void load(true); }}><label>Training store<select value={facilityId} onChange={event => setFacilityId(event.target.value)}>{data.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><button className="button button-primary" disabled={busy || uncertain || !facilityId}>Create or open test customer</button></form>}
    </section>
    {!data.rows.length && !busy && !error && <p>No training customer has been created for your stores yet.</p>}
    {data.rows.map(row => <article className="panel panel-spacious" key={row.customerId} aria-label={`Training account ${row.reference}`}>
      <p className="eyebrow">TRAINING ONLY · {row.reference}</p><h2>{row.name}</h2><p>{row.facility} · Shared staff example</p>
      <div className="summary-strip"><div className="summary-cell"><span>Illustrative charge</span><strong>{trainingMoney(row.chargedCents)}</strong></div><div className="summary-cell"><span>Illustrative payment</span><strong>{trainingMoney(row.illustrativePaidCents)}</strong></div><div className="summary-cell"><span>Outstanding training balance</span><strong>{trainingMoney(row.outstandingCents)}</strong></div><div className="summary-cell"><span>Status</span><strong>Amount due · training</strong></div></div>
      <p>R1,000 charged − R400 illustrative payment = R600 outstanding. This example persists after refresh and is shared with authorised staff at this store.</p>
      <Link className="button button-secondary" href={`/tenants?customer=${encodeURIComponent(row.customerId)}`}>Open test customer profile</Link>
    </article>)}
  </div>;
}
