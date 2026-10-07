"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportPreview } from "@/components/report-preview";
import { Download, Filter, LockKeyhole } from "lucide-react";
import { isCurrentSnapshotReport, type ReportDefinition } from "@/lib/reporting";

export function ReportsWorkspace({ reports, facilities, initialFrom, initialTo, canExport }: { reports: readonly ReportDefinition[]; facilities: { id: string; name: string }[]; initialFrom: string; initialTo: string; canExport: boolean }) {
  const [previewRun,setPreviewRun] = useState(0);
  const [previewQuery, setPreviewQuery] = useState("");
  const [format, setFormat] = useState<"CSV" | "XLSX" | "PDF">("CSV");
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
  const reportSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  const groups = useMemo(() => ["All", ...new Set(reports.map((report) => report.group))], [reports]);
  const visible = group === "All" ? reports : reports.filter((report) => report.group === group);
  const isSnapshot = isCurrentSnapshotReport(reportKey);
  const isAgeing = reportKey === "receivables-ageing";
  const exportHref = `/api/v1/reports/export?${new URLSearchParams({ reportKey, from: isSnapshot ? initialTo : isAgeing ? to : from, to: isSnapshot ? initialTo : to, format, groupBy: "month", ...(facilityId ? { facilityId } : {}) })}`;

  async function exportCsv() {
    if (request.current || !canExport || access) return;
    setMessage(""); setFailed(false);
    if (!reportKey || (!isSnapshot && (!to || (!isAgeing && (!from || from > to))))) { setFailed(true); setMessage("Choose a report and a valid date range before exporting."); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(exportHref, { cache: "no-store", signal: controller.signal });
      if (response.status === 403) {
        const payload = await response.clone().json().catch(() => null);
        if (payload?.error?.code === "PERSONAL_EXPORT_FORBIDDEN") {
          setFailed(true); setMessage("This report contains personal data. Ask a Super Admin (Organisation owner) to authorise personal-data exports, or choose an operational report without personal fields."); return;
        }
      }
      if (response.status === 401 || response.status === 403) {
        setAccess(response.status === 401 ? "signed-out" : "denied"); setFailed(true);
        setMessage(response.status === 401 ? "Your session has ended. Sign in again to export this report." : "Report access is unavailable. Please contact your administrator if you require access."); return;
      }
      if (!response.ok) {
        const payload = await response.json();
        if (response.status === 422 && payload.error?.code === "DLP_EXPORT_BLOCKED") {
          setFailed(true); setMessage(`Data protection blocked this export. Contact your administrator.${typeof payload.error.requestId === "string" ? ` Request reference: ${payload.error.requestId.slice(0, 100)}` : ""}`); return;
        }
        setFailed(true); setMessage(response.status === 422 && typeof payload.error?.message === "string" ? payload.error.message : "The report could not be prepared. Your selections are retained; please try again."); return;
      }
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== ({CSV:"text/csv",XLSX:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",PDF:"application/pdf"}[format])) throw new Error("INVALID_EXPORT");
      const blob = await response.blob();
      if (controller.signal.aborted) throw new Error("EXPORT_ABORTED");
      if (!blob.size) { setMessage("No rows matched these report parameters. Review the report, dates and facility."); return; }
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url; link.download = isSnapshot ? `stor24-${reportKey}-current.${format.toLowerCase()}` : isAgeing ? `stor24-${reportKey}-as-of-${to}.${format.toLowerCase()}` : `stor24-${reportKey}-${from}-${to}.${format.toLowerCase()}`;
        document.body.appendChild(link); link.click(); link.remove();
        setMessage(`${format} download prepared. Check your browser downloads.`);
      } finally { setTimeout(() => URL.revokeObjectURL(url), 5_000); }
    } catch {
      setFailed(true); setMessage("The report could not be prepared. Your selections are retained; please try again.");
    } finally { clearTimeout(timeout); request.current = null; setBusy(false); }
  }

  return (
    <div className="report-workspace">
      <section className="panel panel-spacious report-parameters">
        <div className="panel-heading"><div><h2>Report parameters</h2><p className="panel-subtitle">Choose a report and store. Set the period, then view or export. Dates use SAST.</p></div><Filter className="muted-icon" /></div>
        {isSnapshot ? <p>Current snapshot: this report shows the records available when exported, not a historical date range. The export includes its snapshot timestamp.</p> : null}
        {isAgeing ? <p>Ageing uses all account entries up to the selected South African date. Current recorded balances and holds are labelled separately; accounts needing reconciliation have blank ageing amounts.</p> : null}
        <p className="permission-note"><LockKeyhole size={15}/> Exports are confidential and checked by data protection. Share only with authorised recipients. Export decisions are recorded in the system audit. Personal-data exports require Super Admin (Organisation owner) authorisation.</p>
        <div className={`parameter-grid ${isSnapshot ? "parameter-grid-snapshot" : isAgeing ? "parameter-grid-ageing" : ""}`}>
          <label>Report<select aria-label="Report" ref={reportSelect} disabled={busy} value={reportKey} onChange={(event) => setReportKey(event.target.value)}>{reports.map((report) => <option value={report.key} key={report.key}>{report.name}</option>)}</select></label>
          {!isAgeing && !isSnapshot ? <label>From<input disabled={busy} type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label> : null}
          {!isSnapshot ? <label>{isAgeing ? "As of (SAST)" : "To"}<input disabled={busy} type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label> : null}
          <label>Facility<select disabled={busy} value={facilityId} onChange={(event) => setFacilityId(event.target.value)}><option value="">All permitted facilities</option>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
        </div>
        <div className="report-actions"><button className="button button-secondary" disabled={busy || !reportKey || !!access} onClick={() => {if (!isSnapshot && (!to || (!isAgeing && (!from || from > to)))) {setFailed(true);setMessage("Choose a valid reporting period.");return;}setPreviewQuery(exportHref.split("?")[1]);setPreviewRun(v=>v+1);}}>View report</button><label>Download format<select value={format} onChange={e=>setFormat(e.target.value as "CSV" | "XLSX" | "PDF")}><option value="CSV">CSV</option><option value="XLSX">Excel (.xlsx)</option><option value="PDF">PDF</option></select></label>
          <button className="button button-primary" disabled={busy || !canExport || !reportKey || !!access} onClick={() => void exportCsv()}><Download size={16}/>{busy ? `Preparing ${format}…` : `Export ${format}`}</button>
          {!canExport ? <span className="permission-note"><LockKeyhole size={15}/> Export access is unavailable. Please contact your administrator if you require access.</span> : null}
        </div>
        {message ? <div role={failed ? "alert" : "status"} className="report-export-feedback"><p>{message}</p>{access === "signed-out" ? <a className="button button-primary" href="/login?next=%2Freports">Sign in again</a> : access === "denied" ? <button className="button button-secondary" onClick={() => window.location.reload()}>Reload report access</button> : null}</div> : null}
      </section>
      {previewQuery ? <ReportPreview key={previewRun} query={previewQuery} title={reports.find(r=>r.key===new URLSearchParams(previewQuery).get("reportKey"))?.name ?? "Report"}/> : null}
      <section className="report-catalogue" aria-label="Report catalogue"><div className="panel-heading"><div><h2>Report catalogue</h2><p className="panel-subtitle">Choose a report below, then use the controls above to view the results.</p></div></div>
      <div className="filter-tabs">{groups.map((item) => <button className={group === item ? "active" : ""} onClick={() => setGroup(item)} key={item}>{item}</button>)}</div>
      <section className="report-card-grid">
        {visible.map((report) => <article className="panel report-card" key={report.key}><span>{report.group}</span><h3>{report.name}</h3><p>{report.description}</p><small>{report.formats.join(" / ")}</small><button type="button" className="report-select-button" disabled={busy} aria-pressed={reportKey === report.key} onClick={() => { setReportKey(report.key); reportSelect.current?.focus(); }}>Select {report.name}</button></article>)}
      </section>
      </section>
    </div>
  );
}
