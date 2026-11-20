"use client";

import { useState, type FormEvent } from "react";

export function CompanyFacePersonForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [companyId, setCompanyId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [authorised, setAuthorised] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/access/company-people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, firstName, lastName, authorised }), cache: "no-store" });
      if (!response.headers.get("content-type")?.includes("application/json")) throw Error(`The person could not be added (HTTP ${response.status}). Refresh and check before retrying.`);
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? "The person could not be added.");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The person could not be added."); }
    finally { setBusy(false); }
  }
  return <section className="panel hikcentral-person-link" aria-labelledby="company-face-title">
    <h2 id="company-face-title">Company authorised people</h2>
    <p>Choose the company and add each person who needs a face photo. The company remains the tenant; each person gets their own HikCentral identity. Door access follows the company&apos;s verified handover and payment status.</p>
    <form onSubmit={add} className="form-grid">
      <label className="field">Company<select value={companyId} onChange={event => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <label className="field">First name<input value={firstName} onChange={event => setFirstName(event.target.value)} maxLength={100} required /></label>
      <label className="field">Last name<input value={lastName} onChange={event => setLastName(event.target.value)} maxLength={100} required /></label>
      <label className="checkbox-row"><input type="checkbox" checked={authorised} onChange={event => setAuthorised(event.target.checked)} required /> I confirmed this company authorised this person to request facial access.</label>
      <button type="submit" className="button button-primary" disabled={busy || !companies.length}>{busy ? "Adding person…" : "Add person for photo"}</button>
    </form>
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
