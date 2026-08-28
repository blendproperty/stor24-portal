"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type Unit = { id: string; facilityId: string; number: string; floor: string; zone: string; status: string; monthlyRate: number; typeName: string; width: number | null; length: number | null; area: number | null; features: string[] };
type Facility = { id: string; name: string };
type Customer = { id: string; name: string; email: string | null };
type Reservation = { id: string; facilityId: string; customerId: string; unitId: string; label: string; paymentMethod: string | null; intendedMoveIn: string | null; quotedRate: number };

export function MoveInWorkspace({ facilities, units, customers, reservations, initialReservationId, action }: { facilities: Facility[]; units: Unit[]; customers: Customer[]; reservations: Reservation[]; initialReservationId?: string; action: (data: FormData) => void | Promise<void> }) {
  const initialReservation = reservations.find((item) => item.id === initialReservationId);
  const [facilityId, setFacilityId] = useState(initialReservation?.facilityId ?? facilities[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState(initialReservation?.unitId ?? "");
  const [filterMode, setFilterMode] = useState<"size" | "area">("size");
  const [filterKey, setFilterKey] = useState("ALL");
  const [floorFilter, setFloorFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [find, setFind] = useState("");
  const [step, setStep] = useState<1 | 2>(initialReservation ? 2 : 1);
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(initialReservation?.customerId ?? "");
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const available = useMemo(() => units.filter((unit) => unit.facilityId === facilityId && ["AVAILABLE", "RESERVED"].includes(unit.status)), [units, facilityId]);
  const floors = useMemo(() => [...new Set(available.map((unit) => unit.floor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en-ZA", { numeric: true, sensitivity: "base" })), [available]);
  const activeFilterCount = [filterKey !== "ALL", floorFilter !== "ALL", statusFilter !== "ALL", Boolean(find)].filter(Boolean).length;
  function clearFilters() { setFilterKey("ALL"); setFloorFilter("ALL"); setStatusFilter("ALL"); setFind(""); }
  const groups = useMemo(() => {
    const counts = new Map<string, { type: string; measure: string; count: number }>();
    available.forEach((unit) => {
      const measure = filterMode === "area" ? (unit.area?.toFixed(1) ?? "Not set") : unit.width && unit.length ? `${unit.width.toFixed(1)} × ${unit.length.toFixed(1)} m` : "Not set";
      const key = `${unit.typeName}|${measure}`;
      const current = counts.get(key); counts.set(key, { type: unit.typeName, measure, count: (current?.count ?? 0) + 1 });
    });
    return [...counts.entries()].map(([key, value]) => ({ key, ...value }));
  }, [available, filterMode]);
  const visible = available.filter((unit) => {
    const measure = filterMode === "area" ? (unit.area?.toFixed(1) ?? "Not set") : unit.width && unit.length ? `${unit.width.toFixed(1)} × ${unit.length.toFixed(1)} m` : "Not set";
    return (filterKey === "ALL" || filterKey === `${unit.typeName}|${measure}`)
      && (floorFilter === "ALL" || unit.floor === floorFilter)
      && (statusFilter === "ALL" || unit.status === statusFilter)
      && (!find || unit.number.toLowerCase().includes(find.toLowerCase()));
  });
  const selected = units.find((unit) => unit.id === selectedId);
  const selectedCustomer = customerOptions.find((customer) => customer.id === customerId);
  const canSendForSignature = Boolean(customerId) && Boolean(selectedId) && Boolean(selectedCustomer?.email);

  async function addCustomer(formData: FormData) {
    const text = (key: string) => String(formData.get(key) ?? "").trim();
    setCustomerBusy(true); setCustomerError("");
    const response = await fetch("/api/v1/leasing/customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: text("type"), firstName: text("firstName") || undefined, lastName: text("lastName") || undefined, companyName: text("companyName") || undefined, phone: text("phone") || undefined, email: text("email") || undefined, identityRef: text("identityRef") || undefined, billingAddress: { city: text("city"), province: text("province"), country: "South Africa" }, communicationConsent: { email: formData.get("emailConsent") === "on", sms: formData.get("smsConsent") === "on", whatsapp: formData.get("whatsappConsent") === "on", phone: false, recordedAt: new Date().toISOString(), source: "STAFF_RECORDED" } }) });
    const payload = await response.json(); setCustomerBusy(false);
    if (!response.ok) { setCustomerError(payload.error?.message ?? "Customer could not be created."); return; }
    const name = payload.data.companyName || [payload.data.firstName, payload.data.lastName].filter(Boolean).join(" ");
    setCustomerOptions((current) => [{ id: payload.data.id, name, email: payload.data.email ?? null }, ...current]); setCustomerId(payload.data.id); setShowCustomer(false);
  }

  return <div className="page-stack">
    <PageHeader eyebrow="Operations centre · Accounts" title="Move in" description={step === 1 ? "Select an available unit using size or floor-area availability." : "Complete the customer and account details, then send the lease agreement for the customer to review and sign."}/>
    <div className="move-in-steps"><span className="active">1 Select unit</span><span className={step === 2 ? "active" : ""}>2 Account details</span></div>
    {step === 1 ? <section className="unit-selector-layout">
      <article className="panel unit-results"><div className="unit-toolbar"><label>Store<select value={facilityId} onChange={(event) => { setFacilityId(event.target.value); setSelectedId(""); setFilterKey("ALL"); setFloorFilter("ALL"); }}>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Floor<select value={floorFilter} onChange={(event) => setFloorFilter(event.target.value)}><option value="ALL">All floors</option>{floors.map((floor) => <option key={floor} value={floor}>{floor}</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option><option value="AVAILABLE">Vacant</option><option value="RESERVED">Reserved</option></select></label><label className="unit-find"><Search size={16}/><input value={find} onChange={(event) => setFind(event.target.value)} placeholder="Find unit number"/></label>{activeFilterCount > 0 ? <button type="button" className="text-button" onClick={clearFilters}><X size={14}/>Clear filters ({activeFilterCount})</button> : null}<strong>{visible.length} units</strong></div>
        <div className="table-wrap"><table className="data-table unit-table"><thead><tr><th>Unit</th><th>Type</th><th>Size</th><th>Area</th><th>Rent</th><th>Floor</th><th>Features</th><th>Status</th></tr></thead><tbody>{visible.map((unit) => <tr key={unit.id} className={selectedId === unit.id ? "selected" : ""} onClick={() => setSelectedId(unit.id)}><td><input aria-label={`Select unit ${unit.number}`} type="radio" checked={selectedId === unit.id} onChange={() => setSelectedId(unit.id)}/> <strong>{unit.number}</strong></td><td>{unit.typeName}</td><td>{unit.width && unit.length ? `${unit.width.toFixed(1)} × ${unit.length.toFixed(1)} m` : "—"}</td><td>{unit.area?.toFixed(1) ?? "—"} m²</td><td>R {unit.monthlyRate.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</td><td>{unit.floor || "—"}</td><td>{unit.features.join(", ") || unit.zone || "—"}</td><td><StatusPill tone={unit.status === "AVAILABLE" ? "positive" : "warning"}>{unit.status === "AVAILABLE" ? "Vacant" : "Reserved"}</StatusPill></td></tr>)}</tbody></table></div>
      </article>
      <aside className="unit-filter-panel"><section className="panel"><h3>Selected unit</h3><strong className="selected-unit-number">{selected?.number ?? "None"}</strong></section><section className="panel"><h3>Filter</h3><div className="filter-toggle"><label><input type="radio" checked={filterMode === "size"} onChange={() => { setFilterMode("size"); setFilterKey("ALL"); }}/>Size</label><label><input type="radio" checked={filterMode === "area"} onChange={() => { setFilterMode("area"); setFilterKey("ALL"); }}/>Area</label></div><button type="button" className={filterKey === "ALL" ? "filter-row active" : "filter-row"} onClick={() => setFilterKey("ALL")}><span>Vacant units</span><strong>{available.length}</strong></button>{groups.map((group) => <button type="button" className={filterKey === group.key ? "filter-row active" : "filter-row"} onClick={() => setFilterKey(group.key)} key={group.key}><span>{group.type}<small>{group.measure}</small></span><strong>{group.count}</strong></button>)}</section><section className="panel"><h3>Note</h3><p>{selected ? `${selected.typeName}, ${selected.area?.toFixed(1) ?? "area not set"} m² at R ${selected.monthlyRate.toLocaleString("en-ZA")} per month.` : "Select a unit to continue."}</p></section></aside>
    </section> : <section className="panel panel-spacious"><form action={action} className="move-in-form"><input type="hidden" name="facilityId" value={selected?.facilityId ?? facilityId}/><input type="hidden" name="unitId" value={selectedId}/><label>Selected unit<input value={selected ? `${selected.number} · ${selected.typeName} · R ${selected.monthlyRate.toLocaleString("en-ZA")}` : ""} readOnly/></label><label>Customer<select name="customerId" required value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Select customer</option>{customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select><button type="button" className="text-button move-in-add-customer" onClick={() => { setShowCustomer(true); setCustomerError(""); }}><Plus size={14}/>Add a new customer</button></label><label>Reservation (optional)<select name="reservationId" defaultValue={initialReservation?.id ?? ""}><option value="">Direct move-in</option>{reservations.filter((item) => item.unitId === selectedId).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Start date<input name="startDate" type="date" defaultValue={initialReservation?.intendedMoveIn ?? new Date().toISOString().slice(0,10)} required/></label><label>Monthly rent<input name="monthlyRate" type="number" step=".01" defaultValue={initialReservation?.quotedRate ?? selected?.monthlyRate}/></label><label>Initial charge<input name="initialCharge" type="number" step=".01" defaultValue="0"/><small>Provisional until the financial rules are confirmed.</small></label>
      <label>Payment method<select name="paymentMethod" defaultValue={initialReservation?.paymentMethod === "UNDECIDED" ? "" : initialReservation?.paymentMethod ?? ""} required><option value="">Select and confirm payment method</option><option value="DEBIT_ORDER">Debit order</option><option value="CARD">Credit / debit card</option><option value="EFT">EFT</option><option value="OTHER">Other</option></select><small>{initialReservation?.paymentMethod === "UNDECIDED" ? "The customer had not decided offline. Confirm this before sending." : "Prefilled from the reservation. Confirm it before BlendSign selects the matching lease."}</small></label>
      <section className="lease-sign-panel">
        <h3>Lease agreement</h3>
        <p className="lease-summary" style={{ fontStyle: "italic" }}>Draft agreement — pending attorney review. The customer will receive an emailed link to review every clause, initial each one and sign — the unit stays held (not occupied) until they do.</p>
      </section>
      {!selectedCustomer?.email && customerId ? <p className="form-error">Add an email address to this customer before sending the lease.</p> : null}
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setStep(1)}><ArrowLeft size={16}/>Back</button><button className="button button-primary" disabled={!canSendForSignature}>Send lease for signature</button></div></form></section>}
    {step === 1 ? <div className="form-footer"><button className="button button-secondary" type="button" onClick={() => history.back()}><ArrowLeft size={16}/>Back</button><button className="button button-primary" type="button" disabled={!selectedId} onClick={() => setStep(2)}>Next<ArrowRight size={16}/></button></div> : null}
    {showCustomer ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setShowCustomer(false)}><X size={18}/></button><p className="eyebrow">Move in</p><h2>Add customer</h2><p className="modal-copy">Create the operational customer record without leaving the move-in workflow.</p><form action={addCustomer} className="invite-form"><label>Customer type<select name="type" defaultValue="INDIVIDUAL"><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></label><label>First name<input name="firstName"/></label><label>Last name<input name="lastName"/></label><label>Company name<input name="companyName"/></label><label>Mobile / phone<input name="phone"/></label><label>Email<input name="email" type="email"/></label><label>SA ID or passport<input name="identityRef"/></label><label>City<input name="city"/></label><label>Province<input name="province"/></label><label className="check-label"><input name="emailConsent" type="checkbox"/><span>Email consent</span></label><label className="check-label"><input name="smsConsent" type="checkbox"/><span>SMS consent</span></label><label className="check-label"><input name="whatsappConsent" type="checkbox"/><span>WhatsApp consent</span></label>{customerError ? <p className="form-error">{customerError}</p> : null}<div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowCustomer(false)}>Cancel</button><button className="button button-primary" disabled={customerBusy}>{customerBusy ? "Saving…" : "Add customer"}</button></div></form></div></div> : null}
  </div>;
}
