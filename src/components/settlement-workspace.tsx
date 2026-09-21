"use client";
import { useEffect, useRef, useState } from "react";
import type { settlementDetail, settlementWorkspace } from "@/lib/settlement-service";
import type { parseDailyStatement } from "@/lib/settlement-policy";
type Json<T> = T extends Date ? string : T extends { toFixed: (...args: never[]) => unknown } ? string : T extends Array<infer U> ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type Workspace = Json<Awaited<ReturnType<typeof settlementWorkspace>>>;
type Detail = Json<Awaited<ReturnType<typeof settlementDetail>>>;
type Preview = ReturnType<typeof parseDailyStatement> & { fingerprint: string; merchantLabel: string; environment: string };
const endpoint = "/api/v1/billing/settlements";
const money = (v: unknown) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(v));
async function api<T>(path = "", body?: unknown): Promise<T> {
  const r = await fetch(endpoint + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const v = await r.json(); if (!r.ok) throw new Error(v.error ?? "Unable to load reconciliation."); return v;
}
export function SettlementWorkspace() {
  const [data, setData] = useState<Workspace | null>(null), [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [connectionId, setConnection] = useState(""), [date, setDate] = useState(""), [raw, setRaw] = useState(""), [sourceReference, setSource] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null), [confirmed, setConfirmed] = useState(false), [ticket, setTicket] = useState("");
  const [bankRaw, setBankRaw] = useState(""), [bankAlias, setBankAlias] = useState(""), [bankEnvironment, setBankEnvironment] = useState("sandbox"), [bankReference, setBankReference] = useState(""), [bankConfirm, setBankConfirm] = useState(false);
  const [observedDate, setObservedDate] = useState(""), [current, setCurrent] = useState(""), [available, setAvailable] = useState(""), [balanceReference, setBalanceReference] = useState(""), [balanceConfirm, setBalanceConfirm] = useState(false);
  const [lineId, setLine] = useState(""), [targetId, setTarget] = useState(""), [reference, setReference] = useState(""), [merchantConfirmed, setMerchantConfirmed] = useState(false);
  const [reviewReference, setReviewReference] = useState(""), [reviewConfirm, setReviewConfirm] = useState(false);
  const request = useRef({ payload: "", key: "" }), selection = useRef(0);
  useEffect(() => { let alive = true; api<Workspace>().then(v => { if (alive) setData(v); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  const resetImport = () => { setPreview(null); setConfirmed(false); };
  async function run(fn: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to save."); } finally { setBusy(false); }
  }
  async function open(id: string) {
    const generation = ++selection.current; setDetail(null); setLine(""); setReviewConfirm(false); setReviewReference("");
    const v = await api<Detail>(`?id=${encodeURIComponent(id)}`);
    if (generation === selection.current) setDetail(v);
  }
  async function refresh(id?: string) {
    setData(await api<Workspace>()); if (id) await open(id);
  }
  async function file(file: File | undefined, assign: (v: string) => void) {
    if (!file) { assign(""); return; }
    if (file.size > 500000) { assign(""); setError("Use a file smaller than 500 KB, with at most 500 transactions."); return; }
    assign(await file.text());
  }
  async function mutate(body: unknown, statementId?: string) {
    await api("", body); await refresh(statementId); setMessage("Saved. Check the refreshed evidence.");
  }
  const line = detail?.lines.find(l => l.id === lineId);
  const options = !line || !detail ? [] : line.kind === "RECEIPT" ? detail.payments.filter(p => Number(p.amount) === Number(line.amount)).map(p => ({ id: p.id, label: `${p.account.accountNumber} · ${p.providerRef ?? p.id} · ${p.providerMerchantKey ? "merchant recorded" : "older merchant evidence required"}` })) : line.kind === "RETURN" ? detail.adjustments.filter(a => Number(a.amount) === -Number(line.amount)).map(a => ({ id: a.id, label: `${a.kind} · ${a.id}` })) : ["PAYOUT", "BANK_RETURN"].includes(line.kind) ? detail.bank.filter(b => Number(b.amount) === -Number(line.amount) && b.date >= line.date).map(b => ({ id: b.id, label: `${b.import.alias} · ${b.date} · ${b.transactionId} · ${b.reference}` })) : [];
  const needsTarget = !!line && !["FEE", "OTHER"].includes(line.kind);
  const selfReview = !!detail && (detail.importedById === data?.userId || detail.editedById === data?.userId || detail.lines.some(l => l.resolvedById === data?.userId));
  const unresolved = detail?.lines.filter(l => l.issue).length ?? 0;
  return <div className="settlement-workspace page-stack" aria-busy={busy}>
    <section className="panel settlement-boundary"><h2>Follow the money</h2><p>Organisation-wide finance access is required. Match receipts, returns and bank payouts separately; record fees against external accounting evidence. This workspace does not post money, release retained funds or send customer messages.</p><p>Reviewed means all statement lines have current evidence and independent review. It does not mean all funds have reached the bank. Test statements remain labelled sandbox; simulated receipts cannot prove live settlement.</p></section>
    {error && <p className="settlement-alert" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!data ? <p>{error ? "Workspace unavailable." : "Loading settlement evidence…"}</p> : <>
    <section className="panel settlement-import"><h2>1. Import a full daily statement</h2><p>Choose one past day. Netcash statements are available the following morning. Upload the original full tab-separated export, including opening and closing balances.</p>
      <div className="settlement-fields">
        <label>Merchant<select aria-label="Merchant" value={connectionId} disabled={busy} onChange={e => { setConnection(e.target.value); resetImport(); setTicket(""); setBalanceConfirm(false); }}><option value="">Choose merchant</option>{data.merchants.map(m => <option key={m.id} value={m.id} disabled={m.environment === "unknown"}>{m.label} · {m.environment}</option>)}</select></label>
        <label>Statement date<input type="date" value={date} max={data.today} disabled={busy} onChange={e => { setDate(e.target.value); resetImport(); setTicket(""); }}/></label>
      </div>
      <div className="settlement-actions"><button className="button button-secondary" disabled={busy || !date || date >= data.today || !data.merchants.find(m => m.id === connectionId)?.canFetch} onClick={() => run(async () => { const r = await api<{ ticket: string }>("", { action: "request", connectionId, date }); setTicket(r.ticket); setMessage("Request saved. Check again when Netcash has prepared the file."); })}>Request from Netcash</button>
        <button className="button button-secondary" disabled={busy || !ticket} onClick={() => run(async () => { const r = await api<{ pending?: boolean; id?: string }>("", { action: "retrieve", ticket }); if (r.pending) setMessage("Netcash is still preparing the file. Check again shortly."); else { setTicket(""); await refresh(r.id); setMessage("Provider statement imported as a draft."); } })}>Check requested file</button></div>
      <div className="settlement-fields"><label>Original statement file<input type="file" accept=".txt,.tsv" disabled={busy} onChange={e => { resetImport(); void file(e.target.files?.[0], setRaw); }}/></label>
        <label>Statement source / evidence reference<input value={sourceReference} maxLength={200} disabled={busy} onChange={e => { setSource(e.target.value); resetImport(); }}/></label></div>
      <button className="button button-secondary" disabled={busy || !raw || !connectionId || !date || date >= data.today || sourceReference.trim().length < 5} onClick={() => run(async () => { setPreview(await api<Preview>("", { action: "preview", connectionId, date, raw, sourceReference })); setConfirmed(false); })}>Preview statement</button>
      {preview && <div className="settlement-preview"><h3>{preview.merchantLabel} · {preview.environment} · {preview.date}</h3><p>Opening {money(preview.opening)} + movement {money(preview.movement)} = closing {money(preview.closing)}. {preview.lines.length} movements. VAT is already included.</p>
        <label className="settlement-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>I checked the original statement belongs to this merchant, environment and day.</label>
        <button className="button button-primary" disabled={busy || !confirmed} onClick={() => run(async () => { const r = await api<{ id: string }>("", { action: "import", connectionId, date, raw, sourceReference, fingerprint: preview.fingerprint, confirm: true }); resetImport(); await refresh(r.id); setMessage("Statement imported as a draft."); })}>Import reviewed source</button></div>}
    </section>
    <section className="panel settlement-bank"><h2>2. Add bank and retained-funds evidence</h2>
      <details><summary>Import bank movements</summary><p>Use a consistent bank account alias and original bank transaction IDs. CSV columns: <code>transaction_id,date,amount,reference</code>. Dates use YYYY-MM-DD, amounts use a decimal point; bank credits are positive and debits negative. Maximum 500 rows. One provider payout must match one bank row; investigate combined transfers separately.</p>
        <div className="settlement-fields"><label>Bank account alias<input value={bankAlias} maxLength={80} disabled={busy} onChange={e => { setBankAlias(e.target.value); setBankConfirm(false); }}/></label>
          <label>Bank environment<select value={bankEnvironment} disabled={busy} onChange={e => { setBankEnvironment(e.target.value); setBankConfirm(false); }}><option value="sandbox">Sandbox / practice</option><option value="live">Live bank evidence</option></select></label>
          <label>Bank CSV file<input type="file" accept=".csv" disabled={busy} onChange={e => { setBankConfirm(false); void file(e.target.files?.[0], setBankRaw); }}/></label>
          <label>Bank source reference<input value={bankReference} maxLength={200} disabled={busy} onChange={e => { setBankReference(e.target.value); setBankConfirm(false); }}/></label></div>
        <label className="settlement-check"><input type="checkbox" checked={bankConfirm} disabled={busy} onChange={e => setBankConfirm(e.target.checked)}/>I verified the bank source, signs, stable row IDs and environment.</label>
        <button className="button button-secondary" disabled={busy || !bankConfirm || !bankRaw || bankAlias.trim().length < 3 || bankReference.trim().length < 5} onClick={() => run(async () => { await mutate({ action: "bank-import", alias: bankAlias, environment: bankEnvironment, raw: bankRaw, sourceReference: bankReference, confirm: true }); setBankConfirm(false); })}>Import bank evidence</button>
        <p>Latest 30 imports. To void an unmatched import, enter the reason in Bank source reference and confirm above.</p>
        <ul>{data.bankImports.map(b => <li key={b.id}>{b.alias} · {b.environment} · {b.status} · {b._count.entries} rows · {b.sourceReference} {b.status === "ACTIVE" && <button disabled={busy || !bankConfirm || bankReference.trim().length < 5} onClick={() => run(() => mutate({ action: "void-bank", id: b.id, reference: bankReference, confirm: true }))}>Void unmatched import</button>}</li>)}</ul>
      </details>
      <details><summary>Record current and available funds</summary><p>Record a dated observation from the provider portal. The difference is held or reserved funds, not an expense or a new receipt. This does not predict a release date or prove a bank payout.</p>
        <div className="settlement-fields"><label>Observation date<input type="date" value={observedDate} max={data.today} disabled={busy} onChange={e => { setObservedDate(e.target.value); setBalanceConfirm(false); }}/></label>
          <label>Provider current balance<input inputMode="decimal" value={current} disabled={busy} onChange={e => { setCurrent(e.target.value); setBalanceConfirm(false); }}/></label>
          <label>Provider available balance<input inputMode="decimal" value={available} disabled={busy} onChange={e => { setAvailable(e.target.value); setBalanceConfirm(false); }}/></label>
          <label>Balance evidence reference<input value={balanceReference} maxLength={200} disabled={busy} onChange={e => { setBalanceReference(e.target.value); setBalanceConfirm(false); }}/></label></div>
        <label className="settlement-check"><input type="checkbox" checked={balanceConfirm} disabled={busy} onChange={e => setBalanceConfirm(e.target.checked)}/>I checked both balances against the selected merchant and dated source.</label>
        <button className="button button-secondary" disabled={busy || !connectionId || !observedDate || !current || !available || balanceReference.trim().length < 5 || !balanceConfirm} onClick={() => run(async () => { await mutate({ action: "balance", connectionId, observedDate, current, available, reference: balanceReference, confirm: true }); setBalanceConfirm(false); })}>Record balance observation</button>
        <ul>{data.observations.map(o => <li key={o.id}>{o.observedDate} · {o.merchantLabel} · {o.environment} · current {money(o.current)} · available {money(o.available)} · held / reserved {money(o.held)} · {o.reference}</li>)}</ul>
      </details>
    </section>
    <section className="panel settlement-history"><h2>3. Match and independently review</h2><p>Latest 50 statements. Open a statement to recheck its current source evidence, including previously reviewed statements.</p>
      {!data.statements.length && <p>No statements imported.</p>}
      <div className="settlement-list">{data.statements.map(s => <button className="button button-secondary" key={s.id} disabled={busy} onClick={() => run(() => open(s.id))}>{s.date} · {s.merchantLabel} · {s.environment} · {s.status} · {s._count.lines} movements</button>)}</div>
    </section>
    {detail && <section className="panel settlement-review"><h2>{detail.date} · {detail.merchantLabel}</h2><p>{detail.environment} · {detail.status} · {unresolved} current exceptions. Opening {money(detail.opening)} · closing {money(detail.closing)}</p><p>{detail.source} · {detail.sourceReference}</p>{detail.approvalReference && <p>Independent review: {detail.approvalReference}</p>}
      <div className="settlement-actions"><button className="button button-secondary" disabled={busy} onClick={() => run(() => open(detail.id))}>Refresh source checks</button><a className="button button-secondary" href={`${endpoint}?id=${detail.id}&export=csv`}>Export this review</a></div>
      {detail.candidatesTruncated && <p role="alert">Only the latest 500 candidates of each type are listed. Do not explain away a missing match; ask finance to investigate.</p>}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Provider movement</th><th>Amount / included VAT</th><th>Evidence</th><th>Review</th></tr></thead><tbody>{detail.lines.map(l => <tr key={l.id}><td>{l.transactionId} · {l.code} · {l.kind}<br/>{l.description}<br/>{Array.isArray(l.extras) ? l.extras.join(" · ") : ""}</td><td>{money(l.amount)}<br/>VAT {money(l.vat)}</td><td>{l.issue ?? "Current evidence matched"}<br/>{l.reference}<br/>{l.paymentId ?? l.adjustmentId ?? l.bankEntryId}</td><td><button disabled={busy || detail.status !== "DRAFT"} onClick={() => { setLine(l.id); setTarget(""); setReference(""); setMerchantConfirmed(false); }}>Review {l.transactionId}</button></td></tr>)}</tbody></table></div>
      {line && detail.status === "DRAFT" && <div className="settlement-preview"><h3>Match {line.transactionId} · {line.kind}</h3>
        {needsTarget ? <label>Exact source match<select aria-label="Exact source match" value={targetId} disabled={busy} onChange={e => { setTarget(e.target.value); setMerchantConfirmed(false); }}><option value="">Choose matching evidence</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label> : <p>Record the actual external accounting entry or documented explanation. This does not create an accounting entry or prove receipt/bank settlement.</p>}
        <label>Match evidence / accounting reference<input value={reference} maxLength={200} disabled={busy} onChange={e => setReference(e.target.value)}/></label>
        {["RECEIPT", "RETURN"].includes(line.kind) && <label className="settlement-check"><input type="checkbox" checked={merchantConfirmed} disabled={busy} onChange={e => setMerchantConfirmed(e.target.checked)}/>The original payment evidence confirms this merchant and statement transaction.</label>}
        <button className="button button-primary" disabled={busy || reference.trim().length < 5 || (needsTarget && !targetId) || (["RECEIPT", "RETURN"].includes(line.kind) && !merchantConfirmed)} onClick={() => run(async () => {
          const body = { action: "resolve", id: detail.id, revision: detail.revision, lineId, targetId: needsTarget ? targetId : null, reference, merchantConfirmed };
          const payload = JSON.stringify(body); if (request.current.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
          await mutate({ ...body, requestKey: request.current.key }, detail.id);
        })}>Save line evidence</button></div>}
      {detail.status !== "VOID" && <div className="settlement-preview"><label>Review / reopen / void reference<input value={reviewReference} maxLength={200} disabled={busy} onChange={e => { setReviewReference(e.target.value); setReviewConfirm(false); }}/></label>
        <label className="settlement-check"><input type="checkbox" checked={reviewConfirm} disabled={busy} onChange={e => setReviewConfirm(e.target.checked)}/>I checked this statement, its current evidence and the reason for this action.</label>
        {selfReview && detail.status === "DRAFT" && <p>A different finance colleague must perform the final review.</p>}
        <div className="settlement-actions">{(detail.status === "DRAFT" ? ["approve", "void"] : ["reopen"]).map(action => <button key={action} className="button button-secondary" disabled={busy || !reviewConfirm || reviewReference.trim().length < 5 || (action === "approve" && (selfReview || unresolved > 0))} onClick={() => run(() => mutate({ action, id: detail.id, revision: detail.revision, reference: reviewReference, confirm: true }, detail.id))}>{action === "approve" ? "Record independent review" : action === "void" ? "Void this draft" : "Reopen for correction"}</button>)}</div>
      </div>}
    </section>}
    </>}
  </div>;
}
