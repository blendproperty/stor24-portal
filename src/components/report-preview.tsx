"use client";
import { useEffect, useState } from "react";
import { reportInsights } from "@/lib/report-insights";
import type { ReportInsight } from "@/lib/report-insights";
import type { ReportRow } from "@/lib/report-data-service";
export function ReportPreview({
  query,
  title,
}: {
  query: string;
  title: string;
}) {
  const [state, setState] = useState<{ rows: ReportRow[]; at: string; insight:ReportInsight } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    async function load() {
      setBusy(true);
      setState(null);
      setError("");
      setPage(0);
      try {
        const response = await fetch(`/api/v1/reports/preview?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error?.message ?? "Report unavailable.");
        if (!Array.isArray(payload.data))
          throw new Error("Invalid report response.");
        let insight:ReportInsight;
        try { insight=reportInsights(new URLSearchParams(query).get("reportKey")??"",payload.data); }
        catch { throw new Error("Store attribution or amounts need review before totals can be shown. Refresh the report and check its source records."); }
        if (current)
          setState({ rows: payload.data, at: new Date().toISOString(), insight });
      } catch (e) {
        if (current)
          setError(e instanceof Error ? e.message : "Report unavailable.");
      } finally {
        if (current) setBusy(false);
      }
    }
    void load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [query]);
  const key = new URLSearchParams(query).get("reportKey") ?? "",
    insight = state?.insight ?? reportInsights(key, []),
    max = insight.chartTitle.includes("(%)")
      ? 100
      : Math.max(1, ...insight.bars.map((b) => Math.abs(b.value))),
    headers = Object.keys(state?.rows[0] ?? {});
  return (
    <section
      className="panel panel-spacious report-live-preview"
      aria-live="polite"
    >
      <h2>{title}</h2>
      {busy ? (
        <p>Loading current report data…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : state ? (
        <>
          <p className="panel-subtitle">
            Generated{" "}
            {new Date(state.at).toLocaleString("en-ZA", {
              timeZone: "Africa/Johannesburg",
            })}{" "}
            SAST · {state.rows.length} records
          </p>
          <div className="report-kpi-grid">
            {insight.metrics.map((m) => (
              <div key={m.label}>
                <small>{m.label}</small>
                <strong>
                  {m.money ? "R " : ""}
                  {m.value.toLocaleString("en-ZA", {
                    minimumFractionDigits: m.money ? 2 : 0,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>
            ))}
          </div>
          <h3>{insight.chartTitle}</h3>
          {state.rows.length ? (
            <div
              className="report-bars"
              role="img"
              aria-label={`${insight.chartTitle}. ${insight.bars.map((b) => `${b.label}: ${b.value}`).join("; ")}`}
            >
              {insight.bars.map((b) => (
                <div key={b.label}>
                  <span>{b.label}</span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max(1, (Math.abs(b.value) / max) * 100)}%`,
                      }}
                    />
                  </div>
                  <b>
                    {b.value.toLocaleString("en-ZA", {
                      minimumFractionDigits: ["recurring-charges", "posted-recurring-charges"].includes(new URLSearchParams(query).get("reportKey") ?? "") ? 2 : 0,
                      maximumFractionDigits: 2,
                    })}
                  </b>
                </div>
              ))}
            </div>
          ) : (
            <p>
              No records match these parameters. Review the facility and
              reporting period.
            </p>
          )}
          <p className="report-guidance">{insight.guidance}</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h.replace(/([a-z])([A-Z])/g, "$1 $2")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.rows.slice(page * 25, (page + 1) * 25).map((r, i) => (
                  <tr key={i}>
                    {headers.map((h) => (
                      <td key={h}>
                        {r[h] === null ? "Not recorded" : String(r[h])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.rows.length > 25 ? (
            <div className="report-actions">
              <button
                className="button button-secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>
                Page {page + 1} of {Math.ceil(state.rows.length / 25)}
              </span>
              <button
                className="button button-secondary"
                disabled={(page + 1) * 25 >= state.rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
