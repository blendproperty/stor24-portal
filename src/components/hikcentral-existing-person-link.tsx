"use client";

import { useState } from "react";

type Customer = { id: string; name: string };
type Facility = { id: string; name: string };
type Preview = { customerId: string; customerName: string; personId: string; personCode: string; givenName: string; familyName: string; organisationIndexCode: string };

export function HikCentralExistingPersonLink({ customers, facilities }: { customers: Customer[]; facilities: Facility[] }) {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [personCode, setPersonCode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(action: "preview" | "link") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/access/hikcentral-person-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, facilityId, customerId, personCode, expectedPersonId: preview?.personId, identityChecked }), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "HikCentral could not confirm the person.");
      if (action === "preview") setPreview(payload.data);
      else { setPreview(null); setIdentityChecked(false); setMessage("Existing HikCentral person linked to this STOR24 customer. This does not grant access or upload a photo."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HikCentral could not confirm the person."); }
    finally { setBusy(false); }
  }

  function reset() { setPreview(null); setIdentityChecked(false); setMessage(""); setError(""); }
  const visibleCustomers = customers.filter(customer => customer.id === customerId || customer.name.toLowerCase().includes(customerSearch.toLowerCase())).slice(0, 50);

  return <section className="panel panel-spacious hikcentral-person-link" aria-label="Link an existing HikCentral person">
    <div className="panel-heading"><div><h2>Link an existing HikCentral person</h2><p className="panel-subtitle">Use the person already in HikCentral. The link belongs to the customer across bookings and units. Check their original ID before linking.</p></div></div>
    <div className="form-grid">
      <div className="field"><label htmlFor="hikcentral-customer-search">Find STOR24 customer</label><input id="hikcentral-customer-search" type="search" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Search by name" /><label htmlFor="hikcentral-customer">Customer</label><select id="hikcentral-customer" value={customerId} onChange={event => { setCustomerId(event.target.value); reset(); }}><option value="">Select customer</option>{visibleCustomers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
      <label className="field"><span>Facility</span><select value={facilityId} onChange={event => { setFacilityId(event.target.value); reset(); }}>{facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
      <label className="field"><span>HikCentral person ID shown in Web Client</span><input value={personCode} maxLength={16} onChange={event => { setPersonCode(event.target.value.trim()); reset(); }} autoComplete="off" inputMode="text" /></label>
    </div>
    <button className="button button-secondary" type="button" disabled={busy || !customerId || !facilityId || !personCode} onClick={() => void submit("preview")}>{busy ? "Checking…" : "Check HikCentral person"}</button>
    {preview ? <div className="hikcentral-link-preview" aria-live="polite"><p><strong>STOR24:</strong> {preview.customerName}</p><p><strong>HikCentral:</strong> {[preview.givenName, preview.familyName].filter(Boolean).join(" ") || "Name unavailable"} · ID {preview.personCode}</p><p>Confirm this is the same person using their original identity document. No photo or access level changes here.</p><label><input type="checkbox" checked={identityChecked} onChange={event => setIdentityChecked(event.target.checked)} /> I checked the original ID and confirmed this is the same person.</label><div><button className="button button-primary" type="button" disabled={busy || !identityChecked} onClick={() => void submit("link")}>{busy ? "Linking…" : "Link this person to customer"}</button></div></div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}
  </section>;
}
