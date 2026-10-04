import type { marketingReport } from "@/lib/marketing-reporting";
type Report = ReturnType<typeof marketingReport>;
const money = (n: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(n);
export function MarketingOutcomes({ report }: { report: Report }) {
  const max = Math.max(1, ...report.trend.map((d) => d.spend));
  return (
    <div className="marketing-chart-grid">
      <section className="marketing-card">
        <h2>Recorded spend over time</h2>
        <p>
          Activity spend by South African day or week · {money(report.spend)}{" "}
          total
        </p>
        {report.spend ? (
          <svg
            className="marketing-trend"
            viewBox="0 0 700 210"
            role="img"
            aria-label={`Recorded spend ${money(report.spend)}. Values are in the enquiry chart table.`}
          >
            {[0, 1, 2].map((i) => (
              <line
                key={i}
                x1="0"
                x2="700"
                y1={15 + i * 80}
                y2={15 + i * 80}
                stroke="#e2e9ed"
              />
            ))}
            {report.trend.map((d, i) => (
              <g key={d.date}>
                <rect
                  x={(i * 700) / report.trend.length + 2}
                  y={180 - (d.spend / max) * 160}
                  width={Math.max(1, 700 / report.trend.length - 4)}
                  height={(d.spend / max) * 160}
                  rx="3"
                  fill="#294f60"
                >
                  <title>
                    {d.date}: {money(d.spend)}
                  </title>
                </rect>
              </g>
            ))}
            <text x="0" y="205" fill="#687f8b" fontSize="12">
              {report.trend[0]?.date}
            </text>
            <text x="700" y="205" textAnchor="end" fill="#687f8b" fontSize="12">
              {report.trend.at(-1)?.date}
            </text>
          </svg>
        ) : (
          <div className="marketing-empty">
            Log activity spend to see this chart.
          </div>
        )}
      </section>
      <section className="marketing-card">
        <h2>Enquiry outcomes</h2>
        <p>Current results for the selected enquiry cohort</p>
        <div className="marketing-channel-bars">
          {[
            { label: "Enquiries", count: report.leads },
            { label: "Currently reserved", count: report.reserved },
            { label: "Confirmed move-in", count: report.won },
          ].map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>{row.count}</strong>
              <div>
                <i
                  style={{
                    width: `${report.leads ? (row.count / report.leads) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 24 }}>
          Reservations and move-ins are separate current outcomes. This chart
          does not imply every enquiry passed through every stage.
        </p>
      </section>
    </div>
  );
}
