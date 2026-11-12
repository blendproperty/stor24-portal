"use client";

import { useRef, useState } from "react";
import { checklistIssue, checklistNeedsTrolleyCount, checklistRouteResultReady, type ChecklistRouteTemplate, type ChecklistRow } from "@/lib/operational-checklist-policy";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";
import styles from "./operational-checklists.module.css";

const results = { PENDING: "Not checked", PASS: "Pass", ISSUE: "Issue", NA: "Not applicable", VACANT: "Vacant", OCCUPIED: "Occupied", OVERLOCKED: "Overlocked" };
const choices = ["PASS", "ISSUE", "NA"] as const;
const walkthroughTitles: Record<ChecklistRouteTemplate, string> = {
  OPENING: "Opening walkthrough",
  CLOSING: "Closing walkthrough",
  CLEANING: "Cleaning walkthrough",
};
const itemName = (row: ChecklistRow) => row.label.includes(" · ") ? row.label.slice(row.label.indexOf(" · ") + 3) : row.label;

export function OperationalChecklistRoute({ template, rows, saved, changedId, editable, disabled, date, operator, update, save, discard }: {
  template: ChecklistRouteTemplate;
  rows: ChecklistRow[]; saved: ChecklistRow[]; changedId?: string; editable: boolean; disabled: boolean;
  date: string; operator: string; update: (id: string, patch: Partial<ChecklistRow>) => void;
  save: (row: ChecklistRow) => void; discard: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [findingsOnly, setFindingsOnly] = useState(false);
  const [selectionBlocked, setSelectionBlocked] = useState(false);
  const editor = useRef<HTMLDivElement>(null), checks = useRef<HTMLDivElement>(null);
  function groupName(row: ChecklistRow) {
    if (template === "CLOSING") {
      const floor = /^Count (ground|first|second) floor trolleys$/.exec(itemName(row))?.[1];
      return floor ? `${floor[0].toUpperCase()}${floor.slice(1)} floor` : "Evening checks";
    }
    const group = row.label.includes(" · ") ? row.label.split(" · ")[0] : "Other checks";
    return group === "Opening" ? "Office & systems" : group;
  }
  const findings = saved.filter(row => row.state !== "PENDING" && checklistIssue(row));
  const shown = findingsOnly ? findings : saved.length ? saved : rows;
  const stops = [...new Set(rows.map(groupName))];
  const groups = new Map<string, ChecklistRow[]>();
  for (const row of shown) {
    const group = groupName(row);
    const items = groups.get(group) ?? [];
    if (!groups.has(group)) groups.set(group, items);
    items.push(row);
  }
  const group = selectedGroup && groups.has(selectedGroup) ? selectedGroup : groups.keys().next().value;
  const groupRows = group ? groups.get(group) ?? [] : [];
  const active = groupRows.find(row => row.id === selectedId) ?? groupRows.find(row => row.state === "PENDING") ?? groupRows[0];
  const row = rows.find(item => item.id === active?.id);
  const unsaved = !!row && changedId === row.id;
  const completed = saved.filter(item => item.state !== "PENDING").length;
  const next = row && [...saved.slice(saved.findIndex(item => item.id === row.id) + 1), ...saved].find(item => item.id !== row.id && !checklistRouteResultReady(item));
  const needsCount = row && checklistNeedsTrolleyCount(row);
  const reasonRequired = row && (checklistIssue(row) || row.state === "NA");
  function select(area: string, id?: string, focus = false) {
    if (changedId && changedId !== id) { setSelectionBlocked(true); return; }
    setSelectionBlocked(false); setSelectedGroup(area); setSelectedId(id);
    if (focus && editor.current) {
      editor.current.focus({ preventScroll: true });
      if (checks.current && editor.current.getBoundingClientRect().top > checks.current.getBoundingClientRect().top + 30) {
        editor.current.scrollIntoView({ block: "start" });
      }
    }
  }
  return <section className={styles.walkRoute} aria-label="Walkthrough route">
    <div className={styles.mapHeading}>
      <div><h3>{walkthroughTitles[template]}</h3><p>Choose a stop, tap a check and save what you find.</p></div>
      <dl><div><dt>Run date (SAST)</dt><dd>{formatSouthAfricaDate(date)}</dd></div><div><dt>Operator</dt><dd>{operator}</dd></div></dl>
    </div>
    <div className={styles.walkProgress}>
      <strong role="status">{completed} of {rows.length} checks saved</strong>
      <progress aria-label="Checks saved" value={completed} max={rows.length}/>
      <button type="button" className="button button-secondary" aria-pressed={findingsOnly} disabled={disabled || !!changedId}
        onClick={() => setFindingsOnly(value => !value)}>{findingsOnly ? "Show all checks" : `Show findings (${findings.length})`}</button>
    </div>
    <div className={styles.walkStops} data-four-stops={stops.length === 4 || undefined} aria-label="Route stops" role="group">
      {[...groups].map(([area, items]) => {
        const count = items.filter(item => item.state !== "PENDING").length;
        return <button type="button" key={area} aria-pressed={group === area} disabled={disabled} onClick={() => select(area, area === group ? active?.id : undefined)}>
          <span>{stops.indexOf(area) + 1}. {area}</span><small>{findingsOnly ? `${items.length} ${items.length === 1 ? "finding" : "findings"}` : `${count} / ${items.length} saved`}</small>
        </button>;
      })}
    </div>
    {selectionBlocked && unsaved && <p role="status">Save or discard this check before moving to another one.</p>}
    {row ? <div className={`${styles.mapLayout} ${styles.walkLayout}`}>
      <div className={styles.walkChecks} ref={checks} tabIndex={-1}>
        <h4>Checks at this stop</h4>
        {groupRows.map(item => <button type="button" key={item.id} disabled={disabled} aria-pressed={active?.id === item.id} onClick={() => select(groupName(item), item.id, true)}>
          <span>{itemName(item)}</span><small className={styles.walkBadge} data-result={item.state}>{results[item.state]}</small>
        </button>)}
      </div>
      <div className={styles.mapEditor} ref={editor} tabIndex={-1} aria-label="Selected check" role="region">
        <h4>{itemName(row)}</h4>
        <p><span className={styles.walkBadge} data-result={active?.state}>{results[active?.state ?? "PENDING"]}</span>{unsaved && " · Unsaved changes"}</p>
        {editable ? <>
          <fieldset className={styles.walkChoices}><legend>Result</legend>
            {choices.map(state => <label key={state} className={styles.walkBadge} data-result={state}>
              <input type="radio" name="checklist-route-result" checked={row.state === state} onChange={() => update(row.id, { state })}/>{results[state]}
            </label>)}
          </fieldset>
          {needsCount && <label>Trolleys counted<input type="number" min={0} max={100} step={1} value={row.lockCount ?? ""} onChange={event => update(row.id, { lockCount: event.target.value === "" ? null : Number(event.target.value) })}/></label>}
          {reasonRequired && <label>Reason (required)<textarea rows={2} maxLength={2000} value={row.notes} onChange={event => update(row.id, { notes: event.target.value })}/></label>}
          {reasonRequired && row.notes.trim().length < 5 && <p className={styles.sheetHint}>Add at least 5 characters to explain the result.</p>}
          <div className="button-row">
            <button type="button" className="button button-primary" disabled={!unsaved || !checklistRouteResultReady(row) || (row.lockCount !== null && (!Number.isInteger(row.lockCount) || row.lockCount < 0 || row.lockCount > 100))}
              onClick={() => { setSelectedId(row.id); save(row); }}>Save check</button>
            {unsaved && <button type="button" className="button button-secondary" onClick={() => { discard(); setSelectionBlocked(false); }}>Discard</button>}
            {next && !findingsOnly && <button type="button" className="button button-secondary" disabled={unsaved} onClick={() => select(groupName(next), next.id, true)}>Next unchecked</button>}
          </div>
          <details className={styles.walkOptional} key={row.id}>
            <summary>{reasonRequired ? "Evidence reference" : "Notes and evidence"}{row.evidence || (!reasonRequired && row.notes) ? "" : " (optional)"}</summary>
            {!reasonRequired && <label>Notes (optional)<textarea rows={2} maxLength={2000} value={row.notes} onChange={event => update(row.id, { notes: event.target.value })}/></label>}
            <label>Evidence reference (optional)<input maxLength={500} value={row.evidence} onChange={event => update(row.id, { evidence: event.target.value })}/></label>
          </details>
        </> : <>
          {needsCount && row.lockCount !== null && <p><strong>Trolleys counted:</strong> {row.lockCount}</p>}
          {row.notes && <p><strong>{reasonRequired ? "Reason" : "Notes"}:</strong> {row.notes}</p>}
          {row.evidence && <p><strong>Evidence reference:</strong> {row.evidence}</p>}
        </>}
        <button type="button" className={`button button-secondary ${styles.mapReturn}`} onClick={() => checks.current?.focus()}>Back to checks</button>
      </div>
    </div> : <p>No saved findings.</p>}
  </section>;
}
