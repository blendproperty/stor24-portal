"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Pencil, Plus, Search, UserRound, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type Contact = Record<string, string>;
type Tenancy = { id: string; status: string; startDate: string; endDate: string | null; facility: { name: string }; account: { accountNumber: string; balance: string }; occupancies: { status: string; unit: { number: string; unitType: { name: string } } }[] };
type Customer = { id: string; type: string; firstName: string | null; lastName: string | null; companyName: string | null; email: string | null; phone: string | null; identityRef: string | null; taxNumber: string | null; dateOfBirth: string | null; billingAddress: Contact | null; alternateContact: Contact | null; workContact: Contact | null; emergencyContact: Contact | null; communicationConsent: { email?: boolean; sms?: boolean; phone?: boolean } | null; notes: string | null; tenancies: Tenancy[]; leads: { id: string; stage: string; source: string; updatedAt: string }[]; reservations: { id: string; status: string; facility: { name: string }; unit: { number: string } }[] };

const nameOf = (customer: Customer) => customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer";
const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const record = (form: FormData, prefix: string, fields: string[]) => Object.fromEntries(fields.map((field) => [field, value(form, `${prefix}${field}`)]).filter(([, item]) => item));
const SOUTH_AFRICAN_LOCATIONS = {
  "Gauteng": [["Johannesburg", "2000"], ["Pretoria", "0002"], ["Midrand", "1685"], ["Randburg", "2194"], ["Sandton", "2196"], ["Centurion", "0157"], ["Soweto", "1804"], ["Benoni", "1501"]],
  "Western Cape": [["Cape Town", "8001"], ["Stellenbosch", "7600"], ["Paarl", "7646"], ["George", "6529"]],
  "KwaZulu-Natal": [["Durban", "4001"], ["Pietermaritzburg", "3201"]],
  "Eastern Cape": [["Gqeberha", "6001"], ["East London", "5201"]],
  "Free State": [["Bloemfontein", "9301"]],
  "Limpopo": [["Polokwane", "0700"]],
  "Mpumalanga": [["Mbombela", "1200"]],
  "North West": [["Rustenburg", "0300"]],
  "Northern Cape": [["Kimberley", "8301"]],
} satisfies Record<string, [string, string][]>;
const RELATIONSHIPS = ["Spouse", "Partner", "Parent", "Child", "Sibling", "Relative", "Friend", "Colleague", "Employer", "Employee", "Guardian", "Other"];

