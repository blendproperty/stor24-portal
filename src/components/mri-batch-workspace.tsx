"use client";
import { useEffect, useState } from "react";
import { MRI_MOVEMENTS } from "@/lib/mri-mapping-policy";
import type { SandboxSource } from "@/lib/mri-batch-policy";
import type { mriBatchReview } from "@/lib/mri-batch-service";
type Batch = Awaited<ReturnType<typeof mriBatchReview>>;
const endpoint = "/api/v1/billing/mri/sandbox/batches";
const lastMonth = () => { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).formatToParts(new Date()); const year = Number(parts.find(p => p.type === "year")!.value), month = Number(parts.find(p => p.type === "month")!.value); return new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 7); };
const newRow = (index: number): SandboxSource["rows"][number] => ({ sourceKey: `TEST-${index}`, movement: "CHARGE", category: "charge", amount: "0.00", taxAmount: "0.00", reversalOf: null });
export function MriBatchWorkspace() {
  const [period, setPeriod] = useState(lastMonth), [batch, setBatch] = useState<Batch | null>(null), [rows, setRows] = useState<SandboxSource["rows"]>([newRow(1)]);
  const [canManage, setCanManage] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [reference, setReference] = useState("");
  const accept = (value: Batch) => { setBatch(value); setRows(value.source?.rows ?? [newRow(1)]); setDirty(false); setReference(""); };
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${endpoint}?period=${encodeURIComponent(period)}`, { cache: "no-store", signal: abort.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error); accept(data.batch); setCanManage(data.canManage); }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load batch."); });
    return () => abort.abort();
  }, [period]);
  async function act(action: "save" | "submit" | "approve" | "reopen" | "void") {
    if (!batch) return; setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, period, revision: batch.revision, ...(action === "save" ? { source: { origin: "SANDBOX_MANUAL", currency: "ZAR", rows } } : { reference }) }) });
      const data = await r.json(); if (!r.ok) throw Error(data.error); accept(data.batch); setNotice(action === "save" ? "Draft snapshot saved and preview recalculated." : `Batch ${action === "approve" ? "approved for internal sandbox review" : action === "submit" ? "submitted for independent review" : action === "reopen" ? "reopened" : "voided"}. No journal was sent to MRI.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save batch."); } finally { setBusy(false); }
  }
  function edit(index: number, key: keyof SandboxSource["rows"][number], value: string) { setRows(rows.map((r, i) => i === index ? { ...r, [key]: key === "reversalOf" ? value || null : value } : r)); setDirty(true); }
  const editable = canManage && !busy && !!batch && ["DRAFT", "NOT_CREATED"].includes(batch.status);
  return <div className="mri-mapping mri-batches"><a href="/billing/mri/sandbox">← MRI sandbox testing</a><header><p className="mapping-kicker">Sandbox preparation · No provider submission</p><h1>Sandbox journal batches</h1><p>Prepare controlled ZAR test sources, inspect exact debit/credit totals and obtain independent review while the MRI test property is arranged.</p></header>
    {error && <p role="alert" className="mapping-error">{error}</p>}{notice && <p role="status" className="mapping-notice">{notice}</p>}
    <section className="mapping-panel"><h2>Test period and mappings</h2><label>Batch month<input type="month" value={period} disabled={busy} onChange={e => { setPeriod(e.target.value); setBatch(null); setError(""); setNotice(""); }} /></label><p><a href="/billing/mri/sandbox/mapping">Prepare sandbox-only finance mappings</a>. Drafts may be saved before mappings are approved; submission requires an unchanged independent mapping approval and a closed calendar month.</p><p>Sources entered here are labelled manual sandbox data. They do not import production tenant entries or authorise payments.</p></section>
    {!batch && !error && <p role="status">Loading batch…</p>}
    {batch && <><section className="mapping-panel"><h2>Source snapshot</h2><p>Stage: <strong>{batch.status.replaceAll("_", " ")}</strong>{dirty && " · Unsaved changes"}. One batch per organisation and month; approved and void snapshots cannot be overwritten.</p><fieldset disabled={!editable}>
      {rows.map((r, i) => <div className="mapping-rule" key={i}><h3>Source {i + 1}</h3><div className="mapping-grid">
        <label>Source reference<input aria-label="Source reference" maxLength={80} value={r.sourceKey} onChange={e => edit(i, "sourceKey", e.target.value)} /></label>
        <label>Movement<select aria-label="Movement" value={r.movement} onChange={e => edit(i, "movement", e.target.value)}>{MRI_MOVEMENTS.map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Mapping category<input aria-label="Mapping category" maxLength={120} value={r.category} onChange={e => edit(i, "category", e.target.value)} /></label>
        <label>Recorded amount (ZAR)<input aria-label="Recorded amount (ZAR)" inputMode="decimal" value={r.amount} onChange={e => edit(i, "amount", e.target.value)} /></label>
        <label>Recorded tax (ZAR)<input aria-label="Recorded tax (ZAR)" inputMode="decimal" value={r.taxAmount} onChange={e => edit(i, "taxAmount", e.target.value)} /></label>
        <label>Original source for reversal<input aria-label="Original source for reversal" value={r.reversalOf ?? ""} onChange={e => edit(i, "reversalOf", e.target.value)} /></label>
      </div><button type="button" disabled={rows.length === 1} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }}>Remove source {i + 1}</button></div>)}
      <button type="button" disabled={rows.length >= 200} onClick={() => { setRows([...rows, newRow(rows.length + 1)]); setDirty(true); }}>Add source</button>
      <button type="button" onClick={() => { setRows([{ ...newRow(1), sourceKey: `FICTIONAL-${period}-RENT`, amount: "115.00", taxAmount: "15.00" }, { ...newRow(2), sourceKey: `FICTIONAL-${period}-RECEIPT`, movement: "PAYMENT", category: "payment", amount: "115.00" }]); setDirty(true); }}>Load fictional sample</button>
      <button type="button" onClick={() => act("save")}>Save draft and preview</button></fieldset><p>Use exact two-decimal, positive source amounts. Full reversals reference one original in the same snapshot; partial and cross-period reversals remain blocked. Source references reserved by another submitted period cannot be reused.</p></section>
      <section className="mapping-panel"><h2>Balanced preview and review</h2>{dirty && <p className="mapping-error">This preview describes the saved snapshot. Save the edited sources before review.</p>}
        {batch.blockers.length > 0 && <ul>{batch.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        {batch.preview && <><p>Debit: R{batch.preview.debitTotal} · Credit: R{batch.preview.creditTotal} · {batch.preview.balanced ? "Balanced" : "Blocked"}</p><div style={{ overflowX: "auto" }}><table><thead><tr><th>GL account</th><th>Tax code</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{batch.preview.lines.map((l, i) => <tr key={i}><td>{l.account}</td><td>{l.taxCode || "—"}</td><td>{l.debit}</td><td>{l.credit}</td></tr>)}</tbody></table></div></>}
        {batch.approvedAt && <p>Approved {new Date(batch.approvedAt).toLocaleString("en-ZA")} · {batch.approvalReference}</p>}
        {canManage && batch.status !== "VOID" && <><label>Review or change reference<input value={reference} maxLength={240} onChange={e => setReference(e.target.value)} /></label><div className="mapping-actions">
          {batch.status === "DRAFT" && <button disabled={busy || dirty || reference.trim().length < 3 || !!batch.blockers.length} onClick={() => act("submit")}>Submit batch for review</button>}
          {batch.status === "IN_REVIEW" && <><button disabled={busy || dirty || reference.trim().length < 3 || !batch.canApprove || !!batch.blockers.length} onClick={() => act("approve")}>Approve sandbox batch</button><button disabled={busy || reference.trim().length < 3} onClick={() => act("reopen")}>Reopen for corrections</button>{!batch.canApprove && <p>A different authorised reviewer must approve this batch.</p>}</>}
          {batch.revision && <button disabled={busy || dirty || reference.trim().length < 3} onClick={() => act("void")}>Void sandbox batch</button>}
        </div></>}
        {batch.status === "APPROVED" && !batch.blockers.length && <p><a href={`${endpoint}?period=${encodeURIComponent(period)}&revision=${batch.revision}&format=csv`} download>Download approved sandbox review CSV</a></p>}
        <p>Approval and download are internal preparation evidence. The CSV is not an MRI import and no journal is submitted. Test property, provider contract, submission/readback and finance reconciliation remain required.</p>
      </section></>}
  </div>;
}
