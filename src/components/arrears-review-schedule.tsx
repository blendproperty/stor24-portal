"use client";
import { useState } from "react";
import type { ArrearsReviewScheduleInput } from "@/lib/arrears-review-schedule-policy";
import type { CollectionsWorkspaceData } from "@/lib/collections-service";

type Info = CollectionsWorkspaceData["rows"][number]["accessReviewSchedule"];
export function ArrearsReviewSchedule({ info, today, workerEnabled, disabled, ready, paymentMethod, schedule, cancel }: {
  info: Info; today: string; workerEnabled: boolean; disabled: boolean; ready: boolean; paymentMethod: string | null;
  schedule: (input: ArrearsReviewScheduleInput, revision: string | null) => Promise<boolean>; cancel: (revision: string) => Promise<boolean>;
}) {
  const plan = info.plan;
  const [from, setFrom] = useState(plan?.input.from ?? today), [until, setUntil] = useState(plan?.input.until ?? ""), [time, setTime] = useState(plan?.input.time ?? "09:00"), [confirmed, setConfirmed] = useState(false);
  const locked = disabled || !info.canManage;
  if (info.unavailable) return <section className="adjustment-record arrears-review-schedule"><h3>Daily internal reviews</h3><p>The saved plan needs administrator integrity review. Automatic preparation remains held.</p></section>;
  return <section className="adjustment-record arrears-review-schedule" aria-label="Daily internal reviews">
    <div><h3>Daily internal reviews</h3><p>Check this account each calendar day, including weekends. Prepare a staff task only when the seven-day rule and current payment, dispute and arrangement checks allow it.</p></div>
    <p><strong>{plan ? `Plan: ${plan.status.toLowerCase()}` : "No daily plan saved"}</strong> · Automatic worker setting: {workerEnabled ? "on" : "off"}. A saved plan does not prove that a background evaluation ran.</p>
    {plan && <p>Delegation recorded by {plan.creatorName}. Plan range: {plan.input.from}–{plan.input.until}, from {plan.input.time} SAST each day.</p>}
    {plan?.last && <div className="arrears-review-schedule-result"><strong>Last evaluation: {plan.last.outcome.replaceAll("_", " ").toLowerCase()}</strong><p>{new Date(plan.last.at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })} SAST</p>{plan.last.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>}
    {!info.canSchedule ? <p>Daily plans are available for active EFT/card accounts.{paymentMethod === "DEBIT_ORDER" ? " Debit-order cases stay held until authoritative final-failure evidence is available." : " This account is not currently eligible to schedule."}</p> : <>
      <div className="monthly-grid"><label>Daily review start date<input type="date" min={today} value={from} disabled={locked} onChange={event => { setFrom(event.target.value); setConfirmed(false); }}/></label><label>Daily review end date<input type="date" min={from || today} value={until} disabled={locked} onChange={event => { setUntil(event.target.value); setConfirmed(false); }}/></label><label>Daily review from (SAST)<input type="time" value={time} disabled={locked} onChange={event => { setTime(event.target.value); setConfirmed(false); }}/></label></div>
      <p>Choose up to 93 calendar days. Evaluations become due from the selected time; each run uses current evidence. If today’s time has passed, the plan is due for its first background evaluation.</p>
      <label className="monthly-check"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)}/>I authorise daily internal review task preparation only.</label>
      <div className="adjustment-actions"><button className="button button-secondary" disabled={locked || !ready || !confirmed || !from || from < today || !until || until < from || !time} onClick={() => schedule({ from, until, time }, plan?.revision ?? null)}>{plan?.status === "ACTIVE" ? "Update daily review plan" : "Schedule daily internal reviews"}</button></div>
    </>}
    {plan?.status === "ACTIVE" && <div className="adjustment-actions"><button className="button button-secondary" disabled={locked || !ready} onClick={() => cancel(plan.revision)}>Cancel daily review plan</button></div>}
    {!info.canManage && <p>Managing a daily plan requires current Collections and Operations viewing and management permission at this store.</p>}
    <p>Use the case note above to record the delegation or cancellation. Fee amount stays unset pending Liezl/Mark. Customer messages, financial posting and physical restriction/restoration remain separate.</p>
  </section>;
}
