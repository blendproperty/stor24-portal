"use client";
import { useEffect, useState } from "react";
import { currentBillingPeriod, nextBillingPeriod, type BillingPlan, type BillingLine } from "@/lib/monthly-billing-policy";

type Account = { id: string; accountNumber: string; customer: { email: string | null; companyName: string | null; firstName: string | null; lastName: string | null }; tenancy: { facilityId: string; facility: { name: string }; status: string } | null };
type Preview = { fingerprint: string; customerName: string; total: number; taxTotal: number; lines: BillingLine[] };
const money = (n: number) => n.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
function blankPlan(): BillingPlan { return { firstPeriod: currentBillingPeriod(), proration: "ACTUAL_DAYS", taxPercent: 0, rentTaxable: false, insuranceEnabled: false, insuranceTaxable: false, charges: [], discount: null, approvalReference: "" }; }
async function request(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || "Unable to complete request");
  return json.data;
}
type MultiPreview = { periods: string[]; bills: Array<{ lines: BillingLine[]; total: number }>; total: number; fingerprint: string };
type PlanHistory={versions:Array<{recordNumber:number;kind:string;recordedAt:string;sourcePlanUpdatedAt:string|null;actorId:string|null;plan:BillingPlan;hash:string}>;nextBefore:number|null;coverage:string};
export function MonthlyBillingWorkspace() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [period, setPeriod] = useState(currentBillingPeriod());
  const [plan, setPlan] = useState<BillingPlan>(blankPlan);
  const [approved, setApproved] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [draft, setDraft] = useState<(Preview & { period: string }) | null>(null);
  const [draftConfirmed, setDraftConfirmed] = useState(false);
  const [multiStart, setMultiStart] = useState(currentBillingPeriod());
  const [multiCount, setMultiCount] = useState(2);
  const [multi, setMulti] = useState<MultiPreview | null>(null);
  const [multiConfirmed, setMultiConfirmed] = useState(false);
  const [nextPreview, setNextPreview] = useState<(Preview & { period: string }) | null>(null);
  const [history,setHistory]=useState<PlanHistory|null>(null);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<{ documentId: string; invoiceNumber: string } | null>(null);
  const [invoices, setInvoices] = useState<{ id: string; externalId: string }[]>([]);
  useEffect(() => { request("/api/v1/billing/monthly").then(setAccounts).catch(e => setError(e.message)); }, []);
  function edit(next: BillingPlan) { setMulti(null); setMultiConfirmed(false); setNextPreview(null); setPlan(next); setApproved(false); setPreview(null); setReviewed(false); setResult(null); }
  async function select(id: string) {
    setHistory(null);
    setAccountId(id); setMulti(null); setMultiConfirmed(false); setNotice(""); setDraft(null); setDraftConfirmed(false); setScheduleDate(""); setNextPreview(null); setPreview(null); setResult(null); setReviewed(false); setApproved(false); setPlan(blankPlan()); setInvoices([]);
    if (!id) return;
    setBusy(true); setError("");
    try { const selected = accounts.find(item => item.id === id); const [saved, schedule] = await Promise.all([request(`/api/v1/billing/monthly?accountId=${encodeURIComponent(id)}`), selected?.tenancy?.facilityId ? request(`/api/v1/billing/invoice-schedule?facilityId=${encodeURIComponent(selected.tenancy.facilityId)}`) : Promise.resolve(null)]); setPlan(saved.plan || blankPlan()); setApproved(Boolean(saved.plan)); setInvoices(saved.invoices); setScheduleDate(schedule?.date || ""); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function loadHistory(before?:number){setHistoryBusy(true);setError("");try{const data=await request(`/api/v1/billing/monthly?accountId=${encodeURIComponent(accountId)}&history=true${before?`&before=${before}`:""}`);setHistory(previous=>before&&previous?{...data,versions:[...previous.versions,...data.versions]}:data)}catch(e){setError((e as Error).message)}finally{setHistoryBusy(false)}}
  async function saveSchedule() {
    const facilityId = accounts.find(item => item.id === accountId)?.tenancy?.facilityId;
    if (!facilityId || !scheduleDate) return;
    setBusy(true); setError("");
    try { const saved = await request("/api/v1/billing/invoice-schedule", { facilityId, date: scheduleDate }); setScheduleDate(saved.date); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function loadDraft() {
    setBusy(true); setError(""); setDraft(null); setDraftConfirmed(false);
    try { setDraft(await request(`/api/v1/billing/monthly?accountId=${encodeURIComponent(accountId)}&draft=true`)); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function approveDraft() {
    if (!draft || !draftConfirmed) return;
    setBusy(true); setError("");
    try { const data = await request("/api/v1/billing/monthly", { action:"approve-draft", accountId, period:draft.period, fingerprint:draft.fingerprint, confirm:true }); setResult(data); setDraft(null); setDraftConfirmed(false); setInvoices(items => [{ id:data.documentId, externalId:data.invoiceNumber }, ...items]); }
    catch(e) { setDraft(null); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function reviewMultiple() {
    setBusy(true); setError(""); setMulti(null); setMultiConfirmed(false);
    try { setMulti(await request("/api/v1/billing/monthly",{action:"preview-multi",accountId,start:multiStart,count:multiCount})); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function postMultiple() {
    if (!multi || !multiConfirmed) return;
    setBusy(true); setError("");
    try { const data=await request("/api/v1/billing/monthly",{action:"post-multi",accountId,start:multiStart,count:multiCount,fingerprint:multi.fingerprint,confirm:true}); setResult(data); setInvoices(items=>[{id:data.documentId,externalId:data.invoiceNumber},...items]); setMulti(null); setMultiConfirmed(false); }
    catch(e) { setMulti(null); setMultiConfirmed(false); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function sendInvoice(id: string) {
    const account = accounts.find(item => item.id === accountId), email = account?.customer.email;
    if (!email) { setError("Add the customer's email address before sending."); return; }
    let allowNotice = false;
    if (account?.tenancy?.status === "NOTICE_GIVEN") { allowNotice = window.confirm("This customer is on notice. Confirm they still need this invoice before sending."); if (!allowNotice) return; }
    if (!window.confirm(`Send the saved invoice to ${email}? This does not post another charge.`)) return;
    setBusy(true); setError("");
    try { await request(`/api/v1/billing/monthly/invoice/${encodeURIComponent(id)}/send`, { requestId:crypto.randomUUID(), email, allowNotice, confirm:true }); setNotice("The email provider accepted the invoice. Inbox delivery is not confirmed."); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function previewNext() {
    setBusy(true); setError(""); setNextPreview(null);
    try { setNextPreview(await request("/api/v1/billing/monthly", { action: "preview-next", accountId })); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function act(action: "plan" | "preview" | "post") {
    setBusy(true); setError(""); setResult(null); setNextPreview(null);
    try {
      const data = await request("/api/v1/billing/monthly", action === "plan" ? { action, accountId, plan } : action === "post" ? { action, accountId, period, fingerprint: preview?.fingerprint, confirm: true } : { action, accountId, period });
      if (action === "plan") { setHistory(null); setApproved(true); setPreview(null); }
      if (action === "preview") { setPreview(data); setReviewed(false); }
      if (action === "post") { setResult(data); setPreview(null); setReviewed(false); setInvoices(items => [{ id: data.documentId, externalId: data.invoiceNumber }, ...items]); }
    } catch(e) { setError((e as Error).message); if (action !== "plan") setPreview(null); } finally { setBusy(false); }
  }
  return <div className="page-stack monthly-billing">
    <section className="panel"><p>Posting creates an account charge and a saved invoice. It does not collect money or email the customer. Charges are VAT-inclusive where marked taxable. Confirm the tax treatment, contract and first unbilled month with finance.</p>
      <div className="form-grid"><label>Customer account<select value={accountId} disabled={busy||historyBusy} onChange={e => void select(e.target.value)}><option value="">Select account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} · {a.customer.companyName || [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ")} · {a.tenancy?.facility.name}</option>)}</select></label><label>Billing month<input type="month" value={period} max={currentBillingPeriod()} disabled={busy||historyBusy} onChange={e => { setPeriod(e.target.value); setPreview(null); setResult(null); setReviewed(false); }}/></label></div>
    </section>
    {accountId && <section className="panel"><h2>Invoice generation date</h2><p>The usual date is the 17th. A manager can choose a different date in the current month for this store. Changing the date does not activate automatic invoicing or send invoices.</p><label>Generation date<input type="date" value={scheduleDate} disabled={busy || historyBusy} onChange={e => setScheduleDate(e.target.value)}/></label><button type="button" className="button button-secondary" disabled={busy || historyBusy || !scheduleDate} onClick={() => void saveSchedule()}>Save generation date</button></section>}
    {accountId && <section className="panel"><h2>Invoice for multiple months</h2><p>Review agreed charges for two to twelve months. Posting creates one invoice and charges the account for all selected months. Future charges affect the account balance immediately; confirm this treatment with finance.</p><label>First month<select value={multiStart} disabled={busy} onChange={e => { setMultiStart(e.target.value); setMulti(null); setMultiConfirmed(false); }}><option value={currentBillingPeriod()}>{currentBillingPeriod()}</option><option value={nextBillingPeriod()}>{nextBillingPeriod()}</option></select></label><label>Number of months<input type="number" min="2" max="12" value={multiCount} disabled={busy} onChange={e => { setMultiCount(Number(e.target.value)); setMulti(null); setMultiConfirmed(false); }}/></label><button type="button" className="button button-secondary" disabled={busy || !approved || multiCount<2 || multiCount>12} onClick={() => void reviewMultiple()}>Review multiple months</button>{multi && <div><h3>Review multiple months</h3>{multi.bills.map((bill,index)=><div key={multi.periods[index]}><strong>{multi.periods[index]} · {money(bill.total)}</strong><ul>{bill.lines.map(line=><li key={line.key}>{line.description}: {line.type === "CREDIT" ? "−" : ""}{money(line.amount)}</li>)}</ul></div>)}<p>Total {money(multi.total)}</p><label><input type="checkbox" checked={multiConfirmed} disabled={busy} onChange={e => setMultiConfirmed(e.target.checked)}/> I reviewed every month and approve posting these charges.</label><button type="button" className="button button-primary" disabled={busy || !multiConfirmed} onClick={() => void postMultiple()}>Post multiple months</button></div>}</section>}
    {accountId && <section className="panel"><h2>Manager invoice review</h2><p>Scheduled preparation creates a draft without changing the ledger. Review the account, charges and notice status before approving. Approval posts charges and saves an invoice; it does not email it.</p><button type="button" className="button button-secondary" disabled={busy || historyBusy} onClick={() => void loadDraft()}>Load prepared draft</button>{draft && <div><h3>Review draft for {draft.period}</h3><ul>{draft.lines.map(line => <li key={line.key}>{line.description}: {line.type === "CREDIT" ? "−" : ""}{money(line.amount)}</li>)}</ul><p>Total {money(draft.total)}</p><label><input type="checkbox" checked={draftConfirmed} disabled={busy} onChange={e => setDraftConfirmed(e.target.checked)}/> I reviewed the charges and customer notice status.</label><button type="button" className="button button-primary" disabled={busy || !draftConfirmed} onClick={() => void approveDraft()}>Approve and post invoice</button></div>}</section>}
    {accountId && <section className="panel"><h2>Next-month invoice preparation</h2><p>Review an estimate for next month ahead of the 17th. No invoice, ledger charge or email is created. Notice and discount cases are held for review.</p><button type="button" className="button button-secondary" disabled={busy || historyBusy || !approved} onClick={() => void previewNext()}>Review next month</button>{nextPreview && <div role="status"><h3>Estimate for {nextPreview.period} · {nextPreview.customerName}</h3><ul>{nextPreview.lines.map(line => <li key={line.key}>{line.description}: {line.type === "CREDIT" ? "−" : ""}{money(line.amount)}</li>)}</ul><p><strong>Estimated total: {money(nextPreview.total)}</strong> · Included tax: {money(nextPreview.taxTotal)}</p><p>Review only. Changes to the account or agreement can change this amount.</p></div>}</section>}
    {accountId && <section className="panel billing-plan-history"><h2>Retained billing-plan history</h2><p>Review recorded terms and approvals. An observed legacy baseline is not proof of its original approval date or historical effective period.</p><button className="button button-secondary" disabled={busy||historyBusy} onClick={()=>void loadHistory()}>Review plan history</button>{history&&<><p>{history.coverage}</p>{!history.versions.length?<p>No retained version yet. The next approved save retains the existing plan as an observed baseline.</p>:<ol>{history.versions.map(v=><li key={v.recordNumber}><details><summary>Version {v.recordNumber} · {v.kind==="OBSERVED_LEGACY"?"Observed legacy baseline":"Recorded approval"} · {new Date(v.recordedAt).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"})} SAST</summary><p>Reference: {v.plan.approvalReference}; first unbilled month: {v.plan.firstPeriod}; proration: {v.plan.proration}; included tax rate: {v.plan.taxPercent}%.</p><p>Recurring charges: {v.plan.charges.map(c=>`${c.code} — ${c.name}: R ${c.amount.toFixed(2)}`).join("; ")||"None recorded"}.</p><p>Rent tax: {v.plan.rentTaxable?"included":"not taxable"}; insurance: {v.plan.insuranceEnabled?`enabled (${v.plan.insuranceTaxable?"tax included":"not taxable"})`:"disabled"}. Discount: {v.plan.discount?`${v.plan.discount.name}; ${v.plan.discount.type} ${v.plan.discount.value}; ${v.plan.discount.startsPeriod} through ${v.plan.discount.endsPeriod}`:"None recorded"}.</p><p>Integrity reference: {v.hash.slice(0,16)}.</p></details></li>)}</ol>}{history.nextBefore&&<button className="button button-secondary" disabled={historyBusy} onClick={()=>void loadHistory(history.nextBefore!)}>Load older versions</button>}</>}</section>}
    {error && <p role="alert" className="panel">{error}</p>}
    {notice && <p role="status" className="panel">{notice}</p>}
    {accountId && <fieldset className="panel monthly-plan" disabled={busy||historyBusy}><legend>Account billing terms {approved ? "— saved" : "— review required"}</legend>
      <div className="form-grid"><label>First unbilled month<input type="month" value={plan.firstPeriod} onChange={e => edit({ ...plan, firstPeriod: e.target.value })}/></label><label>Rent and insurance proration<select value={plan.proration} onChange={e => edit({ ...plan, proration: e.target.value as BillingPlan["proration"] })}><option value="ACTUAL_DAYS">Actual calendar days</option><option value="FULL_MONTH">Full month (transfers require review)</option></select></label><label>Approved tax rate (%)<input type="number" min="0" max="100" step="0.001" value={plan.taxPercent} onChange={e => edit({ ...plan, taxPercent: Number(e.target.value) })}/></label><label><input type="checkbox" checked={plan.rentTaxable} onChange={e => edit({ ...plan, rentTaxable: e.target.checked })}/> Rent includes tax</label><label><input type="checkbox" checked={plan.insuranceEnabled} onChange={e => edit({ ...plan, insuranceEnabled: e.target.checked })}/> Bill enrolled insurance premium</label><label><input type="checkbox" checked={plan.insuranceTaxable} onChange={e => edit({ ...plan, insuranceTaxable: e.target.checked })}/> Insurance includes tax</label></div>
      <h3>Recurring charges</h3><p>Only add charges agreed for this account. These are full monthly amounts; they are not prorated. Editing a catalogue template does not change this saved agreement.</p>
      {plan.charges.map((charge, index) => <div className="form-grid" key={index}>{(["code", "name", "amount"] as const).map(key => <label key={key}>{key === "amount" ? "Monthly amount (R)" : key === "code" ? "Charge code" : "Description"}<input type={key === "amount" ? "number" : "text"} min="0" step="0.01" value={charge[key]} onChange={e => edit({ ...plan, charges: plan.charges.map((c, i) => i === index ? { ...c, [key]: key === "amount" ? Number(e.target.value) : e.target.value } : c) })}/></label>)}<label><input type="checkbox" checked={charge.taxable} onChange={e => edit({ ...plan, charges: plan.charges.map((c, i) => i === index ? { ...c, taxable: e.target.checked } : c) })}/> Includes tax</label><button type="button" className="button button-secondary" onClick={() => edit({ ...plan, charges: plan.charges.filter((_, i) => i !== index) })}>Remove charge</button></div>)}
      <button type="button" className="button button-secondary" onClick={() => edit({ ...plan, charges: [...plan.charges, { code: "", name: "", amount: 0, taxable: false }] })}>Add recurring charge</button>
      <h3>Rent discount</h3><label><input type="checkbox" checked={Boolean(plan.discount)} onChange={e => edit({ ...plan, discount: e.target.checked ? { name: "", type: "PERCENTAGE", value: 0, startsPeriod: period, endsPeriod: period } : null })}/> Apply an agreed rent discount</label>
      {plan.discount && <div className="form-grid"><label>Discount description<input value={plan.discount.name} onChange={e => edit({ ...plan, discount: { ...plan.discount!, name: e.target.value } })}/></label><label>Type<select value={plan.discount.type} onChange={e => edit({ ...plan, discount: { ...plan.discount!, type: e.target.value as "FIXED" | "PERCENTAGE" } })}><option value="FIXED">Rand amount</option><option value="PERCENTAGE">Percentage</option></select></label><label>Value<input type="number" min="0" step="0.01" value={plan.discount.value} onChange={e => edit({ ...plan, discount: { ...plan.discount!, value: Number(e.target.value) } })}/></label>{(["startsPeriod", "endsPeriod"] as const).map(key => <label key={key}>{key === "startsPeriod" ? "From month" : "Through month"}<input type="month" value={plan.discount![key]} onChange={e => edit({ ...plan, discount: { ...plan.discount!, [key]: e.target.value } })}/></label>)}</div>}
      <label>Approval / agreement reference<input value={plan.approvalReference} maxLength={250} placeholder="Finance approval or agreed contract reference" onChange={e => edit({ ...plan, approvalReference: e.target.value })}/></label>
      <button type="button" className="button button-secondary" disabled={plan.approvalReference.trim().length < 5} onClick={() => void act("plan")}>Save approved terms</button>
    </fieldset>}
    {accountId && <button className="button button-primary" disabled={busy || !approved} onClick={() => void act("preview")}>{busy ? "Working…" : "Preview monthly invoice"}</button>}
    {preview && <section className="panel monthly-preview"><h2>Review {period} · {preview.customerName}</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Amount</th><th>Included tax</th></tr></thead><tbody>{preview.lines.map(line => <tr key={line.key}><td>{line.description}</td><td>{line.type === "CREDIT" ? "−" : ""}{money(line.amount)}</td><td>{line.type === "CREDIT" ? "−" : ""}{money(line.taxAmount)}</td></tr>)}</tbody></table></div><p><strong>Invoice total: {money(preview.total)}</strong> · Included tax: {money(preview.taxTotal)}</p><label><input type="checkbox" checked={reviewed} disabled={busy||historyBusy} onChange={e => setReviewed(e.target.checked)}/> I have checked the charges, tax and period against the approved agreement.</label><button className="button button-primary" disabled={!reviewed || busy} onClick={() => void act("post")}>Post charges and save invoice</button></section>}
    {result && <section className="panel" role="status">Posted {result.invoiceNumber}. <a href={`/api/v1/billing/monthly/invoice/${result.documentId}`} target="_blank" rel="noreferrer">Open saved invoice</a></section>}
    {invoices.length > 0 && <section className="panel"><h2>Saved monthly invoices</h2><p>Latest 60 invoices for this account. These remain available after you reload the page.</p>{invoices.map(invoice => <div key={invoice.id}><a href={`/api/v1/billing/monthly/invoice/${invoice.id}`} target="_blank" rel="noreferrer">{invoice.externalId}</a> <button type="button" className="button button-secondary" disabled={busy} onClick={() => void sendInvoice(invoice.id)}>Send / resend invoice</button></div>)}</section>}
  </div>;
}
