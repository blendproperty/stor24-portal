"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
type Visit = { id: string; launchUrl: string; visitCode: string; qrDataUrl: string; expiresAt: string; facilityName: string };
export function WalkInStarter({ facilities }: { facilities: { id: string; name: string }[] }) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [visit, setVisit] = useState<Visit | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const expired = Boolean(visit && now >= Date.parse(visit.expiresAt));
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
    {visit && <><div><p className="eyebrow">2 · Open on the counter tablet</p><h2>{expired ? "Visit code expired" : "Ready for the customer"}</h2><p>{visit.facilityName}. In the installed STOR24 Counter app, tap Scan visit QR or enter the visit code below. Both open this same visit, work once and expire after five minutes.</p></div>
      {!expired && <div className="walk-in-handover">
        <Image src={visit.qrDataUrl} alt="Scan this visit QR in the STOR24 Counter app" width={280} height={280} unoptimized />
        <div><p>Visit code</p><strong className="walk-in-visit-code">{visit.visitCode}</strong><p>Expires at {new Date(visit.expiresAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" })} (South Africa)</p></div>
      </div>}
      {expired && <p role="status">Prepare a new visit to get a fresh QR and code.</p>}
      <div className="form-actions"><button className="button button-primary" disabled={busy} onClick={() => void start()}>Prepare another visit</button>{!expired && <a className="button button-secondary" href={visit.launchUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open on this device</a>}</div>
      <p>Install the counter app once on the tablet: open <a href="https://stor24.co.za/walk-in" target="_blank" rel="noopener noreferrer">stor24.co.za/walk-in</a> and choose Install app or Add to Home Screen. Hand the tablet over only after the correct store is visible.</p></>}
    <div><p className="eyebrow">3 · Staff completion</p><p>After the customer finishes, clear the tablet and open Move in to review identity, payment and access checks before handing over the unit.</p><a className="button button-secondary" href="/operations/move-in">Open Move in</a></div>
  </section>;
}
