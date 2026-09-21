"use client";
import { useEffect, useState } from "react";
import { currentBillingPeriod, type BillingPlan, type BillingLine } from "@/lib/monthly-billing-policy";

type Account = { id: string; accountNumber: string; customer: { companyName: string | null; firstName: string | null; lastName: string | null }; tenancy: { facility: { name: string }; status: string } | null };
type Preview = { fingerprint: string; customerName: string; total: number; taxTotal: number; lines: BillingLine[] };
const money = (n: number) => n.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
function blankPlan(): BillingPlan { return { firstPeriod: currentBillingPeriod(), proration: "ACTUAL_DAYS", taxPercent: 0, rentTaxable: false, insuranceEnabled: false, insuranceTaxable: false, charges: [], discount: null, approvalReference: "" }; }
async function request(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || "Unable to complete request");
  return json.data;
}
export function MonthlyBillingWorkspace() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [period, setPeriod] = useState(currentBillingPeriod());
  const [plan, setPlan] = useState<BillingPlan>(blankPlan);
  const [approved, setApproved] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ documentId: string; invoiceNumber: string } | null>(null);
  const [invoices, setInvoices] = useState<{ id: string; externalId: string }[]>([]);
  useEffect(() => { request("/api/v1/billing/monthly").then(setAccounts).catch(e => setError(e.message)); }, []);
  function edit(next: BillingPlan) { setPlan(next); setApproved(false); setPreview(null); setReviewed(false); setResult(null); }
  async function select(id: string) {
    setAccountId(id); setPreview(null); setResult(null); setReviewed(false); setApproved(false); setPlan(blankPlan()); setInvoices([]);
    if (!id) return;
    setBusy(true); setError("");
    try { const saved = await request(`/api/v1/billing/monthly?accountId=${encodeURIComponent(id)}`); setPlan(saved.plan || blankPlan()); setApproved(Boolean(saved.plan)); setInvoices(saved.invoices); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function act(action: "plan" | "preview" | "post") {
    setBusy(true); setError(""); setResult(null);
    try {
      const data = await request("/api/v1/billing/monthly", action === "plan" ? { action, accountId, plan } : action === "post" ? { action, accountId, period, fingerprint: preview?.fingerprint, confirm: true } : { action, accountId, period });
      if (action === "plan") { setApproved(true); setPreview(null); }
      if (action === "preview") { setPreview(data); setReviewed(false); }
      if (action === "post") { setResult(data); setPreview(null); setReviewed(false); setInvoices(items => [{ id: data.documentId, externalId: data.invoiceNumber }, ...items]); }
    } catch(e) { setError((e as Error).message); if (action !== "plan") setPreview(null); } finally { setBusy(false); }
  }
  return <div className="page-stack monthly-billing">
    <section className="panel"><p>Posting creates an account charge and a saved invoice. It does not collect money or email the customer. Charges are VAT-inclusive where marked taxable. Confirm the tax treatment, contract and first unbilled month with finance.</p>
      <div className="form-grid"><label>Customer account<select value={accountId} disabled={busy} onChange={e => void select(e.target.value)}><option value="">Select account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} · {a.customer.companyName || [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ")} · {a.tenancy?.facility.name}</option>)}</select></label><label>Billing month<input type="month" value={period} max={currentBillingPeriod()} disabled={busy} onChange={e => { setPeriod(e.target.value); setPreview(null); setResult(null); setReviewed(false); }}/></label></div>
    </section>
    {error && <p role="alert" className="panel">{error}</p>}
    {accountId && <fieldset className="panel monthly-plan" disabled={busy}><legend>Account billing terms {approved ? "— saved" : "— review required"}</legend>
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
    {preview && <section className="panel monthly-preview"><h2>Review {period} · {preview.customerName}</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Amount</th><th>Included tax</th></tr></thead><tbody>{preview.lines.map(line => <tr key={line.key}><td>{line.description}</td><td>{line.type === "CREDIT" ? "−" : ""}{money(line.amount)}</td><td>{line.type === "CREDIT" ? "−" : ""}{money(line.taxAmount)}</td></tr>)}</tbody></table></div><p><strong>Invoice total: {money(preview.total)}</strong> · Included tax: {money(preview.taxTotal)}</p><label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)}/> I have checked the charges, tax and period against the approved agreement.</label><button className="button button-primary" disabled={!reviewed || busy} onClick={() => void act("post")}>Post charges and save invoice</button></section>}
    {result && <section className="panel" role="status">Posted {result.invoiceNumber}. <a href={`/api/v1/billing/monthly/invoice/${result.documentId}`} target="_blank" rel="noreferrer">Open saved invoice</a></section>}
    {invoices.length > 0 && <section className="panel"><h2>Saved monthly invoices</h2><p>Latest 60 invoices for this account. These remain available after you reload the page.</p>{invoices.map(invoice => <a key={invoice.id} href={`/api/v1/billing/monthly/invoice/${invoice.id}`} target="_blank" rel="noreferrer">{invoice.externalId}</a>)}</section>}
  </div>;
}
