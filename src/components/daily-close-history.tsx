import { StatusPill } from "@/components/status-pill";
import { formatSouthAfricaDate, formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export type DailyCloseRecord = {
  id: string; businessDate: string; status: string; facility: { name: string };
  expectedCash?: string | number | null; countedCash?: string | number | null; variance: string | number | null;
  notes?: string | null; checks?: unknown; closedBy?: { name: string } | null; closedAt?: string | null;
};

function cash(value: string | number | null | undefined) {
  return value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(Number(value)) ? "Not recorded" : `R ${Number(value).toFixed(2)}`;
}

export function DailyCloseHistory({ records }: { records: DailyCloseRecord[] }) {
  return <div className="daily-close-history">
    {records.length ? records.map(record => {
      const checks = Array.isArray(record.checks) ? record.checks.filter((entry): entry is { label: string; complete: boolean } => !!entry && typeof entry.label === "string" && typeof entry.complete === "boolean") : [];
      return <details className="daily-close-record" key={record.id}>
        <summary><span><strong>{formatSouthAfricaDate(record.businessDate)}</strong><span className="secondary-cell">{record.facility.name}</span></span><StatusPill tone={record.status === "CLOSED" ? "positive" : "warning"}>{record.status}</StatusPill><span>Variance <strong>{cash(record.variance)}</strong><span className="secondary-cell">Review snapshot</span></span></summary>
        <div className="daily-close-snapshot">
          <dl><div><dt>Expected cash</dt><dd>{cash(record.expectedCash)}</dd></div><div><dt>Counted cash</dt><dd>{cash(record.countedCash)}</dd></div><div><dt>Cash variance</dt><dd>{cash(record.variance)}</dd></div><div><dt>Closed by</dt><dd>{record.closedBy?.name || "Not recorded"}</dd></div><div><dt>Closed at (SAST)</dt><dd>{record.closedAt && Number.isFinite(Date.parse(record.closedAt)) ? formatSouthAfricaDateTime(record.closedAt) : "Not recorded"}</dd></div></dl>
          <h3>Close notes</h3><p className="daily-close-notes">{record.notes?.trim() ? record.notes : "No notes recorded."}</p>
          <h3>Staff attestations</h3>
          {checks.length ? <ul>{checks.map((check, index) => <li key={index}><span>{check.label}</span><strong>{check.complete ? "Confirmed" : "Not confirmed"}</strong></li>)}</ul> : <p>No attestations recorded.</p>}
          <p className="panel-subtitle">{record.status === "CLOSED" ? "Saved staff snapshot. Later postings may differ; finance must review any correction." : "This snapshot has not been closed. Review its outstanding checks and cash count."}</p>
        </div>
      </details>;
    }) : <p className="empty-cell">No daily closes recorded.</p>}
  </div>;
}
