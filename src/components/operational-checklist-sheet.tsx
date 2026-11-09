import { useEffect, useRef, type ReactNode } from "react";
import { checklistWeek, type ChecklistRow } from "@/lib/operational-checklist-policy";
import { formatSouthAfricaDate, southAfricaDateKey } from "@/lib/south-africa-time";
import styles from "./operational-checklists.module.css";

export type SheetDay = { id: string; day: number; name: string | null; rows: ChecklistRow[] };
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const checkResults = { PENDING: "Pending", PASS: "Pass", ISSUE: "Issue", NA: "N/A" };
const lockResults = { PENDING: "Pending", VACANT: "Vacant", OCCUPIED: "Occupied", OVERLOCKED: "Overlocked" };

const resultLabels = { ...checkResults, ...lockResults };

export function OperationalChecklistSheet({ rows, week, startAt, assignee, padlocks, editable, canSwitch, update, openDay }: {
  rows: ChecklistRow[];
  week: SheetDay[];
  startAt: string;
  assignee: string | null;
  padlocks: boolean;
  editable: boolean;
  canSwitch: boolean;
  update: (id: string, change: Partial<ChecklistRow>) => void;
  openDay: (id: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const days = checklistWeek(startAt).slice(0, 7);
  const active = days.findIndex(day => southAfricaDateKey(day) === southAfricaDateKey(startAt));
  const byDay = new Map(week.map(day => [day.day, { ...day, items: new Map(day.rows.map(row => [row.label, row])) }]));
  const current = new Map(rows.map(row => [row.label, row]));
  const labels = new Set([...current.keys(), ...week.flatMap(day => day.rows.map(row => row.label))]);

  useEffect(() => {
    const sheet = viewport.current;
    const day = sheet?.querySelector<HTMLElement>("[data-active-day]");
    const label = sheet?.querySelector<HTMLElement>("thead th");
    if (sheet && day && label && sheet.scrollWidth > sheet.clientWidth) {
      sheet.scrollLeft = Math.max(0, day.offsetLeft - label.offsetWidth);
    }
  }, [startAt, padlocks]);

  function result(row: ChecklistRow) {
    const options = padlocks ? lockResults : checkResults;
    if (!editable) return <span data-result={row.state}>{resultLabels[row.state]}</span>;
    return <select aria-label={`Result: ${row.label}`} value={row.state}
      data-result={row.state} onChange={event => update(row.id, { state: event.target.value as ChecklistRow["state"] })}>
      {Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>;
  }
  function count(row: ChecklistRow) {
    if (!editable) return <small>{row.lockCount === null ? "—" : padlocks ? row.lockCount : `${row.lockCount} trolleys`}</small>;
    return <input aria-label={`${padlocks ? "Locks" : "Trolleys"} counted: ${row.label}`} type="number"
      min="0" max="100" step="1" value={row.lockCount ?? ""}
      onChange={event => update(row.id, { lockCount: event.target.value === "" ? null : Number(event.target.value) })} />;
  }
  function comment(row: ChecklistRow) {
    if (!editable) return <div className={styles.savedComment}>
      {row.notes || "—"}{row.evidence && <small>Evidence: {row.evidence}</small>}
    </div>;
    return <><textarea aria-label={`Comment: ${row.label}`} rows={1} maxLength={2000} value={row.notes}
      onChange={event => update(row.id, { notes: event.target.value })} />
      {(editable || row.evidence) && <details className={styles.evidence} open={row.evidence ? true : undefined}>
        <summary>Evidence</summary><input aria-label={`Evidence reference: ${row.label}`} disabled={!editable} maxLength={500}
          value={row.evidence} onChange={event => update(row.id, { evidence: event.target.value })} />
      </details>}</>;
  }
  if (!labels.size) return <p role="status">No items match the filter.</p>;

  return <>
    <p className={styles.sheetHint}>{padlocks ? editable ? "Enter the lock count and observed status for each unit." : "Recorded lock count and observed status by unit." : `Select a weekday heading to open that run.${editable ? " Edit the highlighted day, then save below." : " The highlighted column shows the open run."}`} Scroll the sheet on smaller screens.</p>
    <div ref={viewport} className={styles.sheetScroll} role="region" tabIndex={0} aria-label={padlocks ? "Padlock count sheet" : "Weekly checklist sheet"}>
      {padlocks ? <table className={`${styles.sheet} ${styles.padlockSheet}`}>
        <thead><tr><th scope="col">Unit</th><th scope="col">Locks</th><th scope="col">Observed status</th><th scope="col">Comment</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <th scope="row">{row.label}<small>Expected: {row.expected === "REVIEW" ? "Review" : resultLabels[row.expected === "PASS" ? "PENDING" : row.expected]}</small>
            {row.overlockTask && <small>Compare collections list</small>}</th>
          <td>{count(row)}</td><td>{result(row)}</td><td>{comment(row)}</td>
        </tr>)}</tbody>
      </table> : <table className={styles.sheet}>
        <thead>
          <tr><th scope="col">Checklist item</th>{days.map((day, index) => {
            const other = byDay.get(index);
            return <th key={index} scope="col" data-active-day={index === active ? "true" : undefined} className={index === active ? styles.activeDay : undefined}>
              {other ? <button type="button" className={styles.dayButton} disabled={!canSwitch} onClick={() => openDay(other.id)}>{weekdays[index]}</button> : weekdays[index]}
              <small>{formatSouthAfricaDate(day)}</small>
            </th>;
          })}<th scope="col">Comment</th></tr>
          <tr><th scope="row">Name</th>{days.map((_, index) => <td key={index} className={index === active ? styles.activeDay : undefined}>
            {index === active ? assignee ?? "Unassigned" : byDay.get(index)?.name ?? "—"}
          </td>)}<td /></tr>
        </thead>
        <tbody>{Array.from(labels).map((label, index, all) => {
          const [group, item] = label.split(" · ");
          const row = current.get(label);
          return <SheetRows key={label} group={index === 0 || all[index - 1].split(" · ")[0] !== group ? group : null}>
            <tr><th scope="row">{item ?? group}</th>
              {days.map((_, day) => {
                if (day === active) return <td key={day} className={styles.activeDay}>{row ? <>{result(row)}{row.label.includes("trolleys") && count(row)}</> : "—"}</td>;
                const saved = byDay.get(day)?.items.get(label);
                return <td key={day} data-result={saved?.state}>{saved ? <>{resultLabels[saved.state]}{saved.lockCount !== null && <small>{saved.lockCount} trolleys</small>}</> : "—"}</td>;
              })}<td>{row && comment(row)}</td>
            </tr>
          </SheetRows>;
        })}</tbody>
      </table>}
    </div>
  </>;
}

function SheetRows({ group, children }: { group: string | null; children: ReactNode }) {
  return <>{group && <tr className={styles.group}><th colSpan={9}>{group}</th></tr>}{children}</>;
}
