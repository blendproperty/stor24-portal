"use client";

import { useMemo, useRef, useState } from "react";
import { checklistIssue, type ChecklistRow, type PadlockMapData } from "@/lib/operational-checklist-policy";
import { SOUTH_AFRICA_TIME_ZONE, southAfricaDateKey } from "@/lib/south-africa-time";
import { floorPlanView, type PlanElement } from "./inventory-floor-canvas";
import { InventoryFloorViewport } from "./inventory-floor-viewport";
import styles from "./operational-checklists.module.css";

const statusOptions = {
  VACANT: { label: "Vacant", color: "#b5e6a8" },
  OCCUPIED: { label: "Occupied", color: "#ffa4a4" },
  OVERLOCKED: { label: "Overlocked", color: "#ffdf70" },
  PENDING: { label: "Not checked", color: "#e2e5e8" },
};
const observedStates = ["VACANT", "OCCUPIED", "OVERLOCKED"] as const;
const countDateFormat = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: SOUTH_AFRICA_TIME_ZONE });

export function PadlockCountMap({ layout, rows, saved, changedUnit, editable, disabled, date, operator, store, update, save, discard }: {
  layout?: PadlockMapData;
  rows: ChecklistRow[];
  saved: ChecklistRow[];
  changedUnit?: string;
  editable: boolean;
  disabled: boolean;
  date: string | null;
  operator: string;
  store: string;
  update: (id: string, values: Partial<ChecklistRow>) => void;
  save: (row: ChecklistRow) => void;
  discard: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [selectionBlocked, setSelectionBlocked] = useState(false);
  const editor = useRef<HTMLElement>(null);
  const mapHeading = useRef<HTMLHeadingElement>(null);
  const units = saved.length ? saved : layout?.units;
  const floors = layout?.floors;
  const byId = useMemo(() => new Map(units?.map(unit => [unit.id, unit])), [units]);
  const observations = useMemo(() => new Map(units?.map(unit => {
    const state = "state" in unit ? unit.state as keyof typeof statusOptions : "PENDING";
    return [unit.id, statusOptions[state] ?? statusOptions.PENDING];
  })), [units]);
  const placements = useMemo(() => new Map(floors?.flatMap(floor => floor.elements.flatMap(element => element.unitId ? [[element.unitId, floor.id] as const] : []))), [floors]);
  const floor = floors?.find(item => item.id === floorId)
    ?? floors?.find(item => item.operational && /ground/i.test(item.name))
    ?? floors?.find(item => item.operational) ?? floors?.[0];
  const plan = useMemo(() => floor && ({
    ...floor,
    elements: floor.elements.map((element): PlanElement => {
      const unit = element.unitId && byId.get(element.unitId);
      return { ...element, unit: unit ? { id: unit.id, number: unit.label.replace(/^Unit /, ""), availability: "AVAILABLE" } : null };
    }),
  }), [floor, byId]);
  const view = useMemo(() => floorPlanView(plan), [plan]);
  const matchingIds = useMemo(() => new Set(byId.keys()), [byId]);
  const selectedIds = useMemo(() => new Set(selectedId ? [selectedId] : []), [selectedId]);
  const selected = byId.get(selectedId);
  const row = rows.find(item => item.id === selectedId);
  const savedObservation = observations.get(selectedId);
  const unsaved = changedUnit === selectedId;
  const checked = saved.filter(item => item.state !== "PENDING").length;
  const findings = saved.filter(item => item.state !== "PENDING" && checklistIssue(item)).length;
  const count = units?.length ?? 0;
  const unmapped = units?.filter(unit => !placements.has(unit.id)).length ?? 0;

  function choose(id: string) {
    if (disabled) return;
    if (changedUnit && changedUnit !== id) { setSelectionBlocked(true); return; }
    setSelectedId(id);
    setSelectionBlocked(false);
    const nextFloor = placements.get(id);
    if (nextFloor) setFloorId(nextFloor);
    if (editor.current && editor.current.getBoundingClientRect().top > window.innerHeight - 100) {
      editor.current.scrollIntoView({ block: "start" });
      editor.current.focus({ preventScroll: true });
    }
  }

  return <section className={styles.padlockMap} aria-label="Padlock facility map">
    <div className={styles.mapHeading}>
      <div><h3 ref={mapHeading} tabIndex={-1}>Facility map</h3><p>{store}{floor && ` · ${floor.name}`}</p></div>
      <dl>
        <div><dt>Count date</dt><dd>{date ? <time dateTime={southAfricaDateKey(date)}>{countDateFormat.format(new Date(date))}</time> : "—"}</dd></div>
        <div><dt>Operator</dt><dd>{operator}</dd></div>
        <div><dt>Saved checks</dt><dd>{checked} of {count}</dd></div>
        <div><dt>Findings</dt><dd>{findings}</dd></div>
      </dl>
    </div>
    <ul className={styles.mapLegend} aria-label="Padlock status legend">{Object.values(statusOptions).map(status =>
      <li key={status.label}><i aria-hidden="true" style={{ background: status.color }}/>{status.label}</li>)}</ul>
    <div className={styles.mapLayout}>
      <div className={styles.mapMain}>
        <div className={styles.mapToolbar}>
          {floor && <label>Floor<select aria-label="Floor" value={floor.id} disabled={disabled || !!changedUnit} onChange={event => setFloorId(event.target.value)}>
            {floors?.map(item => <option key={item.id} value={item.id}>{item.name}{item.operational ? "" : " (closed)"}</option>)}
          </select></label>}
          {count > 0 && <label>Find unit<select aria-label="Find unit" value={selected ? selectedId : ""} disabled={disabled} onChange={event => choose(event.target.value)}>
            <option value="">Choose unit</option>
            {units?.map(unit => <option key={unit.id} value={unit.id}>{unit.label} · {observations.get(unit.id)?.label}{placements.has(unit.id) ? "" : " (off map)"}</option>)}
          </select></label>}
        </div>
        {floor && !floor.operational && <p className={styles.sheetHint}>This floor is marked closed in the register. Follow site instructions for physical access.</p>}
        {plan && plan.elements.some(element => element.unit) ?
          <InventoryFloorViewport key={plan.id} floor={plan} view={view} selectedIds={selectedIds} matchingIds={matchingIds} observations={observations} onSelect={choose}/> :
          <p className={styles.mapNotice}>No unit placements are available for {floor ? "this floor" : "this store"}. {count > 0 ? "Use Find unit to open an observation." : "No units are available in this run."}</p>}
        {unmapped > 0 && <p className={styles.sheetHint}>{unmapped} {unmapped === 1 ? "unit is" : "units are"} off the map. Find those units using the selector above.</p>}
      </div>
      <aside ref={editor} tabIndex={-1} className={styles.mapEditor} aria-label="Unit observation">
        <button type="button" className={`text-button ${styles.mapReturn}`} onClick={() => { mapHeading.current?.scrollIntoView({ block: "start" }); mapHeading.current?.focus({ preventScroll: true }); }}>Back to map</button>
        {!selected ? <><h3>Tap a unit</h3><p>Choose a unit on the map or use Find unit to see its observation.</p></> : <>
          <h3>{selected.label}</h3>
          {row && <p>Register: {row.expected === "REVIEW" ? "Needs review" : statusOptions[row.expected as keyof typeof statusOptions]?.label ?? "—"}</p>}
          {row?.overlockTask && <p>Collections review flagged. Compare the calls list.</p>}
          {!row || !editable ? <>
            <p><strong>Observed status</strong> · {savedObservation?.label}</p>
            {row && <><p>Locks seen: {row.lockCount ?? "—"}</p>{row.notes && <p>{row.notes}</p>}{row.evidence && <p>Evidence: {row.evidence}</p>}{row.comparisonDiscrepancy && <p>Collections discrepancy recorded</p>}</>}
          </> : <>
            <fieldset disabled={disabled} className={styles.observationChoices}>
              <legend>Observed status</legend>
              {observedStates.map(state => <label className={styles.statusChoice} key={state}>
                <input type="radio" name="padlock-observed-status" checked={row.state === state} onChange={() => update(row.id, { state })}/>
                <i aria-hidden="true" style={{ background: statusOptions[state].color }}/>{statusOptions[state].label}
              </label>)}
            </fieldset>
            <label>Locks seen<input type="number" inputMode="numeric" min={0} max={100} step={1} value={row.lockCount ?? ""} disabled={disabled}
              onChange={event => update(row.id, { lockCount: event.target.value === "" ? null : Number(event.target.value) })}/></label>
            <label>Reason if different<textarea value={row.notes} maxLength={2000} disabled={disabled} onChange={event => update(row.id, { notes: event.target.value })}/></label>
            <label><input type="checkbox" checked={row.comparisonDiscrepancy ?? false} disabled={disabled} onChange={event => update(row.id, { comparisonDiscrepancy: event.target.checked })}/> Collections discrepancy</label>
            <details><summary>Evidence reference</summary><label>Evidence reference<input maxLength={500} value={row.evidence} disabled={disabled} onChange={event => update(row.id, { evidence: event.target.value })}/></label></details>
            {row.state !== "PENDING" && checklistIssue(row) && row.notes.trim().length < 5 && <p className={styles.sheetHint}>Add a reason before submitting the count for review.</p>}
            {unsaved && <p role="status">{selectionBlocked ? "Save or discard this observation before switching units." : "Unsaved observation"}</p>}
            <div className="button-row">
              <button type="button" className="button button-primary" disabled={disabled || !unsaved || !observedStates.some(state => state === row.state) || row.lockCount === null || !Number.isInteger(row.lockCount) || row.lockCount < 0 || row.lockCount > 100} onClick={() => save(row)}>Save observation</button>
              {unsaved && <button type="button" className="button button-secondary" disabled={disabled} onClick={() => { discard(); setSelectionBlocked(false); }}>Discard edits</button>}
            </div>
          </>}
        </>}
      </aside>
    </div>
  </section>;
}
