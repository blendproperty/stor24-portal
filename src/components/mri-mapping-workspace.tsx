"use client";

import { useCallback, useEffect, useState } from "react";
import { MRI_MOVEMENTS, mappingBlockers, type MriMapping } from "@/lib/mri-mapping-policy";
import type { mriMappingReview } from "@/lib/mri-mapping-service";
type Review = Awaited<ReturnType<typeof mriMappingReview>>;
const movementLabel = (v: string) => v.toLowerCase().replace("_", " ");

export function MriMappingWorkspace() {
  const [review, setReview] = useState<Review | null>(null), [mapping, setMapping] = useState<MriMapping | null>(null);
  const [canManage, setCanManage] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [reference, setReference] = useState("");
  const accept = (value: Review) => { setReview(value); setMapping(value.mapping); setDirty(false); setReference(""); };
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { const response = await fetch("/api/v1/billing/mri/mapping", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); accept(data.review); setCanManage(data.canManage); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load mapping."); } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load]);
  async function act(action: "save" | "submit" | "approve") {
    if (!review || !mapping) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/billing/mri/mapping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, revision: review.revision, ...(action === "save" ? { mapping } : action === "approve" ? { approvalReference: reference } : {}) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); accept(data.review);
      setNotice(action === "save" ? "Draft saved. Previous approval is cleared." : action === "submit" ? "Submitted for independent finance review." : "Mapping approved. Journal generation and posting remain unavailable.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update mapping."); } finally { setBusy(false); }
  }
  function edit(value: MriMapping) { setMapping(value); setDirty(true); setNotice(""); }
  function rule(index: number, key: keyof MriMapping["rules"][number], value: string) {
    if (!mapping) return;
    edit({ ...mapping, rules: mapping.rules.map((r, i) => i === index ? { ...r, [key]: value } : r) });
  }
  const blockers = mapping ? mappingBlockers(mapping) : [];
  const disabled = busy || !canManage;
  return <main className="mri-mapping">
    <a href="/billing/mri">← MRI accounting</a>
    <header><p className="mapping-kicker">Finance setup · Posting off</p><h1>MRI finance mappings</h1><p>Record the entity, property and accounting rules for finance review. No GL codes or tax treatment are assumed.</p></header>
    {error && <p className="mapping-error" role="alert">{error}</p>}{notice && <p className="mapping-notice" role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={load}>Reload saved mapping</button>
    {!mapping && !error && <p role="status">Loading mapping…</p>}
    {mapping && review && <>
      <section className="mapping-panel"><h2>Accounting target</h2><p>Stage: <strong>{review.status.replace("_", " ")}</strong>{dirty && " · Unsaved changes"}</p>
        <fieldset disabled={disabled}><div className="mapping-grid">
          <label>MRI entity code<input maxLength={120} value={mapping.entityCode} onChange={e => edit({ ...mapping, entityCode: e.target.value })} /></label>
          <label>MRI property code<input maxLength={120} value={mapping.propertyCode} onChange={e => edit({ ...mapping, propertyCode: e.target.value })} /></label>
          <label>Accounting basis<select aria-label="Accounting basis" value={mapping.basis} onChange={e => edit({ ...mapping, basis: e.target.value as MriMapping["basis"] })}><option value="UNDECIDED">Awaiting finance decision</option><option value="ACCRUAL">Accrual</option><option value="CASH">Cash</option></select></label>
        </div><label>Source coverage and classification plan<textarea maxLength={2000} value={mapping.scopeNotes} onChange={e => edit({ ...mapping, scopeNotes: e.target.value })} placeholder="Describe deposits, rent, fees, opening balances, exclusions and how each movement will be classified." /></label></fieldset>
      </section>
      <section className="mapping-panel"><h2>Movement categories</h2><p>A movement type can cover several categories. Add separate categories for rent, deposits, insurance or fees as needed. These rules are proposals; they do not classify or post ledger entries automatically.</p>
        <fieldset disabled={disabled}>{mapping.rules.map((r, i) => <div className="mapping-rule" key={i}><h3>Category {i + 1} · {movementLabel(r.movement)}</h3><div className="mapping-grid">
          <label>Movement<select value={r.movement} onChange={e => rule(i, "movement", e.target.value)}>{MRI_MOVEMENTS.map(m => <option key={m} value={m}>{movementLabel(m)}</option>)}</select></label>
          <label>Category name<input maxLength={120} value={r.category} onChange={e => rule(i, "category", e.target.value)} /></label>
          <label>Debit GL account<input maxLength={120} value={r.debitAccount} onChange={e => rule(i, "debitAccount", e.target.value)} /></label>
          <label>Credit GL account<input maxLength={120} value={r.creditAccount} onChange={e => rule(i, "creditAccount", e.target.value)} /></label>
          <label>Tax treatment<select aria-label="Tax treatment" value={r.taxTreatment} onChange={e => rule(i, "taxTreatment", e.target.value)}><option value="UNDECIDED">Awaiting finance decision</option><option value="NO_TAX">No tax</option><option value="INCLUDED">Tax included in recorded amount</option><option value="EXCLUSIVE">Tax additional to recorded amount</option></select></label>
          <label>Tax GL account<input maxLength={120} value={r.taxAccount} onChange={e => rule(i, "taxAccount", e.target.value)} /></label>
          <label>MRI tax code<input maxLength={120} value={r.taxCode} onChange={e => rule(i, "taxCode", e.target.value)} /></label>
        </div><label>Classification and accounting rationale<textarea aria-label="Classification and accounting rationale" maxLength={2000} value={r.rationale} onChange={e => rule(i, "rationale", e.target.value)} placeholder="Explain source identification, amount signs, tax allocation and reversal handling." /></label><button type="button" onClick={() => edit({ ...mapping, rules: mapping.rules.filter((_, index) => index !== i) })}>Remove category {i + 1}</button></div>)}
          <button type="button" disabled={mapping.rules.length >= 60} onClick={() => edit({ ...mapping, rules: [...mapping.rules, { category: "New category", movement: "CHARGE", debitAccount: "", creditAccount: "", taxAccount: "", taxCode: "", taxTreatment: "UNDECIDED", rationale: "" }] })}>Add category</button>
        </fieldset>
      </section>
      <section className="mapping-panel"><h2>Finance review</h2><p>Approval requires another authorised person who has neither edited nor submitted this mapping. Editing an approved mapping returns it to draft and clears approval.</p>
        {blockers.length ? <details open><summary>{blockers.length} items to resolve</summary><ul>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></details> : <p>All required fields are filled. Finance must verify the codes and accounting decisions against MRI.</p>}
        {review.approvedAt && <p>Approved {new Date(review.approvedAt).toLocaleString("en-ZA")} · Reference: {review.approvalReference}</p>}
        {canManage && <div className="mapping-actions"><button type="button" disabled={busy || (!dirty && !!review.revision)} onClick={() => act("save")}>Save draft</button><button type="button" disabled={busy || dirty || !review.revision || review.status !== "DRAFT" || !!blockers.length} onClick={() => act("submit")}>Submit for review</button></div>}
        {canManage && review.status === "IN_REVIEW" && <>{review.canApprove ? <><label>Finance approval reference<input maxLength={240} value={reference} onChange={e => setReference(e.target.value)} placeholder="Finance decision or review reference" /></label><button type="button" disabled={busy || dirty || reference.trim().length < 3} onClick={() => act("approve")}>Approve mapping</button></> : <p>An independent finance reviewer must sign in to approve this version.</p>}</>}
        {!canManage && <p>You have read-only access to this mapping.</p>}
        {!dirty && review.revision && <p><a href="/api/v1/billing/mri/mapping?format=csv" download>Download saved mapping review CSV</a> · Finance review document, not an MRI journal import.</p>}
        <p>Mapping approval does not approve a journal or enable exports. Balanced batches, source classification, reversals, duplicate controls, the MRI import contract and provider/finance acceptance remain required.</p>
      </section>
    </>}
  </main>;
}
