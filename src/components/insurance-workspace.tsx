"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type Facility = { id: string; name: string };
type Plan = { id: string; facilityId: string | null; code: string; name: string; providerName: string | null; coverageAmount: string; monthlyPremium: string; excessAmount: string; policyVersion: string | null; facility: { name: string } | null };
type Enrollment = { status: string; monthlyPremium: string | null; coverageAmount: string | null; waiverReason: string | null; acknowledgedAt: string; plan: { name: string; code: string } | null };
type Tenancy = { id: string; status: string; startDate: string; facility: Facility; customer: { firstName: string | null; lastName: string | null; companyName: string | null }; account: { id: string; accountNumber: string }; occupancies: { unit: { number: string } }[]; insuranceEnrollment: Enrollment | null };
type InsuranceData = { facilities: Facility[]; plans: Plan[]; tenancies: Tenancy[] };

const money = (value: string | null) => value === null ? "—" : `R ${Number(value).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
const customerName = (tenancy: Tenancy) => tenancy.customer.companyName || [tenancy.customer.firstName, tenancy.customer.lastName].filter(Boolean).join(" ") || "Unnamed customer";

export function InsuranceWorkspace() {
  const [data, setData] = useState<InsuranceData>({ facilities: [], plans: [], tenancies: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPlan, setShowPlan] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/insurance", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) return setError(payload.error?.message ?? "Insurance operations could not be loaded.");
    setData(payload.data); setError("");
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/v1/insurance", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok) setError(payload.error?.message ?? "Insurance operations could not be loaded.");
        else setData(payload.data);
      });
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => ({
    active: data.tenancies.filter((item) => item.insuranceEnrollment?.status === "ACTIVE").length,
    waived: data.tenancies.filter((item) => item.insuranceEnrollment?.status === "WAIVED").length,
    outstanding: data.tenancies.filter((item) => !item.insuranceEnrollment || item.insuranceEnrollment.status === "CANCELLED").length,
  }), [data.tenancies]);

  async function send(kind: string, payload: unknown, tenancyId = "") {
    setBusyId(tenancyId || kind); setError(""); setNotice("");
    const response = await fetch("/api/v1/insurance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, payload }) });
    const result = await response.json(); setBusyId("");
    if (!response.ok) { setError(result.error?.message ?? "The insurance operation could not be completed."); return false; }
    await load(); return true;
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await send("plan", { facilityId: form.get("facilityId") || null, code: form.get("code"), name: form.get("name"), providerName: form.get("providerName") || undefined, coverageAmount: Number(form.get("coverageAmount")), monthlyPremium: Number(form.get("monthlyPremium")), excessAmount: Number(form.get("excessAmount")), policyVersion: form.get("policyVersion") || undefined, termsUrl: form.get("termsUrl") || undefined });
    if (ok) { setShowPlan(false); setNotice("Insurance plan created. No tenant was enrolled automatically."); }
  }

  async function enrol(tenancy: Tenancy) {
    const planId = selectedPlans[tenancy.id] || eligiblePlans(tenancy)[0]?.id;
    if (!planId) return setError("Create an eligible insurance plan before enrolling this tenancy.");
    const ok = await send("decision", { tenancyId: tenancy.id, decision: "ENROL", planId, effectiveFrom: new Date().toISOString().slice(0, 10) }, tenancy.id);
    if (ok) setNotice(`Insurance recorded for ${customerName(tenancy)}. Premium billing remains disabled until financial integration is approved.`);
  }

  async function waive(tenancy: Tenancy) {
    const reason = window.prompt("Record why the customer declined or supplied alternative cover:");
    if (!reason) return;
    const ok = await send("decision", { tenancyId: tenancy.id, decision: "WAIVE", waiverReason: reason }, tenancy.id);
    if (ok) setNotice(`Insurance waiver recorded for ${customerName(tenancy)}.`);
  }

  async function cancel(tenancy: Tenancy) {
    if (!window.confirm(`End the recorded insurance participation for ${customerName(tenancy)}?`)) return;
    const ok = await send("decision", { tenancyId: tenancy.id, decision: "CANCEL" }, tenancy.id);
    if (ok) setNotice(`Insurance participation ended for ${customerName(tenancy)}.`);
  }

  const eligiblePlans = (tenancy: Tenancy) => data.plans.filter((plan) => !plan.facilityId || plan.facilityId === tenancy.facility.id);

  return <div className="page-stack">
    <PageHeader eyebrow="Tenant protection" title="Insurance operations" description="Configure approved plans and record each active tenant's enrolment or waiver. Premium posting remains separate from this operational register." action={<button className="button button-primary" onClick={() => setShowPlan(true)}><Plus size={16}/>New plan</button>}/>
    {error ? <p className="form-error">{error}</p> : null}{notice ? <p className="form-success">{notice}</p> : null}
    <section className="summary-strip"><div className="summary-cell"><span>Active cover</span><strong>{counts.active}</strong></div><div className="summary-cell"><span>Waivers recorded</span><strong>{counts.waived}</strong></div><div className="summary-cell"><span>Decision outstanding</span><strong>{counts.outstanding}</strong></div><div className="summary-cell"><span>Available plans</span><strong>{data.plans.length}</strong></div></section>
    <section className="panel"><div className="panel-heading panel-spacious"><div><h2>Tenant insurance register</h2><p className="panel-subtitle">Cover values are snapshotted at enrolment so later plan changes do not rewrite historical decisions.</p></div><ShieldCheck/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Facility / unit</th><th>Account</th><th>Decision</th><th>Plan or reason</th><th>Cover</th><th>Monthly premium</th><th>Action</th></tr></thead><tbody>
      {data.tenancies.length ? data.tenancies.map((tenancy) => { const enrollment = tenancy.insuranceEnrollment; const plans = eligiblePlans(tenancy); return <tr key={tenancy.id}><td className="primary-cell">{customerName(tenancy)}<small>{tenancy.status}</small></td><td>{tenancy.facility.name}<small>Unit {tenancy.occupancies[0]?.unit.number ?? "—"}</small></td><td>{tenancy.account.accountNumber}</td><td><StatusPill tone={enrollment?.status === "ACTIVE" ? "positive" : enrollment?.status === "WAIVED" ? "neutral" : "warning"}>{enrollment?.status ?? "OUTSTANDING"}</StatusPill></td><td>{enrollment?.plan?.name ?? enrollment?.waiverReason ?? "No decision recorded"}</td><td>{money(enrollment?.coverageAmount ?? null)}</td><td>{money(enrollment?.monthlyPremium ?? null)}</td><td>{enrollment?.status === "ACTIVE" ? <button className="text-button danger" disabled={busyId === tenancy.id} onClick={() => void cancel(tenancy)}>End cover</button> : <div className="reservation-actions"><select aria-label={`Insurance plan for ${customerName(tenancy)}`} value={selectedPlans[tenancy.id] ?? plans[0]?.id ?? ""} onChange={(event) => setSelectedPlans((current) => ({ ...current, [tenancy.id]: event.target.value }))}><option value="">Choose plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.monthlyPremium)}</option>)}</select><button className="text-button" disabled={busyId === tenancy.id || !plans.length} onClick={() => void enrol(tenancy)}>Enrol</button><button className="text-button" disabled={busyId === tenancy.id} onClick={() => void waive(tenancy)}>Waive</button></div>}</td></tr>; }) : <tr><td colSpan={8} className="empty-cell">No current tenancies are available.</td></tr>}
    </tbody></table></div></section>
    <section className="panel"><div className="panel-heading panel-spacious"><div><h2>Approved plans</h2><p className="panel-subtitle">Organisation-wide plans apply everywhere; facility plans apply only to the selected store.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Code</th><th>Plan</th><th>Provider</th><th>Scope</th><th>Cover</th><th>Premium</th><th>Excess</th><th>Policy version</th></tr></thead><tbody>{data.plans.length ? data.plans.map((plan) => <tr key={plan.id}><td>{plan.code}</td><td className="primary-cell">{plan.name}</td><td>{plan.providerName ?? "To be confirmed"}</td><td>{plan.facility?.name ?? "All facilities"}</td><td>{money(plan.coverageAmount)}</td><td>{money(plan.monthlyPremium)}</td><td>{money(plan.excessAmount)}</td><td>{plan.policyVersion ?? "Draft"}</td></tr>) : <tr><td colSpan={8} className="empty-cell">No plans configured. Add only provider-approved commercial values.</td></tr>}</tbody></table></div></section>
    {showPlan ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Plan configuration</p><h2>Create insurance plan</h2><form className="invite-form" onSubmit={createPlan}><label>Facility<select name="facilityId"><option value="">All permitted facilities</option>{data.facilities.map((facility) => <option value={facility.id} key={facility.id}>{facility.name}</option>)}</select></label><label>Code<input name="code" required maxLength={40}/></label><label>Plan name<input name="name" required/></label><label>Provider<input name="providerName"/></label><label>Cover amount (R)<input name="coverageAmount" type="number" min="0.01" step="0.01" required/></label><label>Monthly premium (R)<input name="monthlyPremium" type="number" min="0" step="0.01" required/></label><label>Excess (R)<input name="excessAmount" type="number" min="0" step="0.01" defaultValue="0" required/></label><label>Policy version<input name="policyVersion" placeholder="e.g. 2026-09"/></label><label>Terms URL<input name="termsUrl" type="url"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowPlan(false)}>Cancel</button><button className="button button-primary" disabled={busyId === "plan"}>{busyId === "plan" ? "Saving…" : "Create plan"}</button></div></form></div></div> : null}
  </div>;
}