export function CustomerOperationsWorkspace() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/v1/leasing/customers", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) { setError(payload.error?.message ?? "Customer records could not be loaded."); return; } setCustomers(payload.data); setSelectedId((current) => current || payload.data[0]?.id || ""); }, []);
  useEffect(() => { let cancelled = false; fetch("/api/v1/leasing/customers", { cache: "no-store" }).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => { if (cancelled) return; if (!response.ok) setError(payload.error?.message ?? "Customer records could not be loaded."); else { setCustomers(payload.data); setSelectedId(payload.data[0]?.id || ""); } }); return () => { cancelled = true; }; }, []);
  const selected = customers.find((customer) => customer.id === selectedId) ?? null;
  const visible = useMemo(() => customers.filter((customer) => `${nameOf(customer)} ${customer.email ?? ""} ${customer.phone ?? ""} ${customer.identityRef ?? ""}`.toLowerCase().includes(search.toLowerCase())), [customers, search]);
  const activeTenants = customers.filter((customer) => customer.tenancies.some((tenancy) => ["ACTIVE", "NOTICE_GIVEN"].includes(tenancy.status))).length;

  async function saveCustomer(form: FormData) {
    const current = editing === "new" ? null : editing;
    const payload = {
      type: value(form, "type"), firstName: value(form, "firstName") || undefined, lastName: value(form, "lastName") || undefined, companyName: value(form, "companyName") || undefined,
      email: value(form, "email") || undefined, phone: value(form, "phone") || undefined, identityRef: value(form, "identityRef") || undefined, taxNumber: value(form, "taxNumber") || undefined, dateOfBirth: value(form, "dateOfBirth") || undefined,
      billingAddress: record(form, "address_", ["line1", "line2", "city", "province", "postalCode", "country"]), alternateContact: record(form, "alternate_", ["name", "phone", "email", "relationship"]), workContact: record(form, "work_", ["company", "address", "contact", "phone", "email"]), emergencyContact: record(form, "emergency_", ["name", "phone", "relationship"]),
      communicationConsent: { email: form.get("consentEmail") === "on", sms: form.get("consentSms") === "on", phone: form.get("consentPhone") === "on", recordedAt: new Date().toISOString() }, notes: value(form, "notes") || undefined,
    };
    setBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/v1/leasing/customers", { method: current ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(current ? { id: current.id, data: payload } : payload) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) { setError(result.error?.message ?? "The customer record could not be saved."); return; }
    setEditing(null); setNotice(current ? "Customer details updated." : "Customer created."); await load(); setSelectedId(result.data.id);
  }

  return <div className="page-stack"><PageHeader eyebrow="Operations centre" title="Customers & tenants" description="Operational customer records, contacts, consent, occupancy and activity across all permitted stores." action={<div className="form-actions"><Link href="/operations/move-in" className="button button-secondary">Move in</Link><button className="button button-primary" onClick={() => { setEditing("new"); setError(""); }}><Plus size={16}/>Add customer</button></div>}/>
    {error && !editing ? <p className="form-error">{error}</p> : null}{notice ? <p className="form-success">{notice}</p> : null}
    <section className="summary-strip">{[["Customers", customers.length], ["Active tenants", activeTenants], ["Reservations", customers.reduce((sum, item) => sum + item.reservations.filter((reservation) => reservation.status === "ACTIVE").length, 0)], ["Leads", customers.reduce((sum, item) => sum + item.leads.length, 0)]].map(([label, count]) => <div className="summary-cell" key={label}><span>{label}</span><strong>{count}</strong></div>)}</section>
    <section className="accounts-layout"><aside className="panel accounts-list"><label className="toolbar-search"><Search size={16}/><input placeholder="Search name, contact or ID" value={search} onChange={(event) => setSearch(event.target.value)}/></label>{visible.map((customer) => <button type="button" className={selectedId === customer.id ? "account-list-row active" : "account-list-row"} onClick={() => setSelectedId(customer.id)} key={customer.id}><span><strong>{nameOf(customer)}</strong><small>{customer.phone || customer.email || "No contact details"}</small></span>{customer.type === "BUSINESS" ? <Building2 size={17}/> : <UserRound size={17}/>}</button>)}{!visible.length ? <p className="empty-cell">No customer records found.</p> : null}</aside>
      <article className="panel panel-spacious customer-detail">{selected ? <><div className="panel-heading"><div><p className="eyebrow">{selected.type === "BUSINESS" ? "Business customer" : "Individual customer"}</p><h2>{nameOf(selected)}</h2><p className="panel-subtitle">{selected.email || "No email"} · {selected.phone || "No phone"}</p></div><button className="button button-secondary" onClick={() => { setEditing(selected); setError(""); }}><Pencil size={15}/>Edit details</button></div>
        <div className="customer-record-grid"><Info title="Identity"><Line label="SA ID / passport" text={selected.identityRef}/><Line label="Date of birth" text={selected.dateOfBirth ? new Date(selected.dateOfBirth).toLocaleDateString("en-ZA") : null}/><Line label="Tax number" text={selected.taxNumber}/></Info><Info title="Primary address"><Line label="Address" text={[selected.billingAddress?.line1, selected.billingAddress?.line2].filter(Boolean).join(", ")}/><Line label="Location" text={[selected.billingAddress?.city, selected.billingAddress?.province, selected.billingAddress?.postalCode].filter(Boolean).join(", ")}/><Line label="Country" text={selected.billingAddress?.country}/></Info><Info title="Alternate contact"><Line label="Name" text={selected.alternateContact?.name}/><Line label="Phone" text={selected.alternateContact?.phone}/><Line label="Relationship" text={selected.alternateContact?.relationship}/></Info><Info title="Emergency contact"><Line label="Name" text={selected.emergencyContact?.name}/><Line label="Phone" text={selected.emergencyContact?.phone}/><Line label="Relationship" text={selected.emergencyContact?.relationship}/></Info></div>
        <section className="customer-consent"><strong>Communication consent</strong><StatusPill tone={selected.communicationConsent?.email ? "positive" : "neutral"}>Email {selected.communicationConsent?.email ? "allowed" : "not allowed"}</StatusPill><StatusPill tone={selected.communicationConsent?.sms ? "positive" : "neutral"}>SMS {selected.communicationConsent?.sms ? "allowed" : "not allowed"}</StatusPill><StatusPill tone={selected.communicationConsent?.phone ? "positive" : "neutral"}>Phone {selected.communicationConsent?.phone ? "allowed" : "not allowed"}</StatusPill></section>
        <h3>Tenancies and units</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>Store</th><th>Unit</th><th>Status</th><th>Account</th><th>Balance</th></tr></thead><tbody>{selected.tenancies.length ? selected.tenancies.map((tenancy) => <tr key={tenancy.id}><td>{tenancy.facility.name}</td><td>{tenancy.occupancies[0]?.unit.number ?? "—"} · {tenancy.occupancies[0]?.unit.unitType.name ?? "—"}</td><td>{tenancy.status.replaceAll("_", " ")}</td><td>{tenancy.account.accountNumber}</td><td>R {Number(tenancy.account.balance).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</td></tr>) : <tr><td colSpan={5} className="empty-cell">No tenancy yet. Use Move In when the customer selects a unit.</td></tr>}</tbody></table></div>
        {selected.notes ? <section className="customer-notes"><h3>Operational notes</h3><p>{selected.notes}</p></section> : null}</> : <div className="empty-state"><UserRound size={34}/><strong>No customer selected</strong><p>Add the first real customer or choose an existing record.</p></div>}</article>
    </section>
    {editing ? <CustomerDialog customer={editing === "new" ? null : editing} busy={busy} error={error} close={() => setEditing(null)} save={saveCustomer}/> : null}
  </div>;
}

