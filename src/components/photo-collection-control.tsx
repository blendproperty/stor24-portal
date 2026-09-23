"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ShieldCheck } from "lucide-react";
type Snapshot={enabled:boolean;version:number;canToggle:boolean;storageReady:boolean;maintenanceReady:boolean;reviewStatus:string};
export function PhotoCollectionControl({initial}:{initial:Snapshot}) {
  const router=useRouter();
  const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    const refresh=async()=>{
      try { const response=await fetch("/api/v1/access/photo-control",{cache:"no-store",signal:controller.signal}); if (!response.ok) return; const {data}=await response.json(); if (!controller.signal.aborted) { setState(data); if (data.enabled!==initial.enabled) router.refresh(); } } catch { /* Keep the last known setting; never infer enabled from a failed poll. */ }
    };
    const timer=setInterval(()=>void refresh(),15000);
    window.addEventListener("focus",refresh);
    return ()=>{controller.abort();clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[initial.enabled,router]);
  async function toggle() {
    setBusy(true);setError("");
    try { const response=await fetch("/api/v1/access/photo-control",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!state.enabled,version:state.version})});const body=await response.json();if (!response.ok) throw new Error(body.error?.message ?? "Could not save the setting.");setState(body.data);router.refresh(); }
    catch(error) {setError(error instanceof Error ? error.message : "Could not save the setting.");}
    finally {setBusy(false);}
  }
  return <section className="face-workspace" aria-label="Photo collection settings">
    <header className="face-heading"><div><span className="face-eyebrow">OWNER CONTROL</span><h2><Camera size={24} aria-hidden="true" /> Photo collection</h2><p>{state.enabled ? "On — eligible customers can submit photographs for staff review." : "Off — new photograph uploads are paused."}</p></div>
    {state.canToggle ? <button className="button button-primary" role="switch" aria-checked={state.enabled} aria-label="Photo collection" disabled={busy || (!state.enabled && (!state.storageReady || !state.maintenanceReady))} onClick={()=>void toggle()}>{busy ? "Saving…" : state.enabled ? "Turn collection off" : "Turn collection on"}</button> : <span className="face-pill"><ShieldCheck size={14} /> Only the owner can change this</span>}</header>
    <p><strong>{state.reviewStatus}</strong></p>
    <details className="face-provider-records"><summary>Interim collection rules</summary><p>Photographs are retained during the active booking and tenancy. Facial enrolment is required for precinct entry; customers who need help must contact the facility manager. There is currently no alternative entry method configured.</p>
    <p>Proposed payment rule: seven days from confirmed debit-order failure. Automatic payment-based gate suspension and restoration are not connected yet.</p>
    {(!state.storageReady || !state.maintenanceReady) && <p role="status">Setup required: {!state.storageReady ? "secure photo storage" : "photo deletion service"}. Collection cannot open until this is ready.</p>}
    <p>Switching collection on does not activate Hikvision access. Existing agreement, payment, identity and staff-review checks still apply.</p></details>
    {error && <p className="face-feedback" role="alert">{error}</p>}
  </section>;
}
