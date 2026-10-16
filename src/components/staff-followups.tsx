"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { AppointmentTitleField } from "@/components/appointment-title-field";
import { PageHeader } from "@/components/page-header";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import { followupSastInput, followupSastValue, staffFollowupViewSchema, type StaffFollowupView } from "@/lib/staff-followup-policy";

const person = z.object({ id: z.string(), firstName: z.string().nullable(), lastName: z.string().nullable(), companyName: z.string().nullable() });
const staff = z.object({ id: z.string(), name: z.string() });
const responseSchema = z.object({ data: z.object({
  userId: z.string(), nextCursor: z.string().nullable(), canManage: z.boolean(),
  tasks: z.array(z.object({ id: z.string(), title: z.string(), description: z.string().nullable(), status: z.enum(["OPEN", "WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]), dueAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime(), coverAcknowledgedAt: z.iso.datetime().nullable(), facility: z.object({ id: z.string(), name: z.string() }), customer: person.nullable(), assignee: staff.nullable(), cover: staff.nullable() })),
  facilities: z.array(z.object({ id: z.string(), name: z.string() })), customers: z.array(person), staff: z.array(staff.extend({ facilityIds: z.array(z.string()) })),
}) });
type Data = z.infer<typeof responseSchema>["data"];
const nameOf = (p: z.infer<typeof person>) => p.companyName || [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unnamed customer";

export function StaffFollowups() {
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<StaffFollowupView>("all");
  const viewRef = useRef<StaffFollowupView>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [validation, setValidation] = useState("");
  const [search, setSearch] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const reader = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const requestKey = useRef<string | null>(null);
  const load = useCallback(async (query: string, cursor?: string) => {
    reader.current?.abort();
    const controller = new AbortController(); reader.current = controller; setLoading(true); setError("");
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/v1/operations/followups?view=${viewRef.current}&search=${encodeURIComponent(query)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (reader.current !== controller) return;
      if (response.status === 401 || response.status === 403) { setData(null); throw new Error(response.status === 401 ? "Sign in again to view follow-ups." : "You do not have access to follow-ups."); }
      if (!response.ok) throw new Error("Follow-ups could not be loaded. Retry before making changes.");
      const loaded = responseSchema.parse(await response.json()).data;
      if (reader.current !== controller) return;
      setData(current => cursor && current ? { ...loaded, tasks: [...current.tasks, ...loaded.tasks.filter(t => !current.tasks.some(previous => previous.id === t.id))] } : loaded); setUncertain(false); setFacilityId(current => loaded.facilities.some(f => f.id === current) ? current : loaded.facilities[0]?.id ?? "");
    } catch (e) { if (reader.current === controller) setError(e instanceof Error && !e.message.startsWith("[") ? e.message : "Follow-ups could not be loaded. Retry before making changes."); }
    finally { clearTimeout(timer); if (reader.current === controller) { setLoading(false); reader.current = null; } }
  }, []);
  useEffect(() => { const initial = staffFollowupViewSchema.safeParse(new URLSearchParams(window.location.search).get("view") ?? "all"); viewRef.current = initial.success ? initial.data : "all"; const timer = setTimeout(() => { setView(viewRef.current); void load(""); }, 0); return () => { clearTimeout(timer); reader.current?.abort(); }; }, [load]);

  async function mutate(url: string, method: string, body: unknown, onSaved?: () => void) {
    if (writing.current || uncertain || loading) return;
    writing.current = true; setSaving(true); setError(""); setNotice("");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { method, signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
        if ([401, 403].includes(response.status)) setData(null);
        setError(response.status === 409 ? "This follow-up changed. Reload its current status before trying again." : "The change was not saved. Check the customer, store, staff access and required fields."); return;
      }
      const result = await response.json();
      if (!response.ok || typeof result.data?.id !== "string") throw new Error("UNCONFIRMED");
      onSaved?.(); setNotice("Follow-up saved. Assigned staff and cover can view it.");
      await load(search);
    } catch { setUncertain(true); setError("We could not confirm the change. Reload and check the saved follow-up before retrying. Keep the same details to retry a new appointment safely."); }
    finally { clearTimeout(timer); writing.current = false; setSaving(false); }
  }

  function appointmentDate(value: FormDataEntryValue | null) {
    try { const result = followupSastInput(String(value)); setValidation(""); return result; }
    catch { setValidation("Choose a valid South African date and time."); return null; }
  }

  const disabled = loading || saving || uncertain || !!error;
  return <div className="page-stack staff-followup-workspace">
    <PageHeader eyebrow="Operations centre" title="Follow-ups & handovers" description="Agreed appointments, named responsibility and cover acknowledgement. All dates and times are South African time." action={<Link href="/operations" className="button button-secondary">Operations centre</Link>}/>
    <section className="panel panel-spacious">
      <div className="followup-toolbar"><div><h2>Customer appointments</h2><p>A payment promise still holds debt-chasing calls. Record a separate appointment only when the customer agreed to it.</p></div><div className="followup-actions"><button className="button button-secondary" disabled={loading || saving} onClick={() => void load(search)}>{loading ? "Loading…" : "Reload follow-ups"}</button>{data?.canManage ? <button className="button button-primary" aria-expanded={composerOpen} onClick={() => setComposerOpen(!composerOpen)}>{composerOpen ? "Close appointment form" : "Schedule follow-up"}</button> : null}</div></div>
      {validation ? <p role="alert">{validation}</p> : null}
      {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
      {!data && !error ? <p role="status">Loading follow-ups…</p> : null}
      {data ? <div className={`followup-layout${composerOpen && data.canManage ? "" : " followup-list-only"}`}>
        <div>
          <label>Appointment queue<select aria-label="Appointment queue" value={view} disabled={loading || saving} onChange={e => { const selected = staffFollowupViewSchema.parse(e.target.value); viewRef.current = selected; setView(selected); setEditing(null); const url = new URL(window.location.href); url.searchParams.set("view", selected); window.history.replaceState(null, "", url); void load(search); }}><option value="all">All open appointments</option><option value="due">Due today &amp; overdue</option><option value="upcoming">From tomorrow</option></select></label>
          <h3>{view === "due" ? "Due today & overdue" : view === "upcoming" ? "Upcoming appointments" : "Open appointments"}</h3>
          {data.tasks.length ? data.tasks.map(task => <article className="followup-card" key={task.id}>
            <div className="followup-toolbar"><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")}</span></div>
            <p>{task.dueAt ? formatSouthAfricaDateTime(task.dueAt) : "No date recorded"} · {task.facility.name}</p>
            {task.customer ? <Link href={`/tenants?customer=${encodeURIComponent(task.customer.id)}`}>{nameOf(task.customer)} · Customer history</Link> : null}
            <p className="followup-description">{task.description}</p>
            <p>Responsible: {task.assignee?.name ?? "Unassigned"}<br/>Cover: {task.cover?.name ?? "Not assigned"} · {task.coverAcknowledgedAt ? `Acknowledged ${formatSouthAfricaDateTime(task.coverAcknowledgedAt)}` : "Awaiting acknowledgement"}</p>
            <div className="followup-actions">
              {task.cover?.id === data.userId && !task.coverAcknowledgedAt ? <button disabled={disabled} className="button button-secondary" onClick={() => void mutate(`/api/v1/operations/followups/${task.id}`, "PATCH", { action: "ACKNOWLEDGE", expectedUpdatedAt: task.updatedAt })}>Acknowledge cover</button> : null}
              {data.canManage ? <><button disabled={disabled} className="button button-secondary" onClick={() => { setEditing(editing === task.id ? null : task.id); setValidation(""); }}>Edit appointment</button><button disabled={disabled} className="button button-secondary" onClick={() => void mutate(`/api/v1/operations/followups/${task.id}`, "PATCH", { action: "COMPLETE", expectedUpdatedAt: task.updatedAt })}>Complete</button><button disabled={disabled} className="button button-secondary" onClick={() => void mutate(`/api/v1/operations/followups/${task.id}`, "PATCH", { action: "CANCEL", expectedUpdatedAt: task.updatedAt })}>Cancel</button>
              <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void mutate(`/api/v1/operations/followups/${task.id}`, "PATCH", { action: "HANDOVER", coverId: form.get("coverId") || null, expectedUpdatedAt: task.updatedAt }); }}><label>Cover for {task.title}<select name="coverId" defaultValue={task.cover?.id ?? ""} disabled={disabled}><option value="">No cover</option>{data.staff.filter(s => s.facilityIds.includes(task.facility.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button disabled={disabled} className="button button-secondary">Update cover</button></form></> : null}
            </div>
            {data.canManage && editing === task.id ? <form aria-label={`Edit ${task.title}`} key={`${task.id}-${task.updatedAt}`} onSubmit={e => { e.preventDefault(); const fields = new FormData(e.currentTarget); const dueAt = appointmentDate(fields.get("dueAt")); if (!dueAt) return; void mutate(`/api/v1/operations/followups/${task.id}`, "PATCH", { action: "UPDATE", expectedUpdatedAt: task.updatedAt, title: fields.get("title"), description: fields.get("description"), dueAt, assigneeId: fields.get("assigneeId"), coverId: fields.get("coverId") || null }, () => setEditing(null)); }}>
              <AppointmentTitleField initialTitle={task.title} disabled={disabled}/>
              <label>Agreed action and handover details<textarea name="description" defaultValue={task.description ?? ""} minLength={2} maxLength={4000} required disabled={disabled}/></label>
              <label>Agreed date and time (SAST)<input name="dueAt" type="datetime-local" defaultValue={task.dueAt ? followupSastValue(task.dueAt) : ""} required disabled={disabled}/></label>
              <label>Responsible staff<select name="assigneeId" defaultValue={task.assignee?.id ?? ""} required disabled={disabled}><option value="">Choose responsible staff</option>{data.staff.filter(s => s.facilityIds.includes(task.facility.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label>Covering staff<select name="coverId" defaultValue={task.cover?.id ?? ""} disabled={disabled}><option value="">No cover assigned</option>{data.staff.filter(s => s.facilityIds.includes(task.facility.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <button className="button button-primary" disabled={disabled}>Save appointment changes</button>
            </form> : null}
          </article>) : <p>No open agreed appointments.</p>}
          {data.nextCursor ? <button className="button button-secondary" disabled={loading || saving} onClick={() => void load(search, data.nextCursor!)}>Load more appointments</button> : null}
        </div>
        {data.canManage && composerOpen ? <aside className="followup-composer"><h3>Schedule an agreed follow-up</h3>
          <form onSubmit={e => { e.preventDefault(); setCustomerId(""); void load(search); }}><label>Find customer by name<input value={search} onChange={e => setSearch(e.target.value)} minLength={2} maxLength={100} required/></label><button className="button button-secondary" disabled={loading || saving}>Search customers</button></form>
          <form onSubmit={e => { e.preventDefault(); const form = e.currentTarget, fields = new FormData(form); const dueAt = appointmentDate(fields.get("dueAt")); if (!dueAt) return; requestKey.current ??= crypto.randomUUID(); void mutate("/api/v1/operations/followups", "POST", { requestKey: requestKey.current, facilityId, customerId, assigneeId: fields.get("assigneeId"), coverId: fields.get("coverId") || null, title: fields.get("title"), description: fields.get("description"), dueAt }, () => { requestKey.current = null; form.reset(); setCustomerId(""); setComposerOpen(false); }); }}>
            <label>Customer<select aria-label="Customer" value={customerId} onChange={e => setCustomerId(e.target.value)} required disabled={disabled}><option value="">Search and choose a customer</option>{data.customers.map(c => <option value={c.id} key={c.id}>{nameOf(c)}</option>)}</select></label>
            <label>Store<select aria-label="Store" value={facilityId} onChange={e => setFacilityId(e.target.value)} required disabled={disabled}>{data.facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label>Responsible staff<select aria-label="Responsible staff" name="assigneeId" key={`assignee-${facilityId}`} required disabled={disabled}><option value="">Choose responsible staff</option>{data.staff.filter(s => s.facilityIds.includes(facilityId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Covering staff<select aria-label="Covering staff" name="coverId" key={`cover-${facilityId}`} disabled={disabled}><option value="">No cover assigned</option>{data.staff.filter(s => s.facilityIds.includes(facilityId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Agreed date and time (SAST)<input name="dueAt" type="datetime-local" required disabled={disabled}/></label>
            <AppointmentTitleField disabled={disabled}/>
            <label>Agreed action and handover details<textarea name="description" minLength={2} maxLength={4000} rows={4} required disabled={disabled}/></label>
            <button className="button button-primary" disabled={disabled || !customerId}>{saving ? "Saving…" : "Save agreed appointment"}</button>
          </form>
        </aside> : null}
      </div> : null}
    </section>
  </div>;
}
