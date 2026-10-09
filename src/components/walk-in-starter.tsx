"use client";
import { useState } from "react";
type Visit = { id: string; launchUrl: string; expiresAt: string; facilityName: string };
export function WalkInStarter({ facilities }: { facilities: { id: string; name: string }[] }) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [visit, setVisit] = useState<Visit | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function start() {
    setBusy(true); setError(""); setVisit(null);
    try {
      const response = await fetch("/api/v1/walk-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facilityId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The visit could not be started. Retry.");
      setVisit(payload.data);
    } catch (e) { setError(e instanceof Error ? e.message : "The visit could not be started."); }
    finally { setBusy(false); }
  }
  return <section className="panel lease-signing-panel">
    <div><p className="eyebrow">1 · Staff preparation</p><h2>Start a walk-in visit</h2><p>Choose the store, then hand the tablet to the customer. They choose their unit, enter their details, verify their contact details and review and sign the same agreement used on the website.</p></div>
    <label>Store<select value={facilityId} disabled={busy || Boolean(visit)} onChange={e => setFacilityId(e.target.value)}>{facilities.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    {!visit && <button className="button button-primary" disabled={busy || !facilityId} onClick={() => void start()}>{busy ? "Preparing visit…" : "Prepare tablet visit"}</button>}
    {visit && <><div><p className="eyebrow">2 · Customer handover</p><h2>Ready for the customer</h2><p>{visit.facilityName}. Open this visit on the counter tablet, then hand it over. The handover link can be used once and expires in five minutes.</p></div>
      <div className="form-actions"><a className="button button-primary" href={visit.launchUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Hand device to customer</a><button className="button button-secondary" onClick={() => { void navigator.clipboard.writeText(visit.launchUrl).then(() => setError("Handover link copied. Open it on the counter tablet."), () => setError("Copy failed. Open the visit on this tablet.")); }}>Copy handover link to tablet</button><button className="button button-secondary" onClick={() => setVisit(null)}>Prepare another visit</button></div></>}
    <div><p className="eyebrow">3 · Staff completion</p><p>After the customer finishes, clear the tablet and open Move in to review identity, payment and access checks before handing over the unit.</p><a className="button button-secondary" href="/operations/move-in">Open Move in</a></div>
  </section>;
}
