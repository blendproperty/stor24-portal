"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { scheduledOccurrences, scheduledWorkSchema, type ScheduledWorkInput } from "@/lib/scheduled-work-policy";
import { formatSouthAfricaDateTime, southAfricaDateKey } from "@/lib/south-africa-time";

const purposeLabels = { MEETING: "Meeting", WORK_BLOCK: "Scheduled work", CHECKLIST: "Operational checklist", ACCESS_RESTRICTION: "Access restriction task", PHYSICAL_OVERLOCK: "Physical overlock task" };
const idName = z.object({ id: z.string(), name: z.string() });
const taskSchema = z.object({ id: z.string(), facilityId: z.string(), unitId: z.string().nullable(), assigneeId: z.string().nullable(), purpose: z.enum(["MEETING", "WORK_BLOCK", "CHECKLIST", "ACCESS_RESTRICTION", "PHYSICAL_OVERLOCK"]), title: z.string(), description: z.string().nullable(), startAt: z.iso.datetime(), endAt: z.iso.datetime(), updatedAt: z.iso.datetime(), status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"]), completedAt: z.iso.datetime().nullable(), assignee: idName.nullable(), unit: z.object({ id: z.string(), number: z.string() }).nullable(), facility: idName });
const pageSchema = z.object({ data: z.object({ tasks: z.array(taskSchema), truncated: z.boolean(), facilities: z.array(idName.extend({ timezone: z.string(), units: z.array(z.object({ id: z.string(), number: z.string() })) })), staff: z.array(idName.extend({ facilityIds: z.array(z.string()) })) }) });
type Task = z.infer<typeof taskSchema>;
type Page = z.infer<typeof pageSchema>["data"];
const localTime = (iso: string) => new Date(new Date(iso).getTime() + 2 * 3600000).toISOString().slice(0, 16);

export function ScheduledWork() {
  const router = useRouter();
  const [date, setDate] = useState(() => southAfricaDateKey(new Date()));
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [review, setReview] = useState<{ input: ScheduledWorkInput; status: Task["status"]; requestKey: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setLoading(true); setError("");
    try {
      const start = new Date(`${date}T00:00:00+02:00`), end = new Date(start.getTime() + 7 * 86400000);
      const response = await fetch(`/api/v1/calendar/work?${new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        if ([401, 403].includes(response.status) && request.current === controller) { setEditing(null); setReview(null); }
        throw new Error([401, 403].includes(response.status) ? "Sign in with permission to view this schedule." : "Scheduled work could not be loaded.");
      }
      const next = pageSchema.parse(await response.json()).data;
      if (request.current === controller) setData(next);
    } catch (e) {
      if (request.current === controller) { setData(null); setError(e instanceof Error && !controller.signal.aborted ? e.message : "Scheduled work could not be loaded. Refresh to try again."); }
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setLoading(false); } }
  }, [date]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); request.current?.abort(); request.current = null; }; }, [load]);
  const current = editing && editing !== "new" ? editing : null;
  const closed = current && ["COMPLETED", "CANCELLED"].includes(current.status);
  function preview(form: HTMLFormElement) {
    const values = new FormData(form);
    const parsed = scheduledWorkSchema.safeParse({ facilityId, unitId: values.get("unitId") || null, assigneeId: values.get("assigneeId"), purpose: values.get("purpose"), title: values.get("title"), description: values.get("description"), startAt: new Date(`${values.get("startAt")}+02:00`).toISOString(), endAt: new Date(`${values.get("endAt")}+02:00`).toISOString(), repeat: values.get("repeat") ?? "ONCE", occurrences: Number(values.get("occurrences") ?? 1) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(""); setReview({ input: parsed.data, status: (values.get("status") ?? "OPEN") as Task["status"], requestKey: crypto.randomUUID() });
  }
  async function save() {
    if (!review || saving.current || uncertain) return;
    saving.current = true; setBusy(true); setError("");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch("/api/v1/calendar/work", { method: current ? "PATCH" : "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify(current ? { id: current.id, version: current.updatedAt, input: review.input, status: review.status } : { input: review.input, requestKey: review.requestKey }) });
      const payload = await response.json();
      if ([400, 401, 403, 404, 409, 422].includes(response.status)) { setReview(null); setError(typeof payload.error?.message === "string" ? payload.error.message : "Schedule rejected. Refresh and review your access and details."); if ([401,403].includes(response.status)) { setData(null); setEditing(null); } return; }
      const result = z.object({ data: current ? taskSchema : z.object({ id: z.string().min(1), count: z.literal(review.input.occurrences) }) }).parse(payload);
      if (!response.ok || current && result.data.id !== current.id) throw new Error("Unconfirmed schedule");
      setEditing(null); setReview(null); setNotice(current ? "Occurrence updated. Other occurrences are unchanged." : `${review.input.occurrences} occurrences created with separate completion records.`);
      await load(); router.refresh();
    } catch { setUncertain(true); setReview(null); setError("We could not confirm whether the schedule was saved. Refresh and check the schedule before reloading or creating it again."); }
    finally { clearTimeout(timer); saving.current = false; setBusy(false); }
  }
  return <section className="panel panel-spacious scheduled-work" aria-label="Manage scheduled work">
    <div className="panel-heading"><div><h2>Meetings, work and checklists</h2><p>Each occurrence has its own owner and completion history. All times are SAST.</p></div><button className="button button-primary" disabled={!data || busy || uncertain || loading} onClick={() => { setEditing("new"); setFacilityId(data!.facilities[0]?.id ?? ""); setReview(null); setError(""); }}>New scheduled work</button></div>
    <div className="form-actions"><label>Week starting<input aria-label="Week starting" type="date" value={date} disabled={busy || !!editing} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label><button className="button button-secondary" disabled={loading || busy} onClick={() => void load()}>Refresh scheduled work</button></div>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {uncertain && <p>Saving is disabled in this session. Review the retained records before reloading the page.</p>}
    <div className="work-list" aria-busy={loading}>{data?.tasks.map(task => <div className="work-row" key={task.id}><span className="work-copy"><strong>{task.title}</strong><small>{purposeLabels[task.purpose]} · {task.facility.name}{task.unit ? ` · Unit ${task.unit.number}` : ""} · {task.assignee?.name ?? "Unassigned"}</small><small>{formatSouthAfricaDateTime(task.startAt)}–{formatSouthAfricaDateTime(task.endAt)} · {task.status}{task.completedAt ? ` · completed ${formatSouthAfricaDateTime(task.completedAt)}` : ""}</small></span><button className="button button-secondary" disabled={busy || loading || uncertain} onClick={() => { setEditing(task); setFacilityId(task.facilityId); setReview(null); setError(""); }}>{["COMPLETED", "CANCELLED"].includes(task.status) ? "View record" : "Edit / complete"}</button></div>)}</div>
    {data && !data.tasks.length && !loading && <p>No internal work scheduled in this week.</p>}{data?.truncated && <p role="alert">Showing the first 500 occurrences. Use Operations filters to find additional work.</p>}
    {editing && <form key={current?.id ?? "new"} className="invite-form scheduled-work-editor" aria-label="Scheduled work editor" onChange={() => setReview(null)} onSubmit={event => { event.preventDefault(); preview(event.currentTarget); }}>
      <h3>{current ? "Scheduled occurrence" : "New scheduled work"}</h3>
      <fieldset disabled={busy || uncertain || !!closed}><div className="form-grid">
        <label>Store<select aria-label="Store" name="facilityId" value={facilityId} disabled={!!current} onChange={e => setFacilityId(e.target.value)} required>{data?.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>Activity<select aria-label="Activity" name="purpose" defaultValue={current?.purpose ?? "WORK_BLOCK"}>{Object.entries(purposeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Responsible staff<select aria-label="Responsible staff" key={facilityId} name="assigneeId" defaultValue={current?.assigneeId ?? ""} required><option value="">Choose responsible staff</option>{data?.staff.filter(s => s.facilityIds.includes(facilityId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Unit (required for restriction / overlock)<select aria-label="Unit (required for restriction / overlock)" key={`unit-${facilityId}`} name="unitId" defaultValue={current?.unitId ?? ""}><option value="">No unit</option>{data?.facilities.find(f => f.id === facilityId)?.units.map(u => <option key={u.id} value={u.id}>{u.number}</option>)}</select></label>
        <label>Title<input name="title" required minLength={2} maxLength={160} defaultValue={current?.title ?? ""} /></label>
        <label>Start (SAST)<input name="startAt" type="datetime-local" required defaultValue={current ? localTime(current.startAt) : `${date}T10:00`} /></label>
        <label>End / due (SAST)<input name="endAt" type="datetime-local" required defaultValue={current ? localTime(current.endAt) : `${date}T12:00`} /></label>
        {!current && <><label>Repeat<select aria-label="Repeat" name="repeat" defaultValue="ONCE"><option value="ONCE">Once</option><option value="DAILY">Daily</option><option value="MONTHLY">Monthly</option></select></label><label>Total occurrences<input name="occurrences" type="number" min={1} max={366} defaultValue={1} required /></label></>}
        {current && <label>Status<select aria-label="Status" name="status" defaultValue={current.status}><option>OPEN</option><option>IN_PROGRESS</option><option>WAITING</option><option>COMPLETED</option><option>CANCELLED</option></select></label>}
      </div><label>Instructions / completion notes<textarea name="description" maxLength={4000} rows={3} defaultValue={current?.description ?? ""} /></label></fieldset>
      <p>Restriction and physical-overlock records track staff actions separately. Completion does not confirm an access-system command, payment reconciliation or automatic access restoration.</p>
      {!current && <p>Choose a finite series: up to 366 daily or 24 monthly occurrences. Monthly dates clamp to month end. Add future occurrences when needed; no background recurrence is implied.</p>}
      {review && <div role="status"><strong>Review {review.input.occurrences} occurrence(s)</strong><p>{formatSouthAfricaDateTime(review.input.startAt)} to {formatSouthAfricaDateTime(scheduledOccurrences(review.input).at(-1)!.endAt)} · {purposeLabels[review.input.purpose]} · {review.status}</p><p>Confirm creates or updates only these internal task records.</p></div>}
      <div className="form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => { setEditing(null); setReview(null); }}>Close editor</button>{!closed && <button className="button button-secondary" disabled={busy || uncertain}>Review schedule</button>}{review && <button type="button" className="button button-primary" disabled={busy || uncertain} onClick={() => void save()}>Confirm schedule</button>}</div>
    </form>}
  </section>;
}
