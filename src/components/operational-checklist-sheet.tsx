import { useEffect, useRef, type ReactNode } from "react";
import { checklistTemplates, checklistWeek, type ChecklistRow, type ChecklistTemplate } from "@/lib/operational-checklist-policy";
import { SOUTH_AFRICA_TIME_ZONE, southAfricaDateKey } from "@/lib/south-africa-time";
import styles from "./operational-checklists.module.css";

export type SheetDay = { id: string; day: number; name: string | null; rows: ChecklistRow[] };
const workbookDate = new Intl.DateTimeFormat("en-GB", { timeZone: SOUTH_AFRICA_TIME_ZONE, day: "2-digit", month: "2-digit", year: "2-digit" });
const weekdays = ["Mon", "Tues", "Wed", "Thurs", "Fri", "Sat", "Sun"];
const workbookGroups: Record<string, string> = {
  Daily: "Items", Opening: "Opening check", Evening: "Evening check", "Ground floor": "Ground storage",
  "Front and back yard": "Front yard", "Storage floors": "Storage 1, 2 and 3", Sunday: "Sundays", Friday: "Friday tests",
};
const managementItems: Record<string, string> = {
  "Check alarm arming and disarming": "Alarm arming and disarming properly",
  "Check CCTV display": "CCTV display working properly",
  "Check air conditioning": "Air conditioner working properly",
  "Check fire panel for errors": "Check fire panel for errors",
  "Check alarm panel for errors": "Check the alarm panel for errors",
  "Check camera display for errors": "Check cameras on display for errors",
  "Check entrance for breach": "Check entrance for breach",
  "Check pump room and ICV room": "Check pump room and ICV room",
  "Check tanks for leaks": "Tanks for leaks",
  "Check generator for tampering": "Check generator for tampering",
  "Check HVAC": "H-VAC working",
  "Check kitchen plumbing for leaks": "Check kitchen plumbing for leaks",
  "Check DB boards for trips": "Check DB boards for trips",
  "Check UPS for errors": "Check UPS for errors",
  "Check ramp balustrade for wear": "Check ramp balustrade for wear & tear",
  "Check CCTV operation": "CCTV working",
  "Check entrance doors lock": "Entrance doors locking OK",
  "Review opening and closing checklists": "Opening & closing checklist done",
  "Check fire equipment service dates": "Fire equipment service dates",
};
const fridayNotes = new Set(["Check pump room and ICV room", "Check generator for tampering"]);

export function workbookItemLabel(template: ChecklistTemplate, label: string) {
  const item = label.split(" \u00b7 ")[1] ?? label;
  return template === "MANAGEMENT" ? managementItems[item] ?? item : item;
}
const checkResults = { PENDING: "Pending", PASS: "Pass", ISSUE: "Issue", NA: "N/A" };
const lockResults = { PENDING: "Pending", VACANT: "Vacant", OCCUPIED: "Occupied", OVERLOCKED: "Overlocked" };

const resultLabels = { ...checkResults, ...lockResults };

