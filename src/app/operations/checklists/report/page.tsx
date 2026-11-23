import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { checklistReport, checklistReportFilters, checklistReportTemplates } from "@/lib/checklist-report";
import { checklistHref, checklistRunStatuses, checklistTemplates } from "@/lib/operational-checklist-policy";
import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope } from "@/lib/scope";
import { formatSouthAfricaDateTime, southAfricaDateKey } from "@/lib/south-africa-time";
import styles from "./report.module.css";

export const metadata = { title: "Checklist report" };

const resultLabels = { PASS: "Pass", ISSUE: "Issue", NA: "Not applicable", VACANT: "Vacant", OCCUPIED: "Occupied", OVERLOCKED: "Overlocked", PENDING: "Pending" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await requirePermissionScope("operations.view");
  const query = await searchParams;
  const today = southAfricaDateKey(new Date());
  const from = typeof query.from === "string" ? query.from : `${today.slice(0, 8)}01`;
  const to = typeof query.to === "string" ? query.to : today;
  const facilities = await db.facility.findMany({
    where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  const filters = checklistReportFilters.safeParse({ from: query.from ?? from, to: query.to ?? to, facility: query.facility ?? "", template: query.template ?? "" });
  const valid = filters.success && (!filters.data.facility || facilities.some(store => store.id === filters.data.facility));
  const report = valid ? await checklistReport(scope, filters.data) : null;
  const runs = report && !report.overLimit ? report.runs : [];
  const included = runs.filter(run => run.status !== "CANCELLED");
  const now = new Date();

  return <div className={`page-stack ${styles.workspace}`}>
    <PageHeader eyebrow="Operations" title="Checklist report" description="Compare Opening, Closing, Cleaning and Management runs by scheduled date (SAST)."
      action={<Link className="button button-secondary" href="/operations/checklists">Back to checklists</Link>} />
    <form className={`panel panel-spacious ${styles.filters}`} aria-label="Checklist report filters">
      <div><label htmlFor="checklist-report-store">Store</label><select id="checklist-report-store" name="facility" defaultValue={valid ? filters.data.facility : ""}>
        <option value="">All permitted stores</option>
        {facilities.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
      </select></div>
      <div><label htmlFor="checklist-report-template">Checklist</label><select id="checklist-report-template" name="template" defaultValue={valid ? filters.data.template : ""}>
        <option value="">All four checklists</option>
        {checklistReportTemplates.options.map(key => <option key={key} value={key}>{checklistTemplates[key].name}</option>)}
      </select></div>
      <label>From<input type="date" name="from" defaultValue={from} required /></label>
      <label>To<input type="date" name="to" defaultValue={to} required /></label>
      <button className="button button-primary" type="submit">Run report</button>
    </form>
    {!valid ? <p role="alert">Choose a permitted store, a checklist and a date range of up to 92 days.</p>
      : report?.overLimit ? <p role="alert">More than 500 runs match. Choose a shorter date range, one store or one checklist to see complete totals.</p>
      : <>
        <section className="panel panel-spacious" aria-labelledby="summary-heading">
          <h2 id="summary-heading">Summary by checklist</h2>
          <p>Cancelled runs are shown in the run list. The summary covers all other scheduled runs in the selected period.</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Checklist summary">
            <table className="data-table">
              <thead><tr>{["Checklist", "Scheduled", "Overdue", "Awaiting review", "Signed off", "Issues"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{checklistReportTemplates.options.filter(key => !filters.data.template || key === filters.data.template).map(key => {
                const group = included.filter(run => run.record.template === key);
                return <tr key={key}>
                  <th scope="row">{checklistTemplates[key].name}</th><td>{group.length}</td>
                  <td>{group.filter(run => isOverdue(run, now)).length}</td>
                  <td>{group.filter(run => run.status === "WAITING").length}</td>
                  <td>{group.filter(run => run.status === "COMPLETED").length}</td>
                  <td>{group.reduce((sum, run) => sum + run.issues, 0)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </section>
        <section className="panel panel-spacious" aria-labelledby="runs-heading">
          <h2 id="runs-heading">Scheduled runs</h2>
          {runs.length === 0 ? <p>No checklist runs match this selection.</p> : <div className={styles.runs}>{runs.map(run => {
            const { record, saved } = run;
            const name = checklistTemplates[record.template].name;
            return <details className={styles.run} key={run.id}>
              <summary>
                <span className={styles.runIdentity}><strong>{name}</strong><span>{run.date} · {run.facility?.name}</span></span>
                <StatusPill tone={run.status === "COMPLETED" ? "positive" : run.status === "WAITING" ? "warning" : "neutral"}>{checklistRunStatuses[run.status]}</StatusPill>
                {isOverdue(run, now) && <StatusPill tone="danger">Overdue</StatusPill>}
                <span>{record.sourceAt ? `${saved.length}/${record.rows.length} recorded` : "No checks recorded"}</span>
                <span>{run.issues} {run.issues === 1 ? "issue" : "issues"} · {run.notApplicable} N/A</span>
              </summary>
              <div className={styles.runBody}>
                <dl>
                  <div><dt>Assigned to</dt><dd>{run.assignee?.name ?? "Unassigned"}</dd></div>
                  <div><dt>Due (SAST)</dt><dd>{formatSouthAfricaDateTime(run.dueAt)}</dd></div>
                  {record.submittedAt && <div><dt>Submitted (SAST)</dt><dd>{formatSouthAfricaDateTime(record.submittedAt)}</dd></div>}
                  {record.reviewedAt && <div><dt>Signed off (SAST)</dt><dd>{formatSouthAfricaDateTime(record.reviewedAt)}</dd></div>}
                </dl>
                {record.summary && <p><strong>Run summary</strong><br />{record.summary}</p>}
                {record.reviewNote && <p><strong>Reviewer note</strong><br />{record.reviewNote}</p>}
                {saved.length > 0 && <div className="table-wrap" tabIndex={0} role="region" aria-label="Saved check results">
                  <table className="data-table">
                    <thead><tr>{["Check", "Result", "Trolley count", "Reason / note", "Evidence reference"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                    <tbody>{saved.map(row => <tr key={row.id}>
                      <th scope="row">{row.label}</th>
                      <td>{resultLabels[row.state]}</td>
                      <td>{row.lockCount ?? "—"}</td><td>{row.notes || "—"}</td><td>{row.evidence || "—"}</td>
                    </tr>)}</tbody>
                  </table>
                </div>}
                <Link className="button button-secondary" href={checklistHref(name, run.id)}>Open checklist run</Link>
              </div>
            </details>;
          })}</div>}
        </section>
      </>}
  </div>;
}

function isOverdue(run: { dueAt: Date | null; status: string }, now: Date) {
  return run.dueAt !== null && run.dueAt < now && (run.status !== "COMPLETED" && run.status !== "CANCELLED");
}
