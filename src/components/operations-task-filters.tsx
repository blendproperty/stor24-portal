"use client";

import { useState } from "react";
import { operationsTaskFiltersSchema, type OperationsTaskFilters, type OperationsTaskPage } from "@/lib/operations-task-policy";

export function OperationsTaskFilters({ page, disabled, onApply }: { page: OperationsTaskPage; disabled: boolean; onApply: (filters: OperationsTaskFilters) => void }) {
  const [draft, setDraft] = useState(page.filters), [error, setError] = useState("");
  function change(key: keyof OperationsTaskFilters, value: string) {
    setDraft(previous => ({ ...previous, [key]: value, ...(key === "assignee" && value !== "search" ? { person: "" } : {}) }));
    setError("");
  }
  const selectedMissing = !["all", "mine", "unassigned", "search"].includes(draft.assignee) && !page.assignees.some(person => person.id === draft.assignee);
  return <form className="operations-task-filters" aria-label="Filter operational tasks" onSubmit={event => {
    event.preventDefault(); const parsed = operationsTaskFiltersSchema.safeParse(draft);
    if (!parsed.success) { setError("Filters were not applied. Check the assigned person and search text."); return; }
    setError(""); onApply(parsed.data);
  }}>
    <label>Assigned person<select aria-label="Assigned person" value={draft.assignee} disabled={disabled} onChange={event => change("assignee", event.target.value)}>
      <option value="all">All staff</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option>
      {page.assignees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      {selectedMissing ? <option value={draft.assignee}>Selected assigned person</option> : null}
      <option value="search">Find another staff member…</option>
    </select></label>
    <label>Store<select aria-label="Task store" value={draft.facility} disabled={disabled} onChange={event => change("facility", event.target.value)}><option value="all">All permitted stores</option>{page.unrestrictedFacilities ? <option value="portfolio">Portfolio tasks</option> : null}{page.facilities.map(facility => <option value={facility.id} key={facility.id}>{facility.name}</option>)}</select></label>
    <label>Status<select aria-label="Task status" value={draft.status} disabled={disabled} onChange={event => change("status", event.target.value)}><option value="active">Open tasks</option><option value="all">All statuses</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="WAITING">Waiting</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
    <label>Due date<select aria-label="Task due date" value={draft.due} disabled={disabled} onChange={event => change("due", event.target.value)}><option value="all">Any due date</option><option value="overdue">Overdue · open tasks</option><option value="today">Today · SAST</option><option value="upcoming">From tomorrow</option><option value="undated">No due date</option></select></label>
    {draft.assignee === "search" ? <label>Assigned person name<input value={draft.person} required minLength={2} maxLength={100} disabled={disabled} onChange={event => change("person", event.target.value)} placeholder="Enter part of their name"/></label> : null}
    <label className="operations-task-search">Search tasks<input value={draft.q} maxLength={100} disabled={disabled} onChange={event => change("q", event.target.value)} placeholder="Task title or details"/></label>
    <div className="operations-filter-actions"><button className="button button-primary" disabled={disabled}>Apply filters</button><button type="button" className="button button-secondary" disabled={disabled} onClick={() => { const cleared = operationsTaskFiltersSchema.parse({}); setDraft(cleared); setError(""); onApply(cleared); }}>Clear filters</button></div>
    {error ? <p role="alert">{error}</p> : null}
    {!page.assigneesComplete ? <p className="panel-subtitle">The first 200 assigned people are listed. Choose Find another staff member to search the full permitted queue by name.</p> : null}
  </form>;
}
