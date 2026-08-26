"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Clock3, Globe2, MapPin, Plus, SlidersHorizontal, Trash2, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProgramDefaults } from "@/components/program-defaults";
import { TenantDefaults } from "@/components/tenant-defaults";
import { StatusPill } from "@/components/status-pill";

type Profile = { id: string; facilityId: string | null; domain: string; name: string; status: string; config: Record<string, unknown> };
type Facility = { id: string; name: string; code: string; timezone: string; active: boolean; publicSlug: string | null; publicBookingEnabled: boolean };
type SetupData = { profiles: Profile[]; integrations: { status: string }[]; facilities: Facility[]; roles: unknown[]; users: unknown[] };
type AttributeRow = { name: string; description: string; used: boolean };
type SetupSection = "STORE_INFORMATION" | "TENANT_DEFAULTS" | "WEBSITE_ATTRIBUTES" | "PROGRAM_DEFAULTS";

const setupDomains = new Set<SetupSection>(["STORE_INFORMATION", "TENANT_DEFAULTS", "WEBSITE_ATTRIBUTES", "PROGRAM_DEFAULTS"]);
const weekDays = ["Weekday", "Saturday", "Sunday"] as const;
const citiesByProvince: Record<string, string[]> = {
  "Eastern Cape": ["Bhisho", "East London", "Gqeberha", "Graaff-Reinet", "Mthatha"],
  "Free State": ["Bethlehem", "Bloemfontein", "Sasolburg", "Welkom"],
  Gauteng: ["Benoni", "Boksburg", "Centurion", "Germiston", "Johannesburg", "Kempton Park", "Midrand", "Pretoria", "Randburg", "Roodepoort", "Sandton", "Vereeniging"],
  "KwaZulu-Natal": ["Ballito", "Durban", "Newcastle", "Pietermaritzburg", "Richards Bay", "Umhlanga"],
  Limpopo: ["Mokopane", "Polokwane", "Thohoyandou", "Tzaneen"],
  Mpumalanga: ["eMalahleni", "Mbombela", "Middelburg", "Secunda"],
  "Northern Cape": ["Kimberley", "Kuruman", "Upington"],
  "North West": ["Brits", "Klerksdorp", "Mahikeng", "Potchefstroom", "Rustenburg"],
  "Western Cape": ["Cape Town", "George", "Knysna", "Mossel Bay", "Paarl", "Stellenbosch", "Worcester"],
};
const provinces = Object.keys(citiesByProvince);
const blankStore = {
  dbaName: "", legalName: "", address1: "", address2: "", city: "", province: "", postalCode: "", country: "South Africa",
  registrationNumber: "", mobile: "", fax: "", primaryDivision: "", managementArea: "", taxNumber: "", contactName: "", email: "",
  websiteUrl: "", onlinePayments: false, directions: "", latitude: "", longitude: "",
  weekdayClosed: false, weekdayStart: "08:00", weekdayEnd: "17:00", saturdayClosed: false, saturdayStart: "08:00", saturdayEnd: "13:00", sundayClosed: true, sundayStart: "", sundayEnd: "",
};

function textValue(value: unknown) { return typeof value === "string" ? value : ""; }
function booleanValue(value: unknown) { return value === true; }

