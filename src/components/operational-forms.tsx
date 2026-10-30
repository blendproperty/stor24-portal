"use client";

import { useCallback,useEffect,useRef,useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { z } from "zod";
import { PageHeader } from "./page-header";
import { formRecordSchema,formTemplate,operationalFormTemplates,type OperationalFormKind,type OperationalFormRecord } from "@/lib/operational-form-policy";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import styles from "./operational-forms.module.css";

const summary = z.object({ id: z.string(),title: z.string(),facilityId: z.string(),createdById: z.string().nullable(),status: z.string(),updatedAt: z.string(),createdAt: z.string(),facility: z.object({ name: z.string() }),assignee: z.object({ name: z.string() }).nullable() });
const pageSchema = z.object({ actorId: z.string(),facilities: z.array(z.object({ id: z.string(),name: z.string() })),managerFacilityIds: z.array(z.string()),reviewers: z.array(z.object({ id: z.string(),name: z.string(),facilityIds: z.array(z.string()) })),tasks: z.array(summary).optional(),nextCursor: z.string().nullable().optional(),task: summary.extend({ operationalForm: formRecordSchema }).optional() });
type PageData = z.infer<typeof pageSchema>;
type Detail = NonNullable<PageData["task"]>;
export function OperationalForms() {
  const [data,setData] = useState<PageData|null>(null),[tasks,setTasks] = useState<z.infer<typeof summary>[]>([]),[task,setTask] = useState<Detail|null>(null);
  const [kind,setKind] = useState<OperationalFormKind>("MAINTENANCE"),[facility,setFacility] = useState(""),[closed,setClosed] = useState(false);
  const [record,setRecord] = useState<OperationalFormRecord|null>(null),[note,setNote] = useState(""),[message,setMessage] = useState(""),[blocked,setBlocked] = useState(true),[busy,setBusy] = useState(false),[reading,setReading] = useState(false),[dirty,setDirty] = useState(false);
  const reader = useRef<AbortController|null>(null),writing = useRef(false),key = useRef("");
  const read = useCallback(async (query: { id?: string;facilityId?: string;closed?: boolean;cursor?: string } = {}) => {
    reader.current?.abort();const controller = new AbortController();reader.current = controller;setReading(true);setBlocked(true);
    const timer = setTimeout(() => controller.abort(),20000);
    try {
      const params = new URLSearchParams(Object.entries(query).filter(([,v]) => v !== undefined && v !== "").map(([k,v]) => [k,String(v)]));
      const response = await fetch(`/api/v1/operations/forms?${params}`,{ cache: "no-store",signal: controller.signal });
      if (reader.current !== controller) return;
      if ([401,403].includes(response.status)) { setData(null);setTasks([]);setTask(null);setRecord(null);throw Error("Sign in again or ask your administrator to check your current access."); }
      const payload = await response.json();if (!response.ok) throw Error(payload.error?.message ?? "Could not read forms.");
      const next = pageSchema.parse(payload.data);if (reader.current !== controller) return;
      key.current = "";setData(next);if (next.tasks) setTasks(previous => query.cursor ? [...previous,...next.tasks!] : next.tasks!);
      setTask(next.task ?? null);setRecord(next.task?.operationalForm ?? null);setNote("");setDirty(false);setBlocked(false);setMessage("");
    } catch (e) { if (reader.current === controller) setMessage(e instanceof Error ? e.message : "Read failed. Reload before acting."); }
    finally { clearTimeout(timer);if (reader.current === controller) { reader.current = null;setReading(false); } }
  },[]);
  useEffect(() => { let cancelled = false;const id = new URLSearchParams(location.search).get("id");void Promise.resolve().then(() => { if (!cancelled) void read(id ? { id } : {}); });return () => { cancelled = true;reader.current?.abort();reader.current = null; }; },[read]);
  function navigate(query: Parameters<typeof read>[0]) { if (!dirty || window.confirm("Discard unsaved edits and read the saved form?")) void read(query); }
  async function mutate(method: "POST"|"PATCH",body: unknown) {
    if (writing.current || blocked || reading) return;
    writing.current = true;setBusy(true);setMessage("");
    try {
      const response = await fetch("/api/v1/operations/forms",{ method,headers: { "Content-Type": "application/json" },body: JSON.stringify(body),signal: AbortSignal.timeout(30000) });
      if ([401,403].includes(response.status)) { setData(null);setTasks([]);setTask(null);setRecord(null);setBlocked(true);throw Error("Your current access does not allow this action. Reload before acting."); }
      const payload = await response.json();
      if (!response.ok) { if (response.status === 409 || response.status >= 500) setBlocked(true);throw Error(payload.error?.message ?? "Could not save. Reload before acting."); }
      if (!payload.data?.id) throw Error("Unconfirmed response");
      if (method === "POST") key.current = "";
      setDirty(false);await read({ id: payload.data.id });
    } catch (e) {
      const text = e instanceof Error ? e.message : "Unconfirmed response";
      if (/fetch|network|timeout|abort|JSON|Unconfirmed/i.test(text)) { setBlocked(true);setMessage("The save could not be confirmed. Reload saved forms before trying again."); }
      else setMessage(text);
    } finally { writing.current = false;setBusy(false); }
  }
  async function photos(files: FileList|null) {
    if (!record || !files) return;setBusy(true);
    try {
      if (record.photos.length+files.length > 3) throw Error("Use no more than three photos.");
      const added: OperationalFormRecord["photos"] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/") || file.size > 10000000) throw Error("Choose an image under 10 MB.");
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width*bitmap.height > 10000000) throw Error("Choose a photo with no more than 10 million pixels.");
          const scale = Math.min(1,1400/bitmap.width,1400/bitmap.height),canvas = document.createElement("canvas");canvas.width = Math.round(bitmap.width*scale);canvas.height = Math.round(bitmap.height*scale);
          const context = canvas.getContext("2d");if (!context) throw Error("Could not prepare the photo.");context.drawImage(bitmap,0,0,canvas.width,canvas.height);
          const image = canvas.toDataURL("image/jpeg",0.7);if (image.length > 400000) throw Error("Photo is too detailed. Use a smaller photo.");
          added.push({ name: file.name.slice(0,100),data: image });
        } finally { bitmap.close(); }
      }
      setRecord({ ...record,photos: [...record.photos,...added] });setDirty(true);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not prepare photos."); }
    finally { setBusy(false); }
  }
  const disabled = busy || reading || blocked,template = formTemplate(record?.kind ?? kind),manager = !!data?.managerFacilityIds.includes(task?.facilityId ?? facility);
  const editable = !!task && task.createdById === data?.actorId && ["OPEN","IN_PROGRESS"].includes(task.status),reviewer = !!task && task.status === "WAITING" && record?.reviewerId === data?.actorId && manager;
  const change = (field: string,value: string) => { if (record) { setRecord({ ...record,values: { ...record.values,[field]: value } });setDirty(true); } };
  function action(action: "SAVE"|"SUBMIT"|"REVIEW"|"RETURN"|"CANCEL") {
    if (!task || !record) return;
    void mutate("PATCH",{ id: task.id,expectedUpdatedAt: task.updatedAt,action,...(["SAVE","SUBMIT"].includes(action) ? { values: record.values,photos: record.photos,reviewerId: record.reviewerId } : { note }) });
  }
  return <>
    <PageHeader eyebrow="Facility workflows" title="Operational forms" description="Record maintenance findings, track certificates and prepare documents for review." action={<Link href="/operations/checklists" className="button button-secondary">Checklists &amp; padlocks</Link>} />
    <div className={styles.toolbar}><button className="button button-secondary" disabled={busy || reading} onClick={() => navigate(task ? { id: task.id } : { facilityId: facility,closed })}>Reload saved forms</button><Link href="/operations">Operations centre</Link></div>
    {message ? <p role="alert">{message}</p> : null}{reading ? <p role="status">Loading saved forms…</p> : null}
    {!task ? <>
      <section className={styles.panel} aria-label="Choose operational form">
        <h2>Choose a form</h2><div className={styles.grid}>
          <label>Store<select value={facility} disabled={disabled} onChange={e => setFacility(e.target.value)}><option value="">Choose a store</option>{data?.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>Form<select value={kind} disabled={disabled} onChange={e => setKind(e.target.value as OperationalFormKind)}>{Object.entries(operationalFormTemplates).map(([k,v]) => <option key={k} value={k}>{v.name}</option>)}</select></label>
        </div><p>Source: {template.source}</p>
        {template.hold ? <p className={styles.hold}>{template.hold}</p> : <p>Save a draft, submit it to a separate manager, then retain the reviewed record. A reviewed report does not certify repairs or authorise spending.</p>}
        <details><summary>View form fields</summary><ul>{template.fields.map(f => <li key={f.key}>{f.label}{f.required ? " (required for review)" : ""}</li>)}</ul></details>
        {template.workflow ? <p><Link href={template.workflow}>Open the existing workflow</Link></p> : null}
        <button className="button button-primary" disabled={disabled || !facility || template.captureHeld || (kind !== "MAINTENANCE" && !manager)} onClick={() => { if (dirty && !window.confirm("Discard unsaved edits?")) return;key.current ||= crypto.randomUUID();void mutate("POST",{ facilityId: facility,kind,requestKey: key.current }); }}>{template.captureHeld ? "Capture awaiting agreed rules" : "Create draft"}</button>
      </section>
      <section className={styles.panel} aria-label="Saved operational forms"><h2>Saved forms</h2><div className={styles.toolbar}><button className="button button-secondary" disabled={disabled} onClick={() => navigate({ facilityId: facility,closed })}>Apply store filter</button><label><input type="checkbox" checked={closed} disabled={disabled} onChange={e => { setClosed(e.target.checked);navigate({ facilityId: facility,closed: e.target.checked }); }} /> Closed history</label></div>
        {!tasks.length && !reading ? <p>No saved forms in this view.</p> : null}
        {tasks.map(t => <article className={styles.row} key={t.id}><div><strong>{t.title}</strong><p>{t.facility.name} · {t.assignee?.name ?? "Unassigned"} · {t.status.replaceAll("_"," ")} · {formatSouthAfricaDateTime(t.createdAt)}</p></div><button className="button button-secondary" disabled={disabled} onClick={() => navigate({ id: t.id })}>Open form</button></article>)}
        {data?.nextCursor ? <button className="button button-secondary" disabled={disabled} onClick={() => void read({ facilityId: facility,closed,cursor: data.nextCursor! })}>Load more</button> : null}
      </section>
    </> : record ? <section className={styles.panel} aria-label="Operational form record">
      <button className="button button-secondary" disabled={busy || reading} onClick={() => navigate({ facilityId: facility,closed })}>Back to saved forms</button><h2>{template.name}</h2><p>{task.facility.name} · {task.status === "COMPLETED" ? "Reviewed record" : task.status.replaceAll("_"," ")} · Prepared by {task.assignee?.name}</p>
      {template.hold ? <p className={styles.hold}>{template.hold} This is an internal draft.</p> : null}{template.workflow ? <p><Link href={template.workflow}>Open the existing workflow</Link> · Plan any agreed follow-up separately.</p> : null}
      <fieldset disabled={disabled || !editable} className={styles.fields}><legend>Form details</legend><div className={styles.grid}>{template.fields.map(f => <label key={f.key} className={f.type === "multiline" ? styles.wide : ""}>{f.label}{f.required ? " *" : ""}{f.type === "multiline" ? <textarea rows={4} maxLength={4000} value={record.values[f.key] ?? ""} onChange={e => change(f.key,e.target.value)} /> : <input type={f.type === "date" || f.type === "time" ? f.type : "text"} inputMode={f.type === "money" ? "decimal" : undefined} maxLength={4000} value={record.values[f.key] ?? ""} onChange={e => change(f.key,e.target.value)} />}</label>)}</div>
      { ["MAINTENANCE","CERTIFICATE","ADJUDICATION"].includes(record.kind) ? <label>Photographic evidence (up to 3)<input type="file" accept="image/*" multiple onChange={e => { void photos(e.target.files);e.target.value = ""; }} /><small>Use site/equipment photographs without people, identity documents or banking details.</small></label> : null}
      <label>Separate manager reviewer<select value={record.reviewerId ?? ""} onChange={e => { setRecord({ ...record,reviewerId: e.target.value || null });setDirty(true); }}><option value="">Choose a reviewer</option>{record.reviewerId && !data?.reviewers.some(r => r.id === record.reviewerId && r.facilityIds.includes(task.facilityId)) ? <option value={record.reviewerId} disabled>{record.reviewerId === data?.actorId ? "You (assigned reviewer)" : "Assigned reviewer - check current access"}</option> : null}{data?.reviewers.filter(r => r.facilityIds.includes(task.facilityId)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label></fieldset>
      <div className={styles.photos}>{record.photos.map((p,i) => <figure key={i}><Image src={p.data} alt={p.name} width={800} height={600} unoptimized /><figcaption>{p.name}</figcaption>{editable ? <button className="button button-secondary" disabled={disabled} onClick={() => { setRecord({ ...record,photos: record.photos.filter((_,index) => index !== i) });setDirty(true); }}>Remove photo {i+1}</button> : null}</figure>)}</div>
      {editable ? <div className={styles.toolbar}><button className="button button-primary" disabled={disabled} onClick={() => action("SAVE")}>Save draft</button><button className="button button-secondary" disabled={disabled || !!template.hold} onClick={() => action("SUBMIT")}>Submit for review</button></div> : null}
      {record.reviewNote ? <p>Manager note: {record.reviewNote}</p> : null}{record.reviewedAt ? <p>Review recorded {formatSouthAfricaDateTime(record.reviewedAt)}. This does not authorise payment or certify physical completion.</p> : null}
      {manager && !["COMPLETED","CANCELLED"].includes(task.status) ? <><label>Review / cancellation note<textarea rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label><div className={styles.toolbar}>{reviewer ? <><button className="button button-primary" disabled={disabled || note.trim().length < 5 || !!template.hold} onClick={() => action("REVIEW")}>Record manager review</button><button className="button button-secondary" disabled={disabled || note.trim().length < 5} onClick={() => action("RETURN")}>Return for correction</button></> : null}<button className="button button-secondary" disabled={disabled || note.trim().length < 5} onClick={() => action("CANCEL")}>Cancel record</button></div></> : null}
    </section> : null}
  </>;
}