function Info({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3>{title}</h3>{children}</section>; }
function Line({ label, text }: { label: string; text?: string | null }) { return <div><span>{label}</span><strong>{text || "—"}</strong></div>; }
function CustomerDialog({ customer, busy, error, close, save }: { customer: Customer | null; busy: boolean; error: string; close: () => void; save: (data: FormData) => void }) {
  const address = customer?.billingAddress ?? {}; const alternate = customer?.alternateContact ?? {}; const work = customer?.workContact ?? {}; const emergency = customer?.emergencyContact ?? {};
  const [province, setProvince] = useState(address.province || "");
  const [city, setCity] = useState(address.city || "");
  const [postalCode, setPostalCode] = useState(address.postalCode || "");
  const cities = SOUTH_AFRICAN_LOCATIONS[province as keyof typeof SOUTH_AFRICAN_LOCATIONS] ?? [];
  const chooseProvince = (nextProvince: string) => { setProvince(nextProvince); setCity(""); setPostalCode(""); };
  const chooseCity = (nextCity: string) => { setCity(nextCity); setPostalCode(cities.find(([name]) => name === nextCity)?.[1] ?? ""); };
  return <div className="modal-backdrop"><div className="modal-card customer-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={close}><X size={18}/></button><p className="eyebrow">Operational record</p><h2>{customer ? "Edit customer" : "Add customer"}</h2><form action={save} className="customer-form"><fieldset><legend>Customer</legend><label>Customer type<select name="type" defaultValue={customer?.type ?? "INDIVIDUAL"}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></label><Field name="firstName" label="First name" value={customer?.firstName}/><Field name="lastName" label="Last name" value={customer?.lastName}/><Field name="companyName" label="Company name" value={customer?.companyName}/><Field name="phone" label="Mobile / phone" value={customer?.phone}/><Field name="email" label="Email" type="email" value={customer?.email}/><Field name="identityRef" label="SA ID or passport number" value={customer?.identityRef}/><Field name="dateOfBirth" label="Date of birth" type="date" value={customer?.dateOfBirth?.slice(0,10)}/><Field name="taxNumber" label="Tax number" value={customer?.taxNumber}/></fieldset>
    <fieldset><legend>Primary address</legend><Field name="address_line1" label="Street address" value={address.line1}/><Field name="address_line2" label="Address line 2" value={address.line2}/><SelectField name="address_province" label="Province" value={province} options={Object.keys(SOUTH_AFRICAN_LOCATIONS)} onChange={chooseProvince}/><SelectField name="address_city" label="City" value={city} options={cities.map(([name]) => name)} onChange={chooseCity} disabled={!province}/><label>Postal code<input name="address_postalCode" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} inputMode="numeric"/></label><Field name="address_country" label="Country" value={address.country || "South Africa"}/></fieldset>
    <fieldset><legend>Alternate contact</legend><Field name="alternate_name" label="Name" value={alternate.name}/><SelectField name="alternate_relationship" label="Relationship" value={alternate.relationship || ""} options={RELATIONSHIPS}/><Field name="alternate_phone" label="Phone" value={alternate.phone}/><Field name="alternate_email" label="Email" type="email" value={alternate.email}/></fieldset>
    <fieldset><legend>Emergency and work</legend><Field name="emergency_name" label="Emergency contact" value={emergency.name}/><SelectField name="emergency_relationship" label="Relationship" value={emergency.relationship || ""} options={RELATIONSHIPS}/><Field name="emergency_phone" label="Emergency phone" value={emergency.phone}/><Field name="work_company" label="Employer / company" value={work.company}/><Field name="work_address" label="Employer address" value={work.address}/><Field name="work_contact" label="Work contact" value={work.contact}/><Field name="work_phone" label="Work phone" value={work.phone}/><Field name="work_email" label="Work email" type="email" value={work.email}/></fieldset>
    <fieldset className="customer-form-wide"><legend>Consent and notes</legend><label className="check-label"><input type="checkbox" name="consentEmail" defaultChecked={customer?.communicationConsent?.email}/><span>Email communication consent</span></label><label className="check-label"><input type="checkbox" name="consentSms" defaultChecked={customer?.communicationConsent?.sms}/><span>SMS communication consent</span></label><label className="check-label"><input type="checkbox" name="consentPhone" defaultChecked={customer?.communicationConsent?.phone}/><span>Phone communication consent</span></label><label className="customer-notes-input">Operational notes<textarea name="notes" rows={4} defaultValue={customer?.notes ?? ""}/></label></fieldset>
    {error ? <p className="form-error customer-form-wide">{error}</p> : null}<div className="form-actions customer-form-wide"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save customer"}</button></div></form></div></div>;
}
function Field({ label, value: initial, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & { label: string; value?: string | null }) { return <label>{label}<input defaultValue={initial ?? ""} {...props}/></label>; }
function SelectField({ label, value, options, onChange, ...props }: { label: string; value: string; options: string[]; onChange?: (value: string) => void } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const choices = value && !options.includes(value) ? [value, ...options] : options;
  const optionElements = <><option value="">Select…</option>{choices.map((option) => <option value={option} key={option}>{option}</option>)}</>;
  return <label>{label}{onChange ? <select value={value} onChange={(event) => onChange(event.target.value)} {...props}>{optionElements}</select> : <select defaultValue={value} {...props}>{optionElements}</select>}</label>;
}