export function CompanyWorkspace() {
  const [data, setData] = useState<SetupData | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [section, setSection] = useState<SetupSection>("STORE_INFORMATION");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAddStore, setShowAddStore] = useState(false);
  const [storeBusy, setStoreBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/configuration", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) setError(payload.error?.message ?? "Setup data could not be loaded.");
    else { setData(payload.data); setFacilityId((current) => current || payload.data.facilities[0]?.id || ""); setError(""); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/configuration", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) setError(payload.error?.message ?? "Setup data could not be loaded.");
        else { setData(payload.data); setFacilityId(payload.data.facilities[0]?.id || ""); }
      });
    return () => { cancelled = true; };
  }, []);

  const profile = useCallback((domain: string) => data?.profiles.find((item) => item.domain === domain && item.facilityId === facilityId), [data, facilityId]);
  const selectedFacility = data?.facilities.find((facility) => facility.id === facilityId);
  const configured = useMemo(() => new Set(data?.profiles.filter((item) => item.facilityId === facilityId && setupDomains.has(item.domain as SetupSection)).map((item) => item.domain)), [data, facilityId]);

  async function save(domain: string, config: Record<string, unknown>) {
    if (!facilityId) { setError("Select a facility before saving setup details."); return; }
    setBusy(true); setNotice(""); setError("");
    const response = await fetch("/api/v1/configuration", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "profile", payload: { facilityId, domain, name: "Default", status: "READY", config } }) });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Configuration could not be saved."); return; }
    setNotice("Setup saved for this facility."); await load();
  }

  async function saveStoreInformation(config: Record<string, unknown>, publicSettings: { publicSlug: string | null; publicBookingEnabled: boolean }) {
    if (!facilityId) { setError("Select a facility before saving setup details."); return; }
    setBusy(true); setNotice(""); setError("");
    const profileResponse = await fetch("/api/v1/configuration", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "profile", payload: { facilityId, domain: "STORE_INFORMATION", name: "Default", status: "READY", config } }) });
    const profilePayload = await profileResponse.json();
    if (!profileResponse.ok) { setBusy(false); setError(profilePayload.error?.message ?? "Store information could not be saved."); return; }
    const slugResponse = await fetch("/api/v1/leasing/facilities", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: facilityId, data: { publicSlug: publicSettings.publicSlug } }) });
    const slugPayload = await slugResponse.json();
    if (!slugResponse.ok) { setBusy(false); setError(slugPayload.error?.message ?? slugPayload.error?.fields?.publicSlug?.[0] ?? "Public store address could not be saved."); return; }
    const facilityResponse = await fetch("/api/v1/leasing/facilities", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: facilityId, data: { publicBookingEnabled: publicSettings.publicBookingEnabled } }) });
    const facilityPayload = await facilityResponse.json(); setBusy(false);
    if (!facilityResponse.ok) { setError(facilityPayload.error?.message ?? facilityPayload.error?.fields?.publicSlug?.[0] ?? "Website booking settings could not be saved."); return; }
    setNotice(publicSettings.publicBookingEnabled ? "Store setup saved and website booking enabled." : "Store setup saved."); await load();
  }

  async function addStore(formData: FormData) {
    setStoreBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/v1/leasing/facilities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: String(formData.get("name") ?? ""), code: String(formData.get("code") ?? ""), timezone: "Africa/Johannesburg", active: true }) });
    const payload = await response.json(); setStoreBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? payload.error?.fields?.code?.[0] ?? "Store could not be added."); return; }
    setShowAddStore(false); setNotice(`${payload.data.name} added.`); await load(); setFacilityId(payload.data.id);
  }

  return <div className="page-stack">
    <PageHeader eyebrow="Administration" title="Company setup" description="Facility information and operational defaults, organised to match the SiteLink Site Setup workflow." action={<div className="facility-actions"><label className="facility-picker"><span>Store</span><select value={facilityId} onChange={(event) => { setFacilityId(event.target.value); setNotice(""); }}>{data?.facilities.map((facility) => <option value={facility.id} key={facility.id}>{facility.name}</option>)}</select></label><button type="button" className="button button-primary" onClick={() => setShowAddStore((current) => !current)}><Plus size={16}/>{showAddStore ? "Cancel" : "Add store"}</button></div>}/>
    {showAddStore ? <form action={addStore} className="panel add-store-form"><div><p className="eyebrow">Portfolio</p><h2>Add another store</h2><p className="panel-subtitle">Create a separate store workspace with its own contact details, hours, website attributes and defaults.</p></div><Field name="name" label="Store name" placeholder="e.g. Store 7 – Location TBC" required/><Field name="code" label="Store code" placeholder="e.g. STORE-7" required maxLength={40}/><button className="button button-primary" disabled={storeBusy}>{storeBusy ? "Adding…" : "Add store"}</button></form> : null}
    {error ? <p className="form-error">{error}</p> : null}{notice ? <p className="form-success"><CheckCircle2 size={16}/>{notice}</p> : null}
    <section className="summary-strip">{[["Facilities", data?.facilities.length ?? 0], ["Employees", data?.users.length ?? 0], ["Security levels", data?.roles.length ?? 0], ["Setup sections", `${configured.size}/4`]].map(([label, value]) => <div className="summary-cell" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <section className="setup-layout company-setup-layout">
      <nav className="panel setup-nav" aria-label="Company setup sections">
        <div className="setup-nav-heading"><Building2 size={18}/><div><strong>Site setup</strong><small>{selectedFacility?.name ?? "Select a facility"}</small></div></div>
        <SetupNavButton active={section === "STORE_INFORMATION"} configured={configured.has("STORE_INFORMATION")} icon={<MapPin size={17}/>} label="Store information" onClick={() => setSection("STORE_INFORMATION")}/>
        <SetupNavButton active={section === "TENANT_DEFAULTS"} configured={configured.has("TENANT_DEFAULTS")} icon={<UsersRound size={17}/>} label="Tenant defaults" onClick={() => setSection("TENANT_DEFAULTS")}/>
        <SetupNavButton active={section === "WEBSITE_ATTRIBUTES"} configured={configured.has("WEBSITE_ATTRIBUTES")} icon={<Globe2 size={17}/>} label="Attributes on website" onClick={() => setSection("WEBSITE_ATTRIBUTES")}/>
        <SetupNavButton active={section === "PROGRAM_DEFAULTS"} configured={configured.has("PROGRAM_DEFAULTS")} icon={<SlidersHorizontal size={17}/>} label="Program defaults" onClick={() => setSection("PROGRAM_DEFAULTS")}/>
      </nav>
      <article className="panel panel-spacious company-setup-panel">
        {section === "STORE_INFORMATION" ? <StoreInformation key={`${facilityId}-${profile("STORE_INFORMATION")?.id ?? "new"}`} initial={profile("STORE_INFORMATION")?.config} facility={selectedFacility} busy={busy} onSave={saveStoreInformation}/> : null}
        {section === "TENANT_DEFAULTS" ? <TenantDefaults key={`${facilityId}-${profile("TENANT_DEFAULTS")?.id ?? "new"}`} initial={profile("TENANT_DEFAULTS")?.config} busy={busy} onSave={(config) => save("TENANT_DEFAULTS", config)}/> : null}
        {section === "WEBSITE_ATTRIBUTES" ? <WebsiteAttributes key={`${facilityId}-${profile("WEBSITE_ATTRIBUTES")?.id ?? "new"}`} initial={profile("WEBSITE_ATTRIBUTES")?.config} busy={busy} onSave={(config) => save("WEBSITE_ATTRIBUTES", config)}/> : null}
        {section === "PROGRAM_DEFAULTS" ? <ProgramDefaults key={`${facilityId}-${profile("PROGRAM_DEFAULTS")?.id ?? "new"}`} initial={profile("PROGRAM_DEFAULTS")?.config} busy={busy} stores={data?.facilities.map(({ id, name }) => ({ id, name })) ?? []} currentStoreId={facilityId} onSave={(config) => save("PROGRAM_DEFAULTS", config)}/> : null}
      </article>
    </section>
  </div>;
}

function SetupNavButton({ active, configured, icon, label, onClick }: { active: boolean; configured: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "setup-nav-active" : ""} onClick={onClick}><span>{icon}<strong>{label}</strong></span><StatusPill tone={configured ? "positive" : "warning"}>{configured ? "Saved" : "Configure"}</StatusPill></button>;
}

function StoreInformation({ initial, facility, busy, onSave }: { initial?: Record<string, unknown>; facility?: Facility; busy: boolean; onSave: (config: Record<string, unknown>, publicSettings: { publicSlug: string | null; publicBookingEnabled: boolean }) => void }) {
  const values = { ...blankStore, ...initial, mobile: textValue(initial?.mobile) || textValue(initial?.phone) };
  const [province, setProvince] = useState(textValue(values.province));
  const [city, setCity] = useState(textValue(values.city));
  const cityOptions = citiesByProvince[province] ?? [];
  function submit(formData: FormData) {
    const config: Record<string, unknown> = {};
    Object.keys(blankStore).forEach((key) => { config[key] = typeof blankStore[key as keyof typeof blankStore] === "boolean" ? formData.get(key) === "on" : String(formData.get(key) ?? ""); });
    const publicBookingEnabled = formData.get("publicBookingEnabled") === "on";
    const publicSlug = String(formData.get("publicSlug") ?? "").trim().toLowerCase() || null;
    onSave(config, { publicSlug, publicBookingEnabled });
  }
  return <form action={submit} className="company-form">
    <div className="panel-heading"><div><p className="eyebrow">General setup</p><h2>Store information</h2><p className="panel-subtitle">Contact information, business hours, location and website details for the selected facility.</p></div><Building2 className="positive-icon"/></div>
    <div className="company-form-grid">
      <fieldset><legend>Contact information</legend><div className="field-grid two-column">
        <Field name="dbaName" label="Store name (DBA)" value={textValue(values.dbaName)} required/><Field name="legalName" label="Store legal name" value={textValue(values.legalName)}/><Field name="registrationNumber" label="Company registration number" value={textValue(values.registrationNumber)}/><Field name="address1" label="Store address" value={textValue(values.address1)} required/><Field name="address2" label="Address line 2" value={textValue(values.address2)}/><SelectField name="province" label="Province" value={province} options={provinces} placeholder="Select a province" required onChange={(event) => { const nextProvince = event.target.value; setProvince(nextProvince); setCity((current) => citiesByProvince[nextProvince]?.includes(current) ? current : ""); }}/><SelectField name="city" label="City" value={city} options={cityOptions} placeholder={province ? "Select a major city" : "Select a province first"} disabled={!province} required onChange={(event) => setCity(event.target.value)}/><Field name="postalCode" label="Postal code" value={textValue(values.postalCode)} required/><Field name="country" label="Country" value={textValue(values.country)} required/><Field name="mobile" label="Mobile" value={textValue(values.mobile)}/><Field name="fax" label="Fax" value={textValue(values.fax)}/><Field name="primaryDivision" label="Primary division" value={textValue(values.primaryDivision)}/><Field name="managementArea" label="Management area" value={textValue(values.managementArea)} maxLength={10}/><Field name="taxNumber" label="Tax number" value={textValue(values.taxNumber)}/><Field name="contactName" label="Store contact" value={textValue(values.contactName)}/><Field name="email" label="Email address" value={textValue(values.email)} type="email"/></div></fieldset>
      <fieldset><legend><Clock3 size={16}/>Business hours</legend><div className="hours-grid">{weekDays.map((day) => { const key = day.toLowerCase(); return <div className="hours-row" key={day}><label className="check-label"><input type="checkbox" name={`${key}Closed`} defaultChecked={booleanValue(values[`${key}Closed` as keyof typeof values])}/><span>Closed {day}</span></label><Field name={`${key}Start`} label="Start" value={textValue(values[`${key}Start` as keyof typeof values])} type="time"/><Field name={`${key}End`} label="End" value={textValue(values[`${key}End` as keyof typeof values])} type="time"/></div>; })}</div><p className="field-help">Business day runs from 00:00 to 23:59.</p></fieldset>
      <fieldset><legend><MapPin size={16}/>Store location</legend><div className="field-grid two-column"><Field name="latitude" label="Latitude" value={textValue(values.latitude)} inputMode="decimal"/><Field name="longitude" label="Longitude" value={textValue(values.longitude)} inputMode="decimal"/></div></fieldset>
      <fieldset><legend><Globe2 size={16}/>Website information</legend><div className="field-grid"><Field name="websiteUrl" label="Website URL" value={textValue(values.websiteUrl)} type="url"/><label className="check-label"><input type="checkbox" name="onlinePayments" defaultChecked={booleanValue(values.onlinePayments)}/><span>Online payments supported</span></label><label>Driving directions or location description<textarea name="directions" rows={5} defaultValue={textValue(values.directions)}/></label></div></fieldset>
      <fieldset><legend><Globe2 size={16}/>Website booking</legend><div className="field-grid"><Field name="publicSlug" label="Public store address" defaultValue={facility?.publicSlug ?? ""} placeholder="midpoint" pattern="[a-z0-9]+(?:-[a-z0-9]+)*"/><p className="field-help">Used in the public booking URL, for example /storage/midpoint.</p><label className="check-label"><input type="checkbox" name="publicBookingEnabled" defaultChecked={facility?.publicBookingEnabled ?? false}/><span>Show this store and its available units on the public website</span></label><p className="safe-config-note"><CheckCircle2 size={16}/>Only customer-safe availability and map details are shared. Staff, tenant and internal configuration data remain private.</p></div></fieldset>
    </div><FormFooter busy={busy}/>
  </form>;
}

function WebsiteAttributes({ initial, busy, onSave }: { initial?: Record<string, unknown>; busy: boolean; onSave: (config: Record<string, unknown>) => void }) {
  const readRows = (key: string) => Array.isArray(initial?.[key]) ? initial?.[key] as AttributeRow[] : [];
  const [unitAttributes, setUnitAttributes] = useState<AttributeRow[]>(readRows("unitAttributes"));
  const [storeAttributes, setStoreAttributes] = useState<AttributeRow[]>(readRows("storeAttributes"));
  return <div className="company-form"><div className="panel-heading"><div><p className="eyebrow">Program defaults</p><h2>Attributes on website</h2><p className="panel-subtitle">Choose the unit and store attributes exposed to your website and approved integrations.</p></div><Globe2 className="positive-icon"/></div><p className="safe-config-note"><CheckCircle2 size={16}/>Only attributes marked “Used” are made available to website consumers.</p><div className="attribute-columns"><AttributeEditor title="Unit attributes" rows={unitAttributes} onChange={setUnitAttributes}/><AttributeEditor title="Store attributes" rows={storeAttributes} onChange={setStoreAttributes}/></div><FormFooter busy={busy} onClick={() => onSave({ unitAttributes, storeAttributes })}/></div>;
}

function AttributeEditor({ title, rows, onChange }: { title: string; rows: AttributeRow[]; onChange: (rows: AttributeRow[]) => void }) {
  return <section className="attribute-editor"><div className="attribute-heading"><h3>{title}</h3><button type="button" className="button button-secondary button-small" onClick={() => onChange([...rows, { name: "", description: "", used: true }])}><Plus size={14}/>Add attribute</button></div>{rows.length ? <div className="attribute-list">{rows.map((row, index) => <div className="attribute-row" key={index}><input aria-label={`${title} name ${index + 1}`} placeholder="Attribute name" value={row.name} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}/><input aria-label={`${title} description ${index + 1}`} placeholder="Description" value={row.description} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))}/><label className="check-label compact"><input type="checkbox" checked={row.used} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, used: event.target.checked } : item))}/><span>Used</span></label><button type="button" className="icon-button" aria-label={`Remove ${row.name || "attribute"}`} onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15}/></button></div>)}</div> : <p className="empty-cell">No attributes added yet.</p>}</section>;
}

function Field({ label, value, onChange, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const editableValue = onChange
    ? { value, onChange }
    : value !== undefined
      ? { defaultValue: value }
      : {};
  return <label>{label}<input {...props} {...editableValue}/></label>;
}
function SelectField({ label, options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: string[]; placeholder: string }) { return <label>{label}<select {...props}><option value="">{placeholder}</option>{props.value && !options.includes(String(props.value)) ? <option value={String(props.value)}>{String(props.value)}</option> : null}{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>; }
function FormFooter({ busy, onClick }: { busy: boolean; onClick?: () => void }) { return <div className="form-footer"><button type={onClick ? "button" : "submit"} className="button button-primary" disabled={busy} onClick={onClick}>{busy ? "Saving…" : "Save setup"}</button></div>; }
