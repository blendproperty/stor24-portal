"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { PageHeader } from "./page-header";
import { StatusPill } from "./status-pill";
import { checklistHref, checklistIssue, checklistRecordSchema, checklistRows, checklistRowSchema, checklistTemplates, type ChecklistTemplate, type ChecklistRow } from "@/lib/operational-checklist-policy";
import { formatSouthAfricaDateTime, southAfricaDateKey } from "@/lib/south-africa-time";
import { OperationalChecklistSheet, workbookItemLabel } from "./operational-checklist-sheet";
import styles from "./operational-checklists.module.css";

const runStatusLabels: Record<string, string> = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING: "Awaiting review", COMPLETED: "Signed off", CANCELLED: "Cancelled" };

const taskSchema = z.object({ id: z.string(), title: z.string(), facilityId: z.string(), assigneeId: z.string().nullable(), coverId: z.string().nullable(), status: z.string(), startAt: z.string().nullable(), dueAt: z.string().nullable(), updatedAt: z.string(), completedAt: z.string().nullable(), facility: z.object({ name: z.string() }), assignee: z.object({ name: z.string() }).nullable(), cover: z.object({ name: z.string() }).nullable() });
const responseSchema = z.object({ actorId: z.string(), facilities: z.array(z.object({ id: z.string(), name: z.string() })), managerFacilityIds: z.array(z.string()), staff: z.array(z.object({ id: z.string(), name: z.string(), facilityIds: z.array(z.string()), reviewerFacilityIds: z.array(z.string()), padlockReviewerFacilityIds: z.array(z.string()) })), week: z.array(z.object({ id: z.string(), day: z.number().int().min(0).max(6), name: z.string().nullable(), rows: z.array(checklistRowSchema) })).optional(), tasks: z.array(taskSchema).optional(), nextCursor: z.string().nullable().optional(), task: taskSchema.extend({ operationalChecklist: checklistRecordSchema }).optional() });
type PageData = z.infer<typeof responseSchema>;
type Detail = NonNullable<PageData["task"]>;
type Plan = { template: ChecklistTemplate; facilityId: string; assigneeId: string; coverId: string; reviewerId: string; date: string; start: string; end: string; repeat: "ONCE" | "DAILY" | "WEEKLY"; occurrences: number };
export function OperationalChecklists({ kind = "checklists" }: { kind?: "checklists" | "padlocks" }) {
  const padlocks = kind === "padlocks";
  const title = padlocks ? "Padlock counts" : "Checklists";
  const planLabel = padlocks ? "Plan padlock count" : "Plan checklist";
  const assigneeLabel = padlocks ? "Counting CSO / assigned staff" : "Responsible staff";
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
      if (!query.id) params.set("kind", kind);
      const response = await fetch(`/api/v1/operations/checklists?${params}`, { cache: "no-store", signal: controller.signal });
      if (request.current !== controller) return;
      if (response.status === 401 || response.status === 403) { setData(null); setTasks([]); setTask(null); setPlan(null); throw Error(response.status === 401 ? "Sign in again to use checklists." : "Checklist access is unavailable. Contact your administrator."); }
      const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message ?? "Could not load checklists.");
      const next = responseSchema.parse(payload.data);
      if (request.current !== controller) return;
      if (next.task && (next.task.operationalChecklist.template === "PADLOCK") !== padlocks) {
        const title = checklistTemplates[next.task.operationalChecklist.template].name;
        window.location.replace(checklistHref(title, next.task.id));
        return;
      }
      setData(next); if (next.tasks) setTasks(old => query.cursor ? [...old, ...next.tasks!] : next.tasks!);
      if (next.task) {
        setTask(next.task); setRows(next.task.operationalChecklist.rows); setSummary(next.task.operationalChecklist.summary); setReference(next.task.operationalChecklist.comparisonReference); setReviewNote("");
        setAssignment({ assigneeId: next.task.assigneeId ?? "", coverId: next.task.coverId ?? "", reviewerId: next.task.operationalChecklist.reviewerId }); setDirty(false);
      } else { setTask(null); setRows([]); }
      setBlocked(false); setMessage("");
    } catch (e) { if (request.current === controller) setMessage(e instanceof Error ? e.message : "Could not load checklists. Reload before acting."); }
    finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setReading(false); } }
  }, [kind, padlocks]);
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
    void mutate("PATCH", { id: task.id, expectedUpdatedAt: task.updatedAt, action, ...(["SAVE", "SUBMIT"].includes(action) ? { rows: rows.map(({ id,state,notes,evidence,lockCount,comparisonDiscrepancy }) => ({ id,state,notes,evidence,lockCount,comparisonDiscrepancy })), summary, comparisonReference: reference } : ["APPROVE", "RETURN"].includes(action) ? { note: reviewNote } : action === "ASSIGN" ? { ...assignment, coverId: assignment.coverId || null } : {}) });
  }
  function updateRow(id: string, values: Partial<ChecklistRow>) { setRows(old => old.map(r => r.id === id ? { ...r, ...values } : r)); setDirty(true); }
  const disabled = busy || reading || blocked, record = task?.operationalChecklist;
  const manager = !!task && !!data?.managerFacilityIds.includes(task.facilityId), preparer = !!task && (task.assigneeId === data?.actorId || task.coverId === data?.actorId);
  const editable = preparer && task?.status === "IN_PROGRESS" && !disabled;
  const people = (store: string, reviewers = false) => data?.staff.filter(p => (reviewers ? (padlocks ? p.padlockReviewerFacilityIds : p.reviewerFacilityIds) : p.facilityIds).includes(store)) ?? [];
  const canPrintWalk = preparer || !!task && people(task.facilityId, true).some(person => person.id === data?.actorId);
  const staffName = (id: string | null) => data?.staff.find(p => p.id === id)?.name ?? id ?? "—";
  const sheetDate = task?.startAt ?? task?.dueAt;
  const sheetRows = !rows.length && record && sheetDate && !padlocks && task?.status === "OPEN" ? checklistRows(record.template, new Date(sheetDate)) : rows;
  const week = data?.week ?? [];
  const visibleLabels = new Set([...sheetRows, ...week.flatMap(day => day.rows)]
    .filter(row => (row.label.toLowerCase().includes(search.toLowerCase()) || record && workbookItemLabel(record.template, row.label).toLowerCase().includes(search.toLowerCase())) && (!onlyIssues || row.state !== "PENDING" && checklistIssue(row)))
    .map(row => row.label));
  const issues = rows.filter(r => r.state !== "PENDING" && checklistIssue(r)), pending = rows.filter(r => r.state === "PENDING").length;
  function selectors(store: string, value: typeof assignment, change: (v: typeof assignment) => void) {
    return <div className={styles.peopleGrid}><label>{assigneeLabel}<select aria-label={assigneeLabel} required value={value.assigneeId} onChange={e => change({ ...value, assigneeId: e.target.value })}><option value="">Choose staff</option>{people(store).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Absence cover<select aria-label="Absence cover" value={value.coverId} onChange={e => change({ ...value, coverId: e.target.value })}><option value="">No cover assigned</option>{people(store).filter(p => p.id !== value.assigneeId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Manager / GM reviewer<select aria-label="Manager / GM reviewer" required value={value.reviewerId} onChange={e => change({ ...value, reviewerId: e.target.value })}><option value="">Choose reviewer</option>{people(store,true).filter(p => p.id !== value.assigneeId && p.id !== value.coverId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>;
  }
  return <div className={`page-stack operational-checklist-workspace ${styles.workspace}`}>
    <PageHeader eyebrow="Operations" title={title} description={padlocks ? "Plan the weekly walk. The assigned CSO prints the unit sheet, checks each door and sends the reconciled report for review." : "Open a scheduled worksheet for opening, closing, cleaning or management checks."} action={<div className="button-row"><Link className="button button-secondary" href="/operations">Operations centre</Link><Link className="button button-secondary" href={padlocks ? "/operations/checklists" : "/operations/padlocks"} onClick={event => { if (dirty && !window.confirm("Leave this sheet without saving your edits?")) event.preventDefault(); }}>{padlocks ? "Checklists" : "Padlock counts"}</Link></div>}/>
    <div className="button-row"><button className="button button-secondary" disabled={busy || reading} onClick={reload}>Reload saved records</button>{data?.managerFacilityIds.length ? <button className="button button-primary" disabled={disabled || dirty} onClick={() => { requestKey.current = crypto.randomUUID(); setPlan({ template: padlocks ? "PADLOCK" : "OPENING", facilityId: data.managerFacilityIds[0], assigneeId: "", coverId: "", reviewerId: "", date: southAfricaDateKey(new Date()), start: "08:00", end: "09:00", repeat: padlocks ? "WEEKLY" : "ONCE", occurrences: 1 }); }}>{planLabel}</button> : null}</div>
    {reading ? <p role="status">Loading saved records…</p> : null}{message ? <p role="alert">{message}</p> : null}
    {plan && <form aria-label={planLabel} className={`panel panel-spacious ${styles.planner}`} onSubmit={e => { e.preventDefault(); void mutate("POST", { facilityId: plan.facilityId, template: plan.template, assigneeId: plan.assigneeId, coverId: plan.coverId || null, reviewerId: plan.reviewerId, startAt: new Date(`${plan.date}T${plan.start}:00+02:00`).toISOString(), endAt: new Date(`${plan.date}T${plan.end}:00+02:00`).toISOString(), repeat: plan.repeat, occurrences: plan.occurrences, requestKey: requestKey.current }); }}>
      <h2>{planLabel}</h2>
      {padlocks && <p>Schedule the walkthrough and assign the CSO and a separate reviewer. Open the saved run to print the unit sheet and record results.</p>}
      <div className={styles.planGroups}>
        <fieldset disabled={disabled}>
          <legend>Store and schedule</legend>
          <div className={styles.scheduleGrid}>
            <label className={styles.planStore}>Store<select aria-label="Store" value={plan.facilityId} onChange={e => setPlan({ ...plan, facilityId: e.target.value, assigneeId: "", coverId: "", reviewerId: "" })}>{data?.facilities.filter(f => data.managerFacilityIds.includes(f.id)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            {!padlocks && <label className={styles.planStore}>Checklist<select aria-label="Checklist" value={plan.template} onChange={e => setPlan({ ...plan, template: e.target.value as ChecklistTemplate, repeat: "ONCE", occurrences: 1 })}>{Object.entries(checklistTemplates).filter(([key]) => key !== "PADLOCK").map(([key,t]) => <option key={key} value={key}>{t.name}</option>)}</select></label>}
            <label className={styles.planStore}>First date (SAST)<input required type="date" value={plan.date} onChange={e => setPlan({ ...plan, date: e.target.value })}/></label>
            <label>Start (SAST)<input required type="time" value={plan.start} onChange={e => setPlan({ ...plan, start: e.target.value })}/></label>
            <label>Due (SAST)<input required type="time" value={plan.end} onChange={e => setPlan({ ...plan, end: e.target.value })}/></label>
            <label>Repeat<select aria-label="Repeat" value={plan.repeat} onChange={e => setPlan({ ...plan, repeat: e.target.value as Plan["repeat"], occurrences: 1 })}><option value="ONCE">Once</option>{!padlocks && <option value="DAILY">Daily</option>}<option value="WEEKLY">Weekly</option></select></label>
            {plan.repeat !== "ONCE" && <label>{padlocks ? "Number of weekly runs" : "Total occurrences"}<input type="number" min="1" max="31" required value={plan.occurrences} onChange={e => setPlan({ ...plan, occurrences: Number(e.target.value) })}/></label>}
          </div>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>{padlocks ? "CSO and reviewer" : "Staff and reviewer"}</legend>
          {selectors(plan.facilityId,plan,v => setPlan({ ...plan,...v }))}
          {padlocks && <p>Assign the CSO doing the walk. Choose the General Manager or designated manager to assess the report.</p>}
        </fieldset>
      </div>
      <p>{plan.occurrences === 1 ? "Creates one scheduled run." : `Creates ${plan.occurrences} ${plan.repeat === "WEEKLY" ? "weekly" : "daily"} runs, then ends.`}{!padlocks && " Friday equipment tests and Sunday cleaning are included on their scheduled days."}</p>
      <div className="button-row"><button className="button button-primary" type="submit" disabled={disabled}>Create planned runs</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setPlan(null)}>Close planner</button></div>
    </form>}
    {task && record ? <section className="panel panel-spacious" aria-label={padlocks ? "Padlock count record" : "Checklist record"}>
      <div className="panel-heading"><div><h2>{task.title}</h2><p>{task.facility.name} · {runStatusLabels[task.status] ?? task.status} · Due {formatSouthAfricaDateTime(task.dueAt)} SAST</p></div><button className="text-button" disabled={busy || dirty} onClick={() => void read({ facilityId: facility,closed })}>Back to runs</button></div>
      <p>{padlocks ? "Counting CSO / staff" : "Responsible"}: {task.assignee?.name ?? "—"} · Cover: {task.cover?.name ?? "None"} · Reviewer: {staffName(record.reviewerId)}</p>
      {task.dueAt && new Date(task.dueAt) < new Date() && !["COMPLETED","CANCELLED"].includes(task.status) && <p role="status">Overdue — this run still needs completion or review.</p>}
      {record.sourceAt && <p>Inspection list captured {formatSouthAfricaDateTime(record.sourceAt)} SAST. {rows.length - pending}/{rows.length} checked · {issues.length} finding(s){record.template === "PADLOCK" ? ` · ${rows.reduce((n,r) => n + (r.lockCount ?? 0),0)} locks counted` : ""}.</p>}
      {padlocks && task.status !== "CANCELLED" && <ol className={styles.walkSteps} aria-label="Weekly padlock procedure">
        <li><h3>1. Print and walk</h3><p>Print the rent roll for all units in this store. Tick Vacant, Occupied or Overlocked at each door and note the locks you see.</p>{canPrintWalk && <a className="button button-secondary" href={`/api/v1/operations/checklists?id=${encodeURIComponent(task.id)}&print=walkthrough`} target="_blank" rel="noreferrer">Open printable rent roll</a>}</li>
        <li><h3>2. Compare collections</h3><p>After the walk, open the store’s calls list, print it and compare it with your ticks. Ask the reviewer for the list if you lack collections export access.</p><a className="button button-secondary" href={`/collections?facility=${encodeURIComponent(task.facilityId)}&mode=follow-up`} target="_blank" rel="noreferrer">Open collections calls list</a></li>
        <li><h3>3. Record and submit</h3><p>Transfer the results below, add a reason for each discrepancy, then submit the report to the assigned reviewer. Any physical overlock decision needs separate authorisation.</p>{task.status === "OPEN" && (preparer ? <button className="button button-primary" disabled={disabled} onClick={() => act("START")}>Start report entry</button> : <p role="status">Waiting for {task.assignee?.name ?? "the assigned CSO"} to start report entry.</p>)}</li>
      </ol>}
      {record.reviewNote && <p><strong>Reviewer feedback:</strong> {record.reviewNote}</p>}
      {!padlocks && preparer && task.status === "OPEN" && <button className="button button-primary" disabled={disabled} onClick={() => act("START")}>Start inspection</button>}
      {sheetDate && sheetRows.length > 0 && <>
        {rows.length > 0 && <div className={styles.sheetFilters}><label>Find item or unit<input value={search} onChange={e => setSearch(e.target.value)}/></label><label><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)}/> Show findings only</label></div>}
        <OperationalChecklistSheet
          rows={sheetRows.filter(row => visibleLabels.has(row.label))}
          week={week.map(day => ({ ...day, rows: day.rows.filter(row => visibleLabels.has(row.label)) }))}
          startAt={sheetDate} assignee={task.assignee?.name ?? null} template={record.template} editable={editable} canSwitch={!disabled}
          update={updateRow} openDay={id => { if (!dirty || window.confirm("Open the other day without saving your edits?")) { setSearch(""); setOnlyIssues(false); void read({ id }); } }} />
      </>}
      {rows.length > 0 && <>
      {record.template === "PADLOCK" && <label>Rent roll and collections comparison reference<textarea placeholder="Enter the dates or references of both printed lists." disabled={!editable} maxLength={1000} value={reference} onChange={e => { setReference(e.target.value); setDirty(true); }}/></label>}
      <label>Summary and escalation to reviewer<textarea disabled={!editable} maxLength={2000} value={summary} onChange={e => { setSummary(e.target.value); setDirty(true); }}/></label>
      {preparer && task.status === "IN_PROGRESS" && <div className="button-row"><button className="button button-secondary" disabled={disabled} onClick={() => act("SAVE")}>Save progress</button><button className="button button-primary" disabled={disabled || pending > 0} onClick={() => act("SUBMIT")}>Submit for manager review</button>{record.template === "PADLOCK" && <button className="text-button" disabled={disabled} onClick={() => { if (window.confirm("Restart with current units? All recorded results in this draft will be cleared; audit history is retained.")) act("RESTART"); }}>Restart with current units</button>}</div>}
      </>}
      {record.submittedAt && <p>Submitted by {staffName(record.submittedBy)} · {formatSouthAfricaDateTime(record.submittedAt)} SAST</p>}
      {task.status === "WAITING" && manager && (!padlocks || people(task.facilityId, true).some(person => person.id === data?.actorId)) && record.reviewerId === data?.actorId && record.submittedBy !== data?.actorId && <fieldset disabled={disabled}><legend>Manager review</legend><p>Confirm the findings, evidence and escalation. Sign-off records review; it does not resolve a fault or perform overlocking.</p><label>Review and action note<textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} minLength={5} maxLength={2000}/></label><div className="button-row"><button className="button button-primary" disabled={reviewNote.trim().length < 5} onClick={() => act("APPROVE")}>Sign off review</button><button className="button button-secondary" disabled={reviewNote.trim().length < 5} onClick={() => act("RETURN")}>Return for correction</button></div></fieldset>}
      {record.reviewedAt && <p>Reviewed by {staffName(record.reviewedBy)} · {formatSouthAfricaDateTime(record.reviewedAt)} SAST · {record.reviewNote}</p>}
      {manager && !["COMPLETED","CANCELLED"].includes(task.status) && <details><summary>Staff cover and administration</summary><fieldset disabled={disabled || dirty}>{selectors(task.facilityId,assignment,setAssignment)}<div className="button-row"><button className="button button-secondary" onClick={() => act("ASSIGN")}>Save staff assignments</button><button className="text-button" onClick={() => { if (window.confirm("Cancel this run? Saved results and audit history will be retained.")) act("CANCEL"); }}>Cancel run</button></div></fieldset></details>}
    </section> : <section className={`panel panel-spacious ${styles.queue}`} aria-label="Planned runs and history">
      <h2>Planned runs and history</h2>
      <div className={styles.queueFilters}>
        <label>Store filter<select aria-label="Store filter" disabled={busy || reading} value={facility} onChange={e => { setFacility(e.target.value); void read({ facilityId: e.target.value, closed }); }}>
          <option value="">All permitted stores</option>
          {data?.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <label>Run status<select aria-label="Run status" disabled={busy || reading} value={String(closed)} onChange={e => { setClosed(e.target.value === "true"); void read({ facilityId: facility, closed: e.target.value === "true" }); }}>
          <option value="false">Open and awaiting review</option>
          <option value="true">Signed off and cancelled history</option>
        </select></label>
      </div>
      {!reading && !blocked && !tasks.length && <p>No matching runs.</p>}
      {tasks.length > 0 && <ul className={styles.runList}>
        {tasks.map(t => {
          const overdue = t.dueAt && new Date(t.dueAt) < new Date() && !["COMPLETED", "CANCELLED"].includes(t.status);
          return <li className={`work-row ${styles.run}`} key={t.id}>
            <div className={styles.runDetails}>
              <strong>{t.title}</strong>
              <p>{t.facility.name} · {t.assignee?.name ?? "Unassigned"}</p>
            </div>
            <div className={styles.runTiming}>
              <div className={styles.runStatus}>
                <StatusPill tone={t.status === "COMPLETED" ? "positive" : "neutral"}>{runStatusLabels[t.status] ?? t.status}</StatusPill>
                {overdue && <StatusPill tone="warning">Overdue</StatusPill>}
              </div>
              <p>{t.dueAt ? <>Due <time dateTime={t.dueAt}>{formatSouthAfricaDateTime(t.dueAt)} SAST</time></> : "No due date"}</p>
            </div>
            <button className="button button-secondary" disabled={disabled} onClick={() => { setSearch(""); setOnlyIssues(false); void read({ id: t.id }); }}>Open record</button>
          </li>;
        })}
      </ul>}
      {data?.nextCursor && <button className="button button-secondary" disabled={disabled} onClick={() => void read({ facilityId: facility, closed, cursor: data.nextCursor! })}>Load more runs</button>}
    </section>}
  </div>;
}
