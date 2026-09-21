"use client";
import React, { useCallback, useEffect, useState } from "react";
import { debitMessage } from "@/lib/debit-order-messages";
type Run = { id: string; batchName: string; period: string; actionDate: string; status: string; total: string; failureCode: string | null; _count: { instructions: number } };
type Workspace = { facilities: Array<{ id: string; name: string }>; accounts: Array<{ id: string; accountNumber: string; tenancy: { facilityId: string } }>; runs: Run[]; submissionEnabled: boolean };
type Preview = { fingerprint: string; total: number; rows: Array<{ accountId: string; accountNumber: string; amount: number; blocker?: string; reference?: string }> };
type Plan = { active: boolean; firstPeriod: string; approvalReference: string; masterfileConfirmed: true };
type AccountDetail = { plan: Plan | null; mandate: { reference: string; status: string; environment: string | null; signedPdfAvailable: boolean } | null };
const money = (value: number | string) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value));
const statusNames: Record<string, string> = { PREPARED: "Prepared — unsent", SUBMITTING: "Upload started — check before retrying", SUBMITTED: "Awaiting upload report", ACCEPTED: "Upload accepted — not payment", REJECTED: "Upload rejected — review required", REVIEW_REQUIRED: "Review required — reserved", CANCELLED: "Cancelled before upload" };
async function api(body?: unknown, accountId?: string) {
  const response = await fetch(`/api/v1/billing/debit-orders${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Unable to load debit orders."); return value;
}
export function DebitOrderWorkspace() {
  const [data, setData] = useState<Workspace | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [period, setPeriod] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7));
  const [actionDate, setActionDate] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accountId, setAccountId] = useState("");
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [plan, setPlan] = useState<Plan>({ active: true, firstPeriod: period, approvalReference: "", masterfileConfirmed: true });
  const [masterConfirmed, setMasterConfirmed] = useState(false);
  const [runConfirm, setRunConfirm] = useState<Record<string, string>>({});
  const [runReviews, setRunReviews] = useState<Record<string, Preview>>( {} );
  const load = useCallback(async () => { const next = await api(); setData(next); }, []);
  useEffect(() => { let current = true; void api().then(value => { if (current) setData(value); }).catch(e => { if (current) setMessage(e.message); }); return () => { current = false; }; }, []);
  useEffect(() => {
    let current = true;
    if (accountId) void api(undefined, accountId).then(value => { if (current) { setDetail(value); setPlan(value.plan ?? { active: true, firstPeriod: period, approvalReference: "", masterfileConfirmed: true }); } }).catch(e => { if (current) setMessage(e.message); });
    return () => { current = false; };
  }, [accountId, period]);
  function invalidate() { setPreview(null); setConfirmed(false); setMessage(""); }
  async function act(body: object, success: string) {
    setBusy(true); setMessage("");
    try { const result = await api(body); setMessage(success); await load(); return result; }
    catch (e) { setMessage(e instanceof Error ? e.message : "The operation failed."); return null; }
    finally { setBusy(false); }
  }
  return <div className="monthly-billing debit-order-workspace">
    <section className="monthly-card"><strong>Controlled test release · Live collections are off</strong><p>Prepare standard EFT debit-order batches using signed mandates and posted monthly invoices. Preparation does not send anything to Netcash. Submission requires separately enabled test accounts and dates.</p><p>Netcash upload acceptance is not a receipt or payout. Settlement, unpaid returns and the agreed retention period must be reconciled separately.</p></section>
    {message && <p role="status" className="monthly-card">{message}</p>}
    {!data ? <p>Loading permitted stores and runs…</p> : <>
      <section className="monthly-card debit-run-controls"><h2>Review the collection run</h2><div className="monthly-grid">
        <label>Store<select aria-label="Store" value={facilityId} disabled={busy} onChange={e => { setFacilityId(e.target.value); setAccountId(""); setDetail(null); setMasterConfirmed(false); invalidate(); }}><option value="">Select store</option>{data.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>Billing month<input type="month" value={period} disabled={busy} onChange={e => { setPeriod(e.target.value); setDetail(null); setMasterConfirmed(false); invalidate(); }}/></label>
        <label>Collection date<input type="date" value={actionDate} disabled={busy} onChange={e => { setActionDate(e.target.value); invalidate(); }}/></label>
      </div><p>Use the signed debit day. Holiday changes and provider cut-off dates need approval; this screen will not silently shift a collection date.</p>
      <button className="button button-primary" disabled={busy || !facilityId || !period || !actionDate} onClick={async () => { invalidate(); const value = await act({ action: "preview", facilityId, period, actionDate }, "Preview ready. Review every exception before preparing."); if (value) setPreview(value); }}>Preview collection run</button></section>
      {preview && <section className="monthly-card debit-preview"><h2>Batch preview</h2><p>{preview.rows.filter(r => !r.blocker).length} ready · {preview.rows.filter(r => r.blocker).length} requiring attention · {money(preview.total)}</p>
        <div className="debit-table-wrap"><table><thead><tr><th>Account</th><th>Amount</th><th>Readiness</th></tr></thead><tbody>{preview.rows.map(r => <tr key={r.accountId}><td>{r.accountNumber}</td><td>{r.blocker ? "—" : money(r.amount)}</td><td>{r.blocker ? debitMessage(r.blocker) : `Ready · ${r.reference}`}</td></tr>)}</tbody></table></div>
        {!preview.rows.length && <p>No active tenant accounts in this store.</p>}
        <label className="monthly-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>I reviewed the ready accounts and exclusions. Prepare only the ready accounts.</label>
        <button className="button button-primary" disabled={busy || !confirmed || !preview.rows.some(r => !r.blocker)} onClick={async () => { const result = await act({ action: "prepare", facilityId, period, actionDate, fingerprint: preview.fingerprint, confirm: true }, "Run saved. Nothing has been uploaded or collected."); if (result) { setPreview(null); setConfirmed(false); } }}>Save prepared run</button>
      </section>}
      <details className="monthly-card debit-account-plan"><summary>Account collection terms</summary><p>A signed Netcash mandate and confirmed existing masterfile entry are required. Bank details stay with Netcash. Pausing here does not cancel a batch already submitted to Netcash.</p>
        <label>Account<select aria-label="Account" value={accountId} disabled={busy} onChange={e => { setAccountId(e.target.value); setDetail(null); setMasterConfirmed(false); invalidate(); }}><option value="">Select account</option>{data.accounts.filter(a => !facilityId || a.tenancy.facilityId === facilityId).map(a => <option key={a.id} value={a.id}>{a.accountNumber}</option>)}</select></label>
        {accountId && !detail && <p>Loading mandate and approved terms…</p>}
        {detail && <><p>{detail.mandate ? `Mandate ${detail.mandate.reference} · ${detail.mandate.status} · ${detail.mandate.environment ?? "environment unverified"}` : "No hosted mandate is attached to this tenancy. Complete the customer's mandate setup first."}</p>{detail.mandate && <button className="button button-secondary" disabled={busy} onClick={async () => { invalidate(); const result = await act({ action: "refresh-mandate", accountId }, "Mandate check requested. Netcash reports are asynchronous; check again after 30 seconds if still pending."); if (result) setDetail(result); }}>Check mandate with Netcash</button>}<div className="monthly-grid">
          <label>First collection month<input type="month" value={plan.firstPeriod} disabled={busy} onChange={e => { setPlan({ ...plan, firstPeriod: e.target.value }); invalidate(); }}/></label>
          <label>Approval / masterfile evidence<input value={plan.approvalReference} maxLength={200} disabled={busy} onChange={e => { setPlan({ ...plan, approvalReference: e.target.value }); invalidate(); }}/></label>
        </div><label className="monthly-check"><input type="checkbox" checked={plan.active} disabled={busy} onChange={e => { setPlan({ ...plan, active: e.target.checked }); invalidate(); }}/>Include this account in collection runs</label>
        <label className="monthly-check"><input type="checkbox" checked={masterConfirmed} disabled={busy} onChange={e => setMasterConfirmed(e.target.checked)}/>I confirmed the signed mandate and matching existing Netcash masterfile reference.</label>
        <button className="button button-secondary" disabled={busy || !masterConfirmed || plan.approvalReference.trim().length < 5 || (plan.active && (!detail.mandate?.signedPdfAvailable || detail.mandate.status !== "SIGNED" || detail.mandate.environment !== "sandbox"))} onClick={async () => { const result = await act({ action: "plan", accountId, plan }, "Collection terms saved. Preview again before preparing a run."); if (result) setDetail({ ...detail, plan }); }}>Save collection terms</button></>}
      </details>
      <section className="monthly-card debit-run-history"><h2>Saved runs</h2>{!data.runs.length && <p>No collection runs have been prepared.</p>}
        {data.runs.map(run => <article className="debit-run" key={run.id}><h3>{run.batchName}</h3><p>{run.actionDate} · {money(run.total)} · {statusNames[run.status] ?? "Review required"}</p>{run.failureCode && <p>{debitMessage(run.failureCode)}</p>}
          <button className="button button-secondary" disabled={busy} onClick={async () => { setBusy(true); try { const response = await fetch(`/api/v1/billing/debit-orders?runId=${encodeURIComponent(run.id)}`, { cache: "no-store" }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setRunReviews(previous => ({ ...previous, [run.id]: value })); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load the saved review."); } finally { setBusy(false); } }}>View saved accounts and exclusions</button>
          {runReviews[run.id] && <ul>{runReviews[run.id].rows.map(row => <li key={row.accountId}>{row.accountNumber} · {row.blocker ? debitMessage(row.blocker) : `${money(row.amount)} · ${row.reference}`}</li>)}</ul>}
          {run.status === "PREPARED" && <><label>Type batch name to submit this test run<input value={runConfirm[run.id] ?? ""} disabled={busy || !data.submissionEnabled} onChange={e => setRunConfirm({ ...runConfirm, [run.id]: e.target.value })}/></label><div className="debit-actions"><button className="button button-primary" disabled={busy || !data.submissionEnabled || runConfirm[run.id] !== run.batchName} onClick={() => void act({ action: "submit", id: run.id, confirmBatchName: runConfirm[run.id] }, "Test upload submitted. Retrieve the load report; this is not payment.")}>Submit test batch</button><button className="button button-secondary" disabled={busy} onClick={() => void act({ action: "cancel", id: run.id, confirm: true }, "Unsent run cancelled. Its original review remains in the audit history.")}>Cancel unsent run</button></div></>}
          {["SUBMITTED", "REVIEW_REQUIRED"].includes(run.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act({ action: "refresh", id: run.id }, "Upload report checked. Review the saved status.")}>Check upload report</button>}
        </article>)}
      </section>
    </>}
  </div>;
}
