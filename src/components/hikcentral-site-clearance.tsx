"use client";

import { useEffect, useState } from "react";

type Facility = { id: string; name: string };
type Clearance = { confirmed: boolean; window: { date: string; end: string } | null; confirmedAt?: string | null };

export function HikCentralSiteClearance({ facilities }: { facilities: Facility[] }) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [state, setState] = useState<Clearance | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!facilityId) return;
    const controller = new AbortController();
    void fetch(`/api/v1/access/hikcentral-site-clearance?${new URLSearchParams({ facilityId })}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error("Closing check could not be loaded."); return response.json(); })
      .then(body => setState(body.data)).catch(() => { if (!controller.signal.aborted) setError("Closing check could not be loaded."); });
    return () => controller.abort();
  }, [facilityId]);

  async function confirm() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/access/hikcentral-site-clearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facilityId, confirmedEmpty: checked }), cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message ?? "Closing check could not be saved.");
      setState(body.data); setChecked(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Closing check could not be saved."); }
    finally { setBusy(false); }
  }

  return <details className="face-provider-records"><summary>Nightly site clearance <span>Required before overdue face access can be removed</span></summary><div className="panel panel-spacious">
    <h2>Confirm everyone has left Block24</h2>
    <p>After 19:00 SAST, staff or security check that Block24 is empty. Face access cannot be removed between 07:00 and 19:00, or before this dated check. The confirmation is valid for ten minutes while access locks are processed. Keep entry paused and verify the affected customers in Facial access before reopening it.</p>
    <label className="field">Facility<select value={facilityId} onChange={event => { setFacilityId(event.target.value); setState(null); setChecked(false); setError(""); }}>{facilities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <p aria-live="polite">{state?.confirmed ? `Site empty confirmed for ${state.window?.date} at ${new Date(state.confirmedAt!).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg" })}.` : state?.window ? `No empty-site confirmation for ${state.window.date}.` : "Closing checks open at 19:00 SAST."}</p>
    <button className="button button-secondary" type="button" onClick={() => window.location.reload()}>Refresh closing check</button>
    {state?.window && !state.confirmed ? <><label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /> I checked with site security that everyone has left Block24 and entry is paused while overdue locks are processed.</label><button className="button button-primary" type="button" disabled={!checked || busy} onClick={() => void confirm()}>{busy ? "Saving…" : "Confirm empty site for tonight"}</button></> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
  </div></details>;
}
