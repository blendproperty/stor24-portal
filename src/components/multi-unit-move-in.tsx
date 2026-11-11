"use client";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { southAfricaDateKey } from "@/lib/south-africa-time";
type Unit = { id: string; facilityId: string; number: string; rate: number; type: string };
type Draft = { requestKey: string; facilityId: string; customerId: string; paymentMethod: string; units: { unitId: string; startDate: string; monthlyRate: number; initialCharge: number }[] };
type Receipt = { unitId: string; unitNumber: string; documentId: string; accountId: string }[];
const storageKey = "stor24-multi-unit-move-in";
export function MultiUnitMoveIn({ facilities, units, customers }: { facilities: { id: string; name: string }[]; units: Unit[]; customers: { id: string; name: string; email: string | null }[] }) {
  const [facilityId, setFacility] = useState(facilities[0]?.id ?? "");
  const [customerId, setCustomer] = useState("");
  const [search, setSearch] = useState("");
  const [paymentMethod, setPayment] = useState("");
  const [selected, setSelected] = useState<Draft["units"]>([]);
  const [review, setReview] = useState(false);
  const [pending, setPending] = useState<Draft | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => { try { const saved = sessionStorage.getItem(storageKey); if (saved) { const state = JSON.parse(saved); setPending(state.draft); setReceipt(state.receipt ?? null); } setLoaded(true); } catch { setError("The saved recovery details could not be read. Review the customer accounts before starting again."); } }, 0); return () => window.clearTimeout(timer); }, []);
  function toggle(unit: Unit) {
    setSelected(current => current.some(item => item.unitId === unit.id) ? current.filter(item => item.unitId !== unit.id) : [...current, { unitId: unit.id, startDate: southAfricaDateKey(new Date()), monthlyRate: unit.rate, initialCharge: 0 }]);
  }
  function change(id: string, patch: Partial<Draft["units"][number]>) { setSelected(current => current.map(item => item.unitId === id ? { ...item, ...patch } : item)); }
  async function submit(draft: Draft) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(draft); setBusy(true); setError("");
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ draft }));
      const response = await fetch("/api/v1/move-in-batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft), signal: AbortSignal.timeout(60000) });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "One or more units are no longer available, or this request does not match the saved batch. Review the customer accounts and unit status before starting again." : "The save could not be confirmed. Retry this same request or review the customer accounts before starting again.");
      if (!Array.isArray(result.data?.documents) || result.data.documents.length !== draft.units.length || result.data.documents.some((d: { documentId?: string; accountId?: string; unitId?: string; unitNumber?: string }) => !d.documentId || !d.accountId || !d.unitId || !d.unitNumber)) throw new Error("The save could not be confirmed. Retry this same request.");
      setReceipt(result.data.documents); sessionStorage.setItem(storageKey, JSON.stringify({ draft, receipt: result.data.documents }));
    } catch (e) { setError(e instanceof Error ? e.message : "The save could not be confirmed. Retry this same request."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const visibleUnits = units.filter(u => u.facilityId === facilityId && `${u.number} ${u.type}`.toLowerCase().includes(search.trim().toLowerCase()));
  if (!loaded) return <p role="status">{error || "Checking for an unfinished move-in…"}</p>;
  if (pending) return <div className="page-stack multi-unit-move-in"><h1>Multi-unit move-in</h1>{error && <p role="alert" className="form-error">{error}</p>}{receipt ? <section className="panel"><h2>Units saved for agreement signing</h2><p>Each unit has its own account and agreement. Open each agreement to prepare, review and sign it. If signing preparation fails, use the retry on that saved agreement. Payment and key handover remain separate.</p>{receipt.map(item => <p key={item.documentId}><strong>Unit {item.unitNumber}</strong> <a className="button button-secondary" href={`/operations/lease-signing?document=${encodeURIComponent(item.documentId)}`}>Open agreement</a> <a href={`/operations/accounts?accountId=${encodeURIComponent(item.accountId)}`}>Review account</a></p>)}</section> : <section className="panel"><h2>Review save status</h2><p>The result is uncertain. Retry the same request to recover the saved agreements without creating a second batch.</p><button disabled={busy} className="button button-primary" onClick={() => void submit(pending)}>{busy ? "Checking…" : "Retry / recover saved batch"}</button></section>}<button disabled={busy} className="button button-secondary" onClick={() => { if (confirm("Only start again after checking the customer accounts and unit status. Clear this recovery record?")) { sessionStorage.removeItem(storageKey); setPending(null); setReceipt(null); setSelected([]); setReview(false); setError(""); } }}>Start another move-in</button></div>;
  return <div className="page-stack multi-unit-move-in">
    <PageHeader eyebrow="Operations · Move in" title="Move in multiple units" description="Select available units at one store for one customer. A separate lease and account will be created for each unit." />
    <a className="multi-unit-back" href="/operations/move-in">← Back to move in</a>
    {!review ? <section className="panel multi-unit-panel">
      <div className="multi-unit-heading"><div><p className="eyebrow">Step 1 of 2</p><h2>Choose units</h2><p>Select up to 20 available units at the same store.</p></div><span className="multi-unit-count" aria-live="polite">{selected.length} selected</span></div>
      <div className="multi-unit-filters"><label>Store<select value={facilityId} onChange={e => { setFacility(e.target.value); setSelected([]); }} >{facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Find a unit<input type="search" value={search} placeholder="Search unit number or type" onChange={e => setSearch(e.target.value)} /></label></div>
      <div className="multi-unit-list" aria-label="Available units">{visibleUnits.map(unit => <label className="multi-unit-option" key={unit.id}><input type="checkbox" checked={selected.some(i => i.unitId === unit.id)} disabled={selected.length >= 20 && !selected.some(i => i.unitId === unit.id)} onChange={() => toggle(unit)} /><span><strong>Unit {unit.number}</strong><small>{unit.type}</small></span><b>R {unit.rate.toFixed(2)} <small>/ month</small></b></label>)}{!visibleUnits.length && <p className="multi-unit-empty">No available units match this search.</p>}</div>
      <div className="multi-unit-footer"><span>{selected.length ? `${selected.length} unit${selected.length === 1 ? "" : "s"} ready to review` : "Choose at least one unit to continue."}</span><button type="button" className="button button-primary" disabled={!selected.length} onClick={() => setReview(true)}>Review {selected.length} selected unit{selected.length === 1 ? "" : "s"} →</button></div>
    </section> : <form className="panel multi-unit-panel multi-unit-review" onSubmit={e => { e.preventDefault(); const draft = { requestKey: crypto.randomUUID(), facilityId, customerId, paymentMethod, units: selected }; void submit(draft); }}>
      <div className="multi-unit-heading"><div><p className="eyebrow">Step 2 of 2</p><h2>Review the details</h2><p>Check the customer and payment method, then review the details for each unit.</p></div><span className="multi-unit-count">{selected.length} selected</span></div>
      <div className="multi-unit-customer"><label>Customer<select value={customerId} required onChange={e => setCustomer(e.target.value)}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? "" : " (email required)"}</option>)}</select></label><label>Payment method<select required value={paymentMethod} onChange={e => setPayment(e.target.value)}><option value="">Select payment method</option><option value="DEBIT_ORDER">Debit order</option><option value="CARD">Credit / debit card</option><option value="EFT">EFT</option><option value="OTHER">Other</option></select></label></div>
      <p className="multi-unit-note">Initial charges are entered manually and require the usual billing approval. Each agreement uses the selected payment method; the customer must review and sign each one.</p>
      <div className="multi-unit-cards">{selected.map(item => <fieldset className="multi-unit-card" key={item.unitId}><legend>Unit {units.find(u => u.id === item.unitId)?.number}</legend><div className="multi-unit-fields"><label>Start date<input required type="date" value={item.startDate} onChange={e => change(item.unitId, { startDate: e.target.value })} /></label><label>Monthly rent<input required type="number" min="0" max="10000000" step="0.01" value={item.monthlyRate} onChange={e => change(item.unitId, { monthlyRate: e.target.valueAsNumber })} /></label><label>Agreed initial charge<input required type="number" min="0" max="10000000" step="0.01" value={item.initialCharge} onChange={e => change(item.unitId, { initialCharge: e.target.valueAsNumber })} /></label></div><p>Agreement deposit: <strong>R {Number.isFinite(item.monthlyRate) ? item.monthlyRate.toFixed(2) : "—"}</strong> (equal to monthly rent). {paymentMethod === "DEBIT_ORDER" ? "The separate debit-order mandate is completed after the lease is signed." : ""}</p></fieldset>)}</div>
      {customerId && !customers.find(c => c.id === customerId)?.email && <p role="alert" className="form-error">Add an email address to this customer before continuing.</p>}
      <label className="multi-unit-confirm"><input type="checkbox" required /><span>I have reviewed the unit, dates, rent, deposit, initial charge and payment method for each agreement.</span></label>
      <div className="multi-unit-footer"><button type="button" className="button button-secondary" onClick={() => setReview(false)}>← Back to units</button><button className="button button-primary" disabled={busy || !customers.find(c => c.id === customerId)?.email}>Confirm and save all units</button></div>
    </form>}
  </div>;
}
