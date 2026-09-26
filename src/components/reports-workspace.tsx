"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Filter, LockKeyhole } from "lucide-react";
import type { ReportDefinition } from "@/lib/reporting";

export function ReportsWorkspace({ reports, facilities, initialFrom, initialTo, canExport }: { reports: readonly ReportDefinition[]; facilities: { id: string; name: string }[]; initialFrom: string; initialTo: string; canExport: boolean }) {
  const [group, setGroup] = useState("All");
  const [reportKey, setReportKey] = useState(reports[0]?.key ?? "");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [facilityId, setFacilityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [access, setAccess] = useState<"signed-out" | "denied" | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const groups = useMemo(() => ["All", ...new Set(reports.map((report) => report.group))], [reports]);
  const visible = group === "All" ? reports : reports.filter((report) => report.group === group);
  const isAgeing = reportKey === "receivables-ageing";
  const exportHref = `/api/v1/reports/export?${new URLSearchParams({ reportKey, from: isAgeing ? to : from, to, format: "CSV", groupBy: "month", ...(facilityId ? { facilityId } : {}) })}`;

  async function exportCsv() {
    if (request.current || !canExport || access) return;
    setMessage(""); setFailed(false);
    if (!reportKey || !to || (!isAgeing && (!from || from > to))) { setFailed(true); setMessage("Choose a report and a valid date range before exporting."); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(exportHref, { cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        setAccess(response.status === 401 ? "signed-out" : "denied"); setFailed(true);
        setMessage(response.status === 401 ? "Your session has ended. Sign in again to export this report." : "Report access is unavailable. Please contact your administrator if you require access."); return;
      }
      if (!response.ok) {
        const payload = await response.json();
        setFailed(true); setMessage(response.status === 422 && typeof payload.error?.message === "string" ? payload.error.message : "The report could not be prepared. Your selections are retained; please try again."); return;
      }
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/csv") throw new Error("INVALID_EXPORT");
      const blob = await response.blob();
      if (controller.signal.aborted) throw new Error("EXPORT_ABORTED");
      if (!blob.size) { setMessage("No rows matched these report parameters. Review the report, dates and facility."); return; }
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url; link.download = isAgeing ? `stor24-${reportKey}-as-of-${to}.csv` : `stor24-${reportKey}-${from}-${to}.csv`;
        document.body.appendChild(link); link.click(); link.remove();
        setMessage("CSV download prepared. Check your browser downloads.");
      } finally { setTimeout(() => URL.revokeObjectURL(url), 5_000); }
    } catch {
      setFailed(true); setMessage("The report could not be prepared. Your selections are retained; please try again.");
    } finally { clearTimeout(timeout); request.current = null; setBusy(false); }
  }

  return (
    <div className="report-workspace">
      <section className="panel panel-spacious report-parameters">
        <div className="panel-heading"><div><h2>Report parameters</h2><p className="panel-subtitle">Choose your report, dates and facility, then download a CSV.</p></div><Filter className="muted-icon" /></div>
        {isAgeing ? <p>Ageing uses all account entries up to the selected South African date. Current recorded balances and holds are labelled separately; accounts needing reconciliation have blank ageing amounts.</p> : null}
        <div className="parameter-grid">
          <label>Report<select disabled={busy} value={reportKey} onChange={(event) => setReportKey(event.target.value)}>{reports.map((report) => <option value={report.key} key={report.key}>{report.name}</option>)}</select></label>
          {!isAgeing ? <label>From<input disabled={busy} type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label> : null}
          <label>{isAgeing ? "As of (SAST)" : "To"}<input disabled={busy} type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label>Facility<select disabled={busy} value={facilityId} onChange={(event) => setFacilityId(event.target.value)}><option value="">All permitted facilities</option>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
        </div>
        <div className="report-actions">
          <button className="button button-primary" disabled={busy || !canExport || !reportKey || !!access} onClick={() => void exportCsv()}><Download size={16}/>{busy ? "Preparing CSV…" : "Export CSV"}</button>
          {!canExport ? <span className="permission-note"><LockKeyhole size={15}/> Export access is unavailable. Please contact your administrator if you require access.</span> : null}
        </div>
        {message ? <div role={failed ? "alert" : "status"} className="report-export-feedback"><p>{message}</p>{access === "signed-out" ? <a className="button button-primary" href="/login?next=%2Freports">Sign in again</a> : access === "denied" ? <button className="button button-secondary" onClick={() => window.location.reload()}>Reload report access</button> : null}</div> : null}
      </section>
      <div className="filter-tabs">{groups.map((item) => <button className={group === item ? "active" : ""} onClick={() => setGroup(item)} key={item}>{item}</button>)}</div>
      <section className="report-card-grid">
        {visible.map((report) => <article className="panel report-card" key={report.key}><span>{report.group}</span><h3>{report.name}</h3><p>{report.description}</p><small>{report.formats.join(" / ")}</small></article>)}
      </section>
    </div>
  );
}
