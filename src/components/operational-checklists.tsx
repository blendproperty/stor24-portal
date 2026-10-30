"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { PageHeader } from "./page-header";
import { checklistIssue, checklistRecordSchema, checklistTemplates, type ChecklistTemplate, type ChecklistRow } from "@/lib/operational-checklist-policy";
import { formatSouthAfricaDateTime, southAfricaDateKey } from "@/lib/south-africa-time";
import styles from "./operational-checklists.module.css";

const taskSchema = z.object({ id: z.string(), title: z.string(), facilityId: z.string(), assigneeId: z.string().nullable(), coverId: z.string().nullable(), status: z.string(), startAt: z.string().nullable(), dueAt: z.string().nullable(), updatedAt: z.string(), completedAt: z.string().nullable(), facility: z.object({ name: z.string() }), assignee: z.object({ name: z.string() }).nullable(), cover: z.object({ name: z.string() }).nullable() });
const responseSchema = z.object({ actorId: z.string(), facilities: z.array(z.object({ id: z.string(), name: z.string() })), managerFacilityIds: z.array(z.string()), staff: z.array(z.object({ id: z.string(), name: z.string(), facilityIds: z.array(z.string()), reviewerFacilityIds: z.array(z.string()) })), tasks: z.array(taskSchema).optional(), nextCursor: z.string().nullable().optional(), task: taskSchema.extend({ operationalChecklist: checklistRecordSchema }).optional() });
type PageData = z.infer<typeof responseSchema>;
type Detail = NonNullable<PageData["task"]>;
type Plan = { template: ChecklistTemplate; facilityId: string; assigneeId: string; coverId: string; reviewerId: string; date: string; start: string; end: string; repeat: "ONCE" | "DAILY" | "WEEKLY"; occurrences: number };
export function OperationalChecklists() {
  const [data, setData] = useState<PageData | null>(null), [tasks, setTasks] = useState<z.infer<typeof taskSchema>[]>([]), [task, setTask] = useState<Detail | null>(null);
  const [facility, setFacility] = useState(""), [closed, setClosed] = useState(false), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [blocked, setBlocked] = useState(true), [message, setMessage] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null), [rows, setRows] = useState<ChecklistRow[]>([]), [summary, setSummary] = useState(""), [reference, setReference] = useState(""), [reviewNote, setReviewNote] = useState("");
  const [assignment, setAssignment] = useState({ assigneeId: "", coverId: "", reviewerId: "" }), [search, setSearch] = useState(""), [onlyIssues, setOnlyIssues] = useState(false), [dirty, setDirty] = useState(false);
  const request = useRef<AbortController | null>(null), writing = useRef(false), requestKey = useRef("");
  const read = useCallback(async (query: { facilityId?: string; closed?: boolean; id?: string; cursor?: string } = {}) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setReading(true); setBlocked(true);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const params = new URLSearchParams(Object.entries(query).filter(([,v]) => v !== undefined && v !== "").map(([k,v]) => [k,String(v)]));
      const response = await fetch(`/api/v1/operations/checklists?${params}`, { cache: "no-store", signal: controller.signal });
      if (request.current !== controller) return;
      if (response.status === 401 || response.status === 403) { setData(null); setTasks([]); setTask(null); setPlan(null); throw Error(response.status === 401 ? "Sign in again to use checklists." : "Checklist access is unavailable. Contact your administrator."); }
      const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message ?? "Could not load checklists.");
      const next = responseSchema.parse(payload.data);
      if (request.current !== controller) return;
      setData(next); if (next.tasks) setTasks(old => query.cursor ? [...old, ...next.tasks!] : next.tasks!);
      if (next.task) {
        setTask(next.task); setRows(next.task.operationalChecklist.rows); setSummary(next.task.operationalChecklist.summary); setReference(next.task.operationalChecklist.comparisonReference); setReviewNote("");
        setAssignment({ assigneeId: next.task.assigneeId ?? "", coverId: next.task.coverId ?? "", reviewerId: next.task.operationalChecklist.reviewerId }); setDirty(false);
      } else { setTask(null); setRows([]); }
      setBlocked(false); setMessage("");
    } catch (e) { if (request.current === controller) setMessage(e instanceof Error ? e.message : "Could not load checklists. Reload before acting."); }
    finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setReading(false); } }
  }, []);
  useEffect(() => {
    let cancelled = false;
    const id = new URLSearchParams(location.search).get("id");
    void Promise.resolve().then(() => { if (!cancelled) void read(id ? { id } : {}); });
    return () => { cancelled = true; request.current?.abort(); request.current = null; };
  }, [read]);
  const reload = () => { if (!dirty || window.confirm("Discard unsaved edits and reload the saved record?")) void read(task ? { id: task.id } : { facilityId: facility, closed }); };
  async function mutate(method: "POST" | "PATCH", body: unknown) {
    if (writing.current || blocked || reading) return;
    writing.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/operations/checklists", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (response.status === 401 || response.status === 403) { setData(null); setTask(null); setTasks([]); setPlan(null); setBlocked(true); throw Error(response.status === 401 ? "Sign in again." : "Your current access does not allow this action. Reload to check access."); }
      if (!response.ok) { if (response.status === 409 || response.status >= 500) setBlocked(true); throw Error(result.error?.message ?? "Could not save. Reload before acting."); }
      if (!result.data?.id) throw Error("The save could not be confirmed. Reload the saved record before trying again.");
      setPlan(null); setDirty(false); await read({ id: result.data.id });
    } catch (e) {
      // An uncertain response must be reconciled by reading, never automatically replayed.
      if (!(e instanceof Error) || /fetch|network|timeout|abort|JSON|confirmed/i.test(e.message)) { setBlocked(true); setMessage("The save could not be confirmed. Reload saved records before trying again."); }
      else setMessage(e.message);
    } finally { writing.current = false; setBusy(false); }
  }
  function act(action: string) {
    if (!task) return;
    void mutate("PATCH", { id: task.id, expectedUpdatedAt: task.updatedAt, action, ...(["SAVE", "SUBMIT"].includes(action) ? { rows: rows.map(({ id,state,notes,evidence,lockCount }) => ({ id,state,notes,evidence,lockCount })), summary, comparisonReference: reference } : ["APPROVE", "RETURN"].includes(action) ? { note: reviewNote } : action === "ASSIGN" ? { ...assignment, coverId: assignment.coverId || null } : {}) });
  }
  function updateRow(id: string, values: Partial<ChecklistRow>) { setRows(old => old.map(r => r.id === id ? { ...r, ...values } : r)); setDirty(true); }
  const disabled = busy || reading || blocked, record = task?.operationalChecklist;
  const manager = !!task && !!data?.managerFacilityIds.includes(task.facilityId), preparer = !!task && (task.assigneeId === data?.actorId || task.coverId === data?.actorId);
  const editable = preparer && task?.status === "IN_PROGRESS" && !disabled;
  const people = (store: string, reviewers = false) => data?.staff.filter(p => (reviewers ? p.reviewerFacilityIds : p.facilityIds).includes(store)) ?? [];
  const staffName = (id: string | null) => data?.staff.find(p => p.id === id)?.name ?? id ?? "—";
  const issues = rows.filter(r => r.state !== "PENDING" && checklistIssue(r)), pending = rows.filter(r => r.state === "PENDING").length;
  function selectors(store: string, value: typeof assignment, change: (v: typeof assignment) => void) {
    return <div className="form-grid"><label>Responsible staff<select aria-label="Responsible staff" required value={value.assigneeId} onChange={e => change({ ...value, assigneeId: e.target.value })}><option value="">Choose staff</option>{people(store).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Absence cover<select aria-label="Absence cover" value={value.coverId} onChange={e => change({ ...value, coverId: e.target.value })}><option value="">No cover assigned</option>{people(store).filter(p => p.id !== value.assigneeId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Manager / GM reviewer<select aria-label="Manager / GM reviewer" required value={value.reviewerId} onChange={e => change({ ...value, reviewerId: e.target.value })}><option value="">Choose reviewer</option>{people(store,true).filter(p => p.id !== value.assigneeId && p.id !== value.coverId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>;
  }
  return <div className={`page-stack operational-checklist-workspace ${styles.workspace}`}>
    <PageHeader eyebrow="Operations" title="Checklists & padlocks" description="Plan daily checks and weekly walkthroughs, record findings and send each run for manager review." action={<Link className="button button-secondary" href="/operations">Operations centre</Link>}/>
    <div className="button-row"><button className="button button-secondary" disabled={busy || reading} onClick={reload}>Reload saved records</button>{data?.managerFacilityIds.length ? <button className="button button-primary" disabled={disabled || dirty} onClick={() => { requestKey.current = crypto.randomUUID(); setPlan({ template: "OPENING", facilityId: data.managerFacilityIds[0], assigneeId: "", coverId: "", reviewerId: "", date: southAfricaDateKey(new Date()), start: "08:00", end: "09:00", repeat: "ONCE", occurrences: 1 }); }}>Plan checklist</button> : null}</div>
    {reading ? <p role="status">Loading saved records…</p> : null}{message ? <p role="alert">{message}</p> : null}
    {plan && <form aria-label="Plan checklist" className="panel panel-spacious" onSubmit={e => { e.preventDefault(); void mutate("POST", { facilityId: plan.facilityId, template: plan.template, assigneeId: plan.assigneeId, coverId: plan.coverId || null, reviewerId: plan.reviewerId, startAt: new Date(`${plan.date}T${plan.start}:00+02:00`).toISOString(), endAt: new Date(`${plan.date}T${plan.end}:00+02:00`).toISOString(), repeat: plan.repeat, occurrences: plan.occurrences, requestKey: requestKey.current }); }}>
      <fieldset disabled={disabled}><legend>Plan checklist</legend><div className="form-grid"><label>Store<select aria-label="Store" value={plan.facilityId} onChange={e => setPlan({ ...plan, facilityId: e.target.value, assigneeId: "", coverId: "", reviewerId: "" })}>{data?.facilities.filter(f => data.managerFacilityIds.includes(f.id)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Checklist<select aria-label="Checklist" value={plan.template} onChange={e => setPlan({ ...plan, template: e.target.value as ChecklistTemplate, repeat: e.target.value === "PADLOCK" ? "WEEKLY" : "ONCE", occurrences: 1 })}>{Object.entries(checklistTemplates).map(([key,t]) => <option key={key} value={key}>{t.name}</option>)}</select></label><label>First date (SAST)<input required type="date" value={plan.date} onChange={e => setPlan({ ...plan, date: e.target.value })}/></label><label>Start (SAST)<input required type="time" value={plan.start} onChange={e => setPlan({ ...plan, start: e.target.value })}/></label><label>Due (SAST)<input required type="time" value={plan.end} onChange={e => setPlan({ ...plan, end: e.target.value })}/></label><label>Repeat<select aria-label="Repeat" value={plan.repeat} onChange={e => setPlan({ ...plan, repeat: e.target.value as Plan["repeat"], occurrences: 1 })}><option value="ONCE">Once</option>{plan.template !== "PADLOCK" && <option value="DAILY">Daily</option>}<option value="WEEKLY">Weekly</option></select></label><label>Total occurrences<input type="number" min="1" max={plan.repeat === "ONCE" ? 1 : 31} required value={plan.occurrences} onChange={e => setPlan({ ...plan, occurrences: Number(e.target.value) })}/></label></div>
      {selectors(plan.facilityId,plan,v => setPlan({ ...plan,...v }))}<p>Creates {plan.occurrences} independent run(s), each with the selected staff and due time. The series ends after those occurrences. Friday equipment tests and Sunday cleaning are included on their scheduled days.</p><button className="button button-primary" type="submit">Create planned runs</button></fieldset><button type="button" className="text-button" disabled={busy} onClick={() => setPlan(null)}>Close planner</button>
    </form>}
    {task && record ? <section className="panel panel-spacious" aria-label="Checklist record">
      <div className="panel-heading"><div><h2>{task.title}</h2><p>{task.facility.name} · {task.status.replaceAll("_"," ")} · Due {formatSouthAfricaDateTime(task.dueAt)} SAST</p></div><button className="text-button" disabled={busy || dirty} onClick={() => void read({ facilityId: facility,closed })}>Back to runs</button></div>
      <p>Responsible: {task.assignee?.name ?? "—"} · Cover: {task.cover?.name ?? "None"} · Reviewer: {staffName(record.reviewerId)}</p>
      {task.dueAt && new Date(task.dueAt) < new Date() && !["COMPLETED","CANCELLED"].includes(task.status) && <p role="status">Overdue — this run still needs completion or review.</p>}
      {record.sourceAt && <p>Inspection list captured {formatSouthAfricaDateTime(record.sourceAt)} SAST. {rows.length - pending}/{rows.length} checked · {issues.length} finding(s){record.template === "PADLOCK" ? ` · ${rows.reduce((n,r) => n + (r.lockCount ?? 0),0)} locks counted` : ""}.</p>}
      {record.template === "PADLOCK" && <p>Compare each unit with the rent roll and the collections list. An open overlock task is a review flag, not approval to restrict access. Findings remain for manager action after sign-off.</p>}
      {record.reviewNote && <p><strong>Reviewer feedback:</strong> {record.reviewNote}</p>}
      {preparer && task.status === "OPEN" && <button className="button button-primary" disabled={disabled} onClick={() => act("START")}>Start inspection</button>}
      {rows.length > 0 && <><div className="form-grid"><label>Find item or unit<input value={search} onChange={e => setSearch(e.target.value)}/></label><label><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)}/> Show findings only</label></div>
      <div className={styles.rows}>{rows.filter(r => r.label.toLowerCase().includes(search.toLowerCase()) && (!onlyIssues || r.state !== "PENDING" && checklistIssue(r))).map(row => <fieldset key={row.id} className={styles.row}><legend>{row.label}</legend>
        {record.template === "PADLOCK" && <p>Rent-roll snapshot: {row.expected === "REVIEW" ? "Requires review" : row.expected.toLowerCase()}{row.overlockTask ? " · Open physical overlock task: compare collections list" : ""}</p>}
        <div className="form-grid"><label>Result<select aria-label="Result" disabled={!editable} value={row.state} onChange={e => updateRow(row.id,{ state: e.target.value as ChecklistRow["state"] })}><option value="PENDING">Not checked</option>{(record.template === "PADLOCK" ? [["VACANT","Vacant"],["OCCUPIED","Occupied"],["OVERLOCKED","Overlocked"]] : [["PASS","Passed"],["ISSUE","Issue / failed"],["NA","Not applicable"]]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {(record.template === "PADLOCK" || row.label.includes("trolleys")) && <label>{record.template === "PADLOCK" ? "Locks counted" : "Trolleys counted"}<input disabled={!editable} type="number" min="0" max="100" step="1" value={row.lockCount ?? ""} onChange={e => updateRow(row.id,{ lockCount: e.target.value === "" ? null : Number(e.target.value) })}/></label>}
        <label>Finding / reason / count<textarea disabled={!editable} maxLength={2000} value={row.notes} onChange={e => updateRow(row.id,{ notes: e.target.value })}/></label><label>Evidence reference<input disabled={!editable} maxLength={500} value={row.evidence} onChange={e => updateRow(row.id,{ evidence: e.target.value })}/></label></div></fieldset>)}</div>
      {record.template === "PADLOCK" && <label>Rent roll and collections comparison reference<textarea disabled={!editable} maxLength={1000} value={reference} onChange={e => { setReference(e.target.value); setDirty(true); }}/></label>}
      <label>Summary and escalation to reviewer<textarea disabled={!editable} maxLength={2000} value={summary} onChange={e => { setSummary(e.target.value); setDirty(true); }}/></label>
      {preparer && task.status === "IN_PROGRESS" && <div className="button-row"><button className="button button-secondary" disabled={disabled} onClick={() => act("SAVE")}>Save progress</button><button className="button button-primary" disabled={disabled || pending > 0} onClick={() => act("SUBMIT")}>Submit for manager review</button>{record.template === "PADLOCK" && <button className="text-button" disabled={disabled} onClick={() => { if (window.confirm("Restart with current units? All recorded results in this draft will be cleared; audit history is retained.")) act("RESTART"); }}>Restart with current units</button>}</div>}
      </>}
      {record.submittedAt && <p>Submitted by {staffName(record.submittedBy)} · {formatSouthAfricaDateTime(record.submittedAt)} SAST</p>}
      {task.status === "WAITING" && manager && record.reviewerId === data?.actorId && record.submittedBy !== data?.actorId && <fieldset disabled={disabled}><legend>Manager review</legend><p>Confirm the findings, evidence and escalation. Sign-off records review; it does not resolve a fault or perform overlocking.</p><label>Review and action note<textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} minLength={5} maxLength={2000}/></label><div className="button-row"><button className="button button-primary" disabled={reviewNote.trim().length < 5} onClick={() => act("APPROVE")}>Sign off review</button><button className="button button-secondary" disabled={reviewNote.trim().length < 5} onClick={() => act("RETURN")}>Return for correction</button></div></fieldset>}
      {record.reviewedAt && <p>Reviewed by {staffName(record.reviewedBy)} · {formatSouthAfricaDateTime(record.reviewedAt)} SAST · {record.reviewNote}</p>}
      {manager && !["COMPLETED","CANCELLED"].includes(task.status) && <details><summary>Staff cover and administration</summary><fieldset disabled={disabled || dirty}>{selectors(task.facilityId,assignment,setAssignment)}<div className="button-row"><button className="button button-secondary" onClick={() => act("ASSIGN")}>Save staff assignments</button><button className="text-button" onClick={() => { if (window.confirm("Cancel this run? Saved results and audit history will be retained.")) act("CANCEL"); }}>Cancel run</button></div></fieldset></details>}
    </section> : <section className="panel panel-spacious"><h2>Planned runs and history</h2><div className="form-grid"><label>Store filter<select aria-label="Store filter" disabled={busy || reading} value={facility} onChange={e => { setFacility(e.target.value); void read({ facilityId: e.target.value,closed }); }}><option value="">All permitted stores</option>{data?.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Run status<select aria-label="Run status" disabled={busy || reading} value={String(closed)} onChange={e => { setClosed(e.target.value === "true"); void read({ facilityId: facility,closed: e.target.value === "true" }); }}><option value="false">Open and awaiting review</option><option value="true">Signed off and cancelled history</option></select></label></div>
      {!reading && !blocked && !tasks.length && <p>No matching runs.</p>}<div className="work-list">{tasks.map(t => <div className={`work-row ${styles.run}`} key={t.id}><div><strong>{t.title}</strong><p>{t.facility.name} · {t.assignee?.name ?? "Unassigned"} · {t.status.replaceAll("_"," ")}</p><p>Due {formatSouthAfricaDateTime(t.dueAt)} SAST{t.dueAt && new Date(t.dueAt) < new Date() && !["COMPLETED","CANCELLED"].includes(t.status) ? " · Overdue" : ""}</p></div><button className="button button-secondary" disabled={disabled} onClick={() => { setSearch(""); setOnlyIssues(false); void read({ id: t.id }); }}>Open record</button></div>)}</div>{data?.nextCursor && <button className="button button-secondary" disabled={disabled} onClick={() => void read({ facilityId: facility,closed,cursor: data.nextCursor! })}>Load more runs</button>}
    </section>}
  </div>;
}
