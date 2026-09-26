"use client";

import { useRef, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { southAfricaDateKey } from "@/lib/south-africa-time";

type Facility = { id: string; name: string };
const checks = [
  { key: "cash-source-review", label: "I checked expected cash against the source records." },
  { key: "cash-count-review", label: "I counted the cash and reviewed the variance." },
];
const cents = (value: unknown) => {
  if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d+(\.\d{1,2})?$/.test(String(value))) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount) <= 999_999_999_999.99 ? Math.round(amount * 100) : null;
};

export function DailyCloseForm({ facilities, unavailable, onRecorded }: { facilities: Facility[]; unavailable: boolean; onRecorded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [facilityId, setFacilityId] = useState("");
  const [businessDate, setBusinessDate] = useState(() => southAfricaDateKey(new Date()));
  const [expected, setExpected] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [attested, setAttested] = useState<boolean[]>([false, false]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [message, setMessage] = useState("");
  const requestPending = useRef(false);
  const expectedCents = cents(expected), countedCents = cents(counted);
  const allowed = facilities.some(facility => facility.id === facilityId);
  const blocked = unavailable || busy || uncertain || recorded;

  async function save() {
    if (requestPending.current || blocked || !allowed || !attested.every(Boolean)) return;
    if (expectedCents === null || countedCents === null || expectedCents < 0 || countedCents < 0) {
      setMessage("Enter non-negative cash amounts with no more than two decimal places."); return;
    }
    requestPending.current = true;
    setBusy(true); setMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let confirmed = false;
    const input = { facilityId, businessDate, expectedCash: expectedCents / 100, countedCash: countedCents / 100, notes: notes.trim(), checks: checks.map((check, index) => ({ ...check, complete: attested[index] })) };
    try {
      const response = await fetch("/api/v1/operations", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ kind: "dailyClose", payload: input }) });
      if (response.status === 401 || response.status === 403) {
        setMessage(response.status === 401 ? "Sign in again before recording a daily close." : "You do not have access to close this facility. Please contact your administrator."); return;
      }
      const payload = await response.json();
      if ([400, 409, 422].includes(response.status)) {
        setMessage(payload.error?.message || "Review the details and existing close records before trying again."); return;
      }
      const saved = payload.data;
      if (!response.ok || !saved || typeof saved.id !== "string" || !saved.id || saved.status !== "CLOSED" || saved.facilityId !== facilityId || saved.businessDate !== `${businessDate}T00:00:00.000Z` || cents(saved.expectedCash) !== expectedCents || cents(saved.countedCash) !== countedCents || cents(saved.variance) !== countedCents - expectedCents || (saved.notes ?? "") !== input.notes || !Array.isArray(saved.checks) || saved.checks.length !== input.checks.length || !input.checks.every(check => saved.checks.some((entry: { key?: string; label?: string; complete?: boolean }) => entry.key === check.key && entry.label === check.label && entry.complete === true))) throw new Error("UNCONFIRMED_CLOSE");
      setRecorded(true);
      confirmed = true;
      setMessage(`Daily close recorded for ${businessDate}. Cash variance: R ${((countedCents - expectedCents) / 100).toFixed(2)}.`);
    } catch {
      setUncertain(true);
      setMessage("We could not confirm whether the daily close was recorded. Reload close records and review this facility and date before trying again.");
    } finally {
      clearTimeout(timeout); requestPending.current = false; setBusy(false);
    }
    if (confirmed) await onRecorded();
  }

  return <div className="daily-close-entry">
    <button className="button button-primary" disabled={unavailable || !facilities.length} onClick={() => setOpen(value => !value)}><ClipboardCheck size={16}/>{open ? "Hide close form" : "Record daily close"}</button>
    {!facilities.length ? <p className="panel-subtitle">Daily-close access is unavailable for your facilities. Please contact your administrator if you require access.</p> : null}
    {message ? <div role={recorded ? "status" : "alert"} className="daily-close-feedback"><p>{message}</p>{uncertain ? <button className="button button-primary" onClick={() => window.location.reload()}>Reload close records</button> : null}{recorded ? <button className="button button-secondary" onClick={() => void onRecorded()}>Refresh close records</button> : null}</div> : null}
    {open ? <form className="invite-form daily-close-form" aria-label="Daily close" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="daily-close-wide panel-subtitle">Record your reviewed cash snapshot. Expected cash comes from your source records. This does not reconcile bank settlements or prevent later financial postings.</p>
      <label>Close facility<select required value={facilityId} disabled={blocked} onChange={event => setFacilityId(event.target.value)}><option value="">Choose facility</option>{facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
      <label>Business date<input required type="date" value={businessDate} disabled={blocked} onChange={event => setBusinessDate(event.target.value)}/></label>
      <label>Expected cash (R)<input required type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" value={expected} disabled={blocked} onChange={event => setExpected(event.target.value)}/></label>
      <label>Counted cash (R)<input required type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" value={counted} disabled={blocked} onChange={event => setCounted(event.target.value)}/></label>
      <p className="daily-close-wide"><strong>Cash variance: {expectedCents === null || countedCents === null ? "Enter both amounts" : `R ${((countedCents - expectedCents) / 100).toFixed(2)}`}</strong></p>
      <label className="daily-close-wide">Close notes<textarea rows={3} maxLength={2000} value={notes} disabled={blocked} onChange={event => setNotes(event.target.value)} placeholder="Source references and any variance explanation"/></label>
      {checks.map((check, index) => <label className="daily-close-wide daily-close-check" key={check.key}><input type="checkbox" required checked={attested[index]} disabled={blocked} onChange={event => setAttested(values => values.map((value, i) => i === index ? event.target.checked : value))}/><span>{check.label}</span></label>)}
      <div className="form-actions"><button type="submit" className="button button-primary" disabled={blocked || !allowed || !attested.every(Boolean)}>{busy ? "Recording…" : "Confirm daily close"}</button>{recorded ? <button type="button" className="button button-secondary" onClick={() => { setRecorded(false); setMessage(""); setBusinessDate(""); setExpected(""); setCounted(""); setNotes(""); setAttested([false, false]); }}>Record another day</button> : null}</div>
    </form> : null}
  </div>;
}
