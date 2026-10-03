"use client";
import { useEffect, useState } from "react";
type Customer = {id: string; firstName: string | null; lastName: string | null; companyName: string | null; email: string | null; phone: string | null};
export function LeadCustomerPicker({facilityId}: {facilityId: string}) {
  const [mode,setMode] = useState("existing"); const [query,setQuery] = useState("");
  const [customers,setCustomers] = useState<Customer[]>([]); const [selected,setSelected] = useState<Customer | null>(null); const [status,setStatus] = useState("");
  useEffect(()=> {let active = true; const controller = new AbortController();
    const timer = setTimeout(()=> {if (mode !== "existing" || !facilityId || query.trim().length < 2) {setCustomers([]); return;}
      setStatus("Searching…"); void fetch(`/api/v1/leads/customers?facilityId=${encodeURIComponent(facilityId)}&q=${encodeURIComponent(query)}`, {cache:"no-store",signal:controller.signal})
        .then(async r=>{if(!r.ok)throw Error("Could not search customers. Try again.");return r.json();})
        .then(result=>{if(active){setCustomers(result.data);setStatus(result.data.length ? "" : "No matching customers. Choose Create new customer below.");}})
        .catch(error=>{if(active)setStatus(error.message);});
    },250); return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[query,facilityId,mode]);
  return <fieldset className="lead-customer-picker"><legend>Customer</legend><label>Choose a customer<select aria-label="Customer choice" value={mode} onChange={e=>{setMode(e.target.value);setSelected(null);setStatus("");}}><option value="existing">Select existing customer</option><option value="new">+ Create new customer here</option></select></label>
    {mode === "existing" ? <><label>Find existing customer<input aria-label="Find existing customer" value={query} disabled={!facilityId} placeholder="Search name, email or phone" onChange={e=>{setQuery(e.target.value);setSelected(null);}}/></label><p className="leads-caption">{!facilityId ? "Select a store first." : "Enter at least two characters. Up to 25 accessible matches."}</p>{status&&<p role="status">{status}</p>}
      {!selected&&customers.map(c=><button type="button" className="lead-customer-match" key={c.id} onClick={()=>{setSelected(c);setCustomers([]);setStatus("");}}><strong>{c.companyName || [c.firstName,c.lastName].filter(Boolean).join(" ")}</strong><span>{c.phone || c.email || "No contact details"}</span></button>)}
      {selected&&<div className="lead-customer-selected"><strong>{selected.companyName || [selected.firstName,selected.lastName].filter(Boolean).join(" ")}</strong><span>{selected.phone} {selected.email}</span></div>}
      <input name="customerId" aria-label="Selected customer" value={selected?.id || ""} required readOnly className="lead-customer-validation" tabIndex={-1}/>
    </> : <><p className="leads-caption">Capture contact details now. Complete billing and identity details when preparing the lease.</p><div className="leads-form-row"><label>First name<input name="firstName" required maxLength={80} autoComplete="given-name"/></label><label>Last name<input name="lastName" required maxLength={80} autoComplete="family-name"/></label></div><div className="leads-form-row"><label>Mobile / phone<input name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel"/></label><label>Email (optional)<input name="email" type="email" autoComplete="email"/></label></div></>}
  </fieldset>;
}
