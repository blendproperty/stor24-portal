"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { historyReadSchema, noteCategories, type CustomerHistoryRead, type CustomerNoteInput } from "@/lib/customer-history-policy";

const stamp = (value: string) => new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " SAST";
type Filters = { kind: string; category: string; search: string };
const initialFilters: Filters = { kind: "ALL", category: "", search: "" };
export function CustomerHistory({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerHistoryRead | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [readBusy, setReadBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState<CustomerNoteInput | null>(null);
  const reader = useRef<AbortController | null>(null);
  const appliedFilters = useRef(initialFilters);
  const writer = useRef<AbortController | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteCategory, setNoteCategory] = useState<CustomerNoteInput["category"]>("GENERAL");
  const [noteStore, setNoteStore] = useState("");
  const load = useCallback(async (chosen: Filters, cursor?: string) => {
    reader.current?.abort();
    const controller = new AbortController(); reader.current = controller;
    setReadBusy(true); setReadError("");
    if (!cursor) { appliedFilters.current = chosen; setData(null); }
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const query = new URLSearchParams({ kind: chosen.kind, search: chosen.search });
      if (chosen.category) query.set("category", chosen.category);
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/v1/customers/${encodeURIComponent(customerId)}/history?${query}`, { cache: "no-store", signal: controller.signal });
      if (reader.current !== controller) return;
      if (response.status === 401 || response.status === 403) {
        setData(null);
        throw new Error(response.status === 401 ? "Sign in again to view customer history." : "Customer history is outside your current access.");
      }
      if (!response.ok) throw new Error("History could not be loaded. Retry to continue.");
      const payload = historyReadSchema.parse(await response.json()).data;
      if (reader.current !== controller || controller.signal.aborted) return;
      setData(previous => cursor && previous ? { ...payload, entries: [...previous.entries, ...payload.entries.filter(e => !previous.entries.some(p => p.id === e.id && p.kind === e.kind))] } : payload);
    } catch (error) {
      if (reader.current === controller) setReadError(error instanceof Error && !(error.name === "ZodError" || error.name === "AbortError") ? error.message : "History could not be loaded. Retry to continue.");
    } finally {
      clearTimeout(timer);
      if (reader.current === controller) { reader.current = null; setReadBusy(false); }
    }
  }, [customerId]);
  useEffect(() => {
    const timer = setTimeout(() => void load(initialFilters), 0);
    return () => { clearTimeout(timer); reader.current?.abort(); reader.current = null; writer.current?.abort(); writer.current = null; };
  }, [load]);

  async function save(input: CustomerNoteInput) {
    if (writer.current) return;
    const controller = new AbortController(); writer.current = controller;
    setSaving(true); setWriteError(""); setNotice("");
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`/api/v1/customers/${encodeURIComponent(customerId)}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
      if (writer.current !== controller) return;
      if (response.status === 401 || response.status === 403 || response.status === 422 || response.status === 409) {
        setRetry(null);
        throw new Error(response.status === 401 ? "Sign in again before saving a note." : response.status === 403 ? "You cannot add notes for this customer and store." : response.status === 409 ? "This save conflicts with an existing note. Refresh the history and review it before saving again." : "Choose a store and category and enter a note of up to 5,000 characters.");
      }
      if (!response.ok) throw new Error("NOTE_SAVE_UNCERTAIN");
      const result = await response.json();
      if (writer.current !== controller) return;
      if (typeof result?.data?.id !== "string" || !result.data.id || !Number.isFinite(Date.parse(result?.data?.createdAt))) throw new Error("NOTE_SAVE_UNCERTAIN");
      setRetry(null); setNoteBody(""); setNoteCategory("GENERAL"); setNoteStore(""); setNotice("Note saved. It is now shared with staff who have access to this store.");
      // A saved note should be visible even when the previous filter excluded it.
      setFilters(initialFilters); await load(initialFilters);
    } catch (error) {
      if (writer.current !== controller) return;
      const known = error instanceof Error && error.message !== "NOTE_SAVE_UNCERTAIN" && error.name !== "AbortError" && error.name !== "SyntaxError" && error.name !== "TypeError";
      if (known) setWriteError(error.message);
      else { setRetry(input); setWriteError("We could not confirm the save. Retry the same note safely; its reference prevents a duplicate. Keep these details until the result is confirmed."); }
    } finally { clearTimeout(timer); if (writer.current === controller) { writer.current = null; setSaving(false); } }
  }
  return <section className="customer-history" aria-labelledby="customer-history-title">
    <div className="customer-history-heading"><div><p className="eyebrow">SHARED CUSTOMER RECORD</p><h3 id="customer-history-title">Customer history &amp; staff notes</h3><p>Newest first · South African time · visible to staff with store access.</p></div><button type="button" className="button button-secondary" onClick={() => void load(filters)} disabled={readBusy}>Refresh history</button></div>
    <form className="customer-history-filters" onSubmit={event => { event.preventDefault(); void load(filters); }}>
      <label>History type<select value={filters.kind} onChange={event => setFilters({ ...filters, kind: event.target.value })}><option value="ALL">All history</option><option value="NOTE">Staff notes</option><option value="COLLECTION">Collections activity</option><option value="COMMUNICATION">Communications</option></select></label>
      <label>Note category<select aria-label="Note category" value={filters.category} onChange={event => setFilters({ ...filters, category: event.target.value })}><option value="">All categories</option>{Object.entries(noteCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Search history<input type="search" maxLength={200} value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} placeholder="Note text, message type or channel"/></label>
      <button className="button button-secondary" disabled={readBusy}>Apply filters</button>
    </form>
    {notice ? <p role="status" className="notice">{notice}</p> : null}
    {writeError ? <p role="alert" className="form-error">{writeError}</p> : null}
    {data?.writableFacilities.length ? <form className="customer-note-form" onSubmit={event => {
      event.preventDefault();
      if (retry) { void save(retry); return; }
      const values = new FormData(event.currentTarget);
      void save({ facilityId: String(values.get("facilityId")), category: String(values.get("category")) as CustomerNoteInput["category"], body: String(values.get("body")).trim(), requestKey: crypto.randomUUID() });
    }}>
      <fieldset disabled={saving || !!retry}><legend>Add a dated staff note</legend>
        <label>Note store<select name="facilityId" aria-label="Note store" value={noteStore || data.writableFacilities[0].id} onChange={event => setNoteStore(event.target.value)} required>{data.writableFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>New note category<select name="category" aria-label="New note category" value={noteCategory} onChange={event => setNoteCategory(event.target.value as CustomerNoteInput["category"])}>{Object.entries(noteCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="customer-note-body">Staff note<textarea name="body" aria-label="Staff note" value={noteBody} onChange={event => setNoteBody(event.target.value)} rows={4} maxLength={5000} required placeholder="Record the interaction, agreed action and any details covering staff need."/></label>
      </fieldset>
      <p className="leads-caption">Saved notes retain their author and time. Add a correction as a new note. Recording a payment follow-up does not approve a financial change or schedule a reminder.</p>
      <button className="button button-primary" disabled={saving}>{saving ? "Saving note…" : retry ? "Retry same note" : "Save staff note"}</button>
    </form> : data ? <p className="leads-caption">Your current role can read this history. Adding a note requires customer management access for the store.</p> : null}
    {readBusy ? <p role="status">Loading customer history…</p> : null}
    {readError ? <div role="alert" className="form-error"><p>{readError}</p><button type="button" className="button button-secondary" disabled={readBusy} onClick={() => void load(appliedFilters.current, data?.nextCursor ?? undefined)}>Retry history</button></div> : null}
    {data ? <>
      {!data.visibility.communications || !data.visibility.collections ? <p className="leads-caption">Some history is restricted: {!data.visibility.communications ? "communications access" : ""}{!data.visibility.communications && !data.visibility.collections ? " and " : ""}{!data.visibility.collections ? "collections access" : ""} is required.</p> : null}
      <p className="leads-caption">Communications show recorded send and delivery evidence. Complete message text and external conversation transcripts may not be stored.</p>
      <ol className="customer-timeline">{data.entries.map(item => <li key={item.kind + item.id}>
        <div className="customer-timeline-meta"><time dateTime={item.at}>{stamp(item.at)}</time><span>{item.facility ?? "Store not recorded"}</span><span>{item.author ?? (item.kind === "COMMUNICATION" ? "System communication" : "Author not recorded")}</span></div>
        <h4>{item.title}</h4>{item.body ? <p className="customer-timeline-body">{item.body}</p> : null}
        {item.status ? <p className="customer-timeline-delivery"><strong>Recorded status: {item.status.replaceAll("_", " ")}</strong>{item.sentAt ? <span>Sent {stamp(item.sentAt)}</span> : null}{item.deliveredAt ? <span>Delivered {stamp(item.deliveredAt)}</span> : null}{item.readAt ? <span>Read {stamp(item.readAt)}</span> : null}</p> : null}
      </li>)}</ol>
      {!data.entries.length && !readBusy ? <p>No recorded history matches these filters.</p> : null}
      {data.nextCursor ? <button type="button" className="button button-secondary" disabled={readBusy} onClick={() => void load(appliedFilters.current, data.nextCursor!)}>Load older history</button> : null}
      {data.legacyNotes ? <section className="customer-notes"><h4>Existing profile notes</h4><p>{data.legacyNotes}</p><p className="leads-caption">Earlier summary text is preserved. Its original author and note date were not recorded.</p></section> : null}
    </> : null}
  </section>;
}