export function OperationalChecklistSheet({ rows, week, startAt, assignee, template, editable, canSwitch, update, openDay }: {
  rows: ChecklistRow[];
  week: SheetDay[];
  startAt: string;
  assignee: string | null;
  template: ChecklistTemplate;
  editable: boolean;
  canSwitch: boolean;
  update: (id: string, change: Partial<ChecklistRow>) => void;
  openDay: (id: string) => void;
}) {
  const padlocks = template === "PADLOCK";
  const viewport = useRef<HTMLDivElement>(null);
  const days = checklistWeek(startAt).slice(0, 7);
  const active = days.findIndex(day => southAfricaDateKey(day) === southAfricaDateKey(startAt));
  const byDay = new Map(week.map(day => [day.day, { ...day, items: new Map(day.rows.map(row => [row.label, row])) }]));
  const current = new Map(rows.map(row => [row.label, row]));
  const labels = new Set([...current.keys(), ...week.flatMap(day => day.rows.map(row => row.label))]);

  useEffect(() => {
    const sheet = viewport.current;
    const day = sheet?.querySelector<HTMLElement>("[data-active-day]");
    const label = sheet?.querySelector<HTMLElement>("thead tr:first-child th:first-child");
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
      {row.notes || (padlocks ? "—" : "")}{row.evidence && <small>Evidence: {row.evidence}</small>}
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
    <div ref={viewport} className={padlocks ? styles.sheetScroll : `${styles.sheetScroll} ${styles.workbookScroll}`} role="region" tabIndex={0} aria-label={padlocks ? "Padlock count sheet" : "Weekly checklist sheet"}>
      {padlocks ? <table className={`${styles.sheet} ${styles.padlockSheet}`}>
        <thead><tr><th scope="col">Unit</th><th scope="col">Locks</th><th scope="col">Observed status</th><th scope="col">Discrepancy reason / comment</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <th scope="row">{row.label}<small>Expected: {row.expected === "REVIEW" ? "Review" : resultLabels[row.expected === "PASS" ? "PENDING" : row.expected]}</small>
            {row.overlockTask && <small>Compare collections list</small>}</th>
          <td>{count(row)}</td><td>{result(row)}</td><td>{comment(row)}
            {editable ? <label className={styles.discrepancy}><input type="checkbox" aria-label={`Collections discrepancy: ${row.label}`} checked={row.comparisonDiscrepancy ?? false} onChange={event => update(row.id, { comparisonDiscrepancy: event.target.checked })}/> Collections discrepancy</label> : row.comparisonDiscrepancy && <small>Collections discrepancy</small>}
          </td>
        </tr>)}</tbody>
      </table> : <table className={`${styles.sheet} ${styles.workbookSheet}`}>
        <caption>{checklistTemplates[template].name}</caption>
        <colgroup><col className={styles.workbookItemColumn} />{days.map((_, index) => <col key={index} />)}<col className={styles.workbookCommentColumn} /></colgroup>
        <thead>
          <tr><th scope="col">{template === "MANAGEMENT" ? "Daily checklist" : template === "CLEANING" ? "Cleaning areas" : "To do list"}</th>
            {days.map((_, index) => {
              const other = byDay.get(index);
              return <th key={index} scope="col" data-active-day={index === active ? "true" : undefined} className={index === active ? styles.activeDay : undefined}>
                {other ? <button type="button" className={styles.dayButton} disabled={!canSwitch} onClick={() => openDay(other.id)}>{weekdays[index]}</button> : weekdays[index]}
              </th>;
            })}<th scope="col">Comment</th></tr>
          <tr><th scope="row">Name</th>{days.map((_, index) => <td key={index} className={index === active ? styles.activeDay : undefined}>
            {index === active ? assignee ?? "Unassigned" : byDay.get(index)?.name}
          </td>)}<td /></tr>
          <tr><th scope="row">Date</th>{days.map((day, index) => <td key={index} className={index === active ? styles.activeDay : undefined}>
            <time dateTime={southAfricaDateKey(day)}>{workbookDate.format(day)}</time>
          </td>)}<td /></tr>
        </thead>
        <tbody>{Array.from(labels).map((label, index, all) => {
          const [group, item] = label.split(" \u00b7 ");
          const row = current.get(label);
          const groupHeading = index === 0 || all[index - 1].split(" \u00b7 ")[0] !== group ? workbookGroups[group] ?? group : null;
          return <SheetRows key={label} group={groupHeading}>
            <tr><th scope="row">{workbookItemLabel(template, label)}</th>
              {days.map((_, day) => {
                if (day === active) return <td key={day} className={styles.activeDay}>{row && <>{result(row)}{row.label.includes("trolleys") && count(row)}</>}</td>;
                const saved = byDay.get(day)?.items.get(label);
                return <td key={day} data-result={saved?.state}>{saved && <>{resultLabels[saved.state]}{saved.lockCount !== null && <small>{saved.lockCount} trolleys</small>}</>}</td>;
              })}<td>{template === "MANAGEMENT" && group === "Daily" && fridayNotes.has(item) && <div className={styles.workbookInstruction}>Weekly TEST-Friday</div>}
                {row && <div className={styles.workbookComment}>{comment(row)}</div>}
              </td>
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
