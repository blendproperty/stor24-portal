import { Activity, BarChart3, DoorOpen, TrendingUp, Users, Wallet } from "lucide-react";
import "./dashboard.css";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { requireScope } from "@/lib/scope";
import {
  getDashboardKpis,
  getLeadsLast7Days,
  getOccupancyTrend,
  getPipelineByStage,
  getRevenueTrend,
  getUnitStatsByFacility,
} from "@/lib/dashboard-service";

export const metadata = { title: "Performance overview" };

const currency = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 });

function LineChart({ points, formatValue }: { points: { label: string; value: number }[]; formatValue?: (v: number) => string }) {
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const width = 600;
  const height = 180;
  const stepX = width / Math.max(points.length - 1, 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p.value - min) / range) * (height - 20) - 10;
    return { x, y, ...p };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${coords[coords.length - 1]?.x ?? 0} ${height} L 0 ${height} Z`;

  return (
    <div className="line-chart-wrap" role="region" aria-label="Monthly occupancy trend" tabIndex={0}>
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--orange)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--orange)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#lineFill)" stroke="none" />
        <path d={path} fill="none" stroke="var(--orange)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={3.5} fill="var(--orange)" />
        ))}
      </svg>
      <div className="line-chart-labels">
        {points.map((p, i) => (
          <span key={i}>{p.label}{formatValue ? <b>{formatValue(p.value)}</b> : null}</span>
        ))}
      </div>
    </div>
  );
}

export default async function GraphsPage() {
  const scope = await requireScope();
  const [kpis, pipeline, leadsWeek, occupancyTrend, revenueTrend, unitStats] = await Promise.all([
    getDashboardKpis(scope),
    getPipelineByStage(scope),
    getLeadsLast7Days(scope),
    getOccupancyTrend(scope),
    getRevenueTrend(scope),
    getUnitStatsByFacility(scope),
  ]);

  const maxPipelineCount = Math.max(...pipeline.map((p) => p.count), 1);
  const maxRevenue = Math.max(...revenueTrend.map((r) => Math.max(r.billed, r.collected)), 1);
  const maxWeekLeads = Math.max(...leadsWeek.map((d) => d.count), 1);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Reporting"
        title="Performance overview"
        description="Live portfolio performance across pipeline, occupancy, revenue and collections — built from real leasing and billing data."
      />

      <section className="metric-grid" aria-label="Portfolio KPIs">
        <MetricCard label="New leads (7 days)" value={String(kpis.newLeadsThisWeek)} detail={`${kpis.leadsThisMonth} this month`} icon={Users} tone="default" />
        <MetricCard label="Lead conversion" value={`${kpis.conversionRatePct.toFixed(1)}%`} detail={`${kpis.wonThisMonth} won this month`} icon={TrendingUp} tone="green" />
        <MetricCard label="Physical occupancy" value={`${kpis.occupancyPct.toFixed(1)}%`} detail={`${kpis.occupiedUnits} of ${kpis.totalUnits} units`} icon={DoorOpen} tone="orange" />
        <MetricCard label="Active tenancies" value={String(kpis.activeTenancies)} detail="Across all permitted facilities" icon={BarChart3} tone="default" />
        <MetricCard label="Billed month to date" value={currency.format(kpis.monthToDateBilled)} detail="Charges raised this month" icon={Wallet} tone="default" />
        <MetricCard label="Collections rate" value={`${kpis.collectionsRatePct.toFixed(1)}%`} detail={`${currency.format(kpis.monthToDateCollected)} collected`} icon={Activity} tone={kpis.collectionsRatePct >= 90 ? "green" : "warning"} />
      </section>

      <section className="dashboard-grid">
        <article className="panel panel-spacious">
          <div className="panel-heading">
            <div><h2>Occupancy trend</h2><p className="panel-subtitle">Rolling 12 months, reconstructed from occupancy records</p></div>
            <TrendingUp className="positive-icon" />
          </div>
          <LineChart points={occupancyTrend} formatValue={(v) => `${v}%`} />
        </article>
        <article className="panel panel-spacious">
          <div className="panel-heading">
            <h2>Lead pipeline</h2>
            <BarChart3 className="muted-icon" />
          </div>
          <p className="panel-subtitle">Leads created in the last 90 days, by stage</p>
          <div className="score-list">
            {pipeline.map((p) => (
              <div key={p.stage}>
                <span><strong>{p.label}</strong><b>{p.count}</b></span>
                <i><em style={{ width: `${(p.count / maxPipelineCount) * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel panel-spacious">
          <div className="panel-heading">
            <div><h2>Revenue index</h2><p className="panel-subtitle">Charged vs collected, last 12 months</p></div>
            <Activity className="positive-icon" />
          </div>
          <div className="revenue-dual-chart" aria-label="Charged vs collected by month">
            {revenueTrend.map((m, i) => (
              <div key={i} className="revenue-dual-bar">
                <div className="revenue-dual-bar-track">
                  <span style={{ height: `${(m.billed / maxRevenue) * 100}%` }} className="revenue-bar-billed" title={`Billed: ${currency.format(m.billed)}`} />
                  <span style={{ height: `${(m.collected / maxRevenue) * 100}%` }} className="revenue-bar-collected" title={`Collected: ${currency.format(m.collected)}`} />
                </div>
                <small>{m.label}</small>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><i className="legend-dot legend-billed" />Billed</span>
            <span><i className="legend-dot legend-collected" />Collected</span>
          </div>
        </article>
        <article className="panel panel-spacious">
          <div className="panel-heading"><h2>New leads, last 7 days</h2><Users className="muted-icon" /></div>
          <div className="bar-chart" aria-label="New leads by day">
            {leadsWeek.map((d, i) => (
              <span key={i} style={{ height: `${Math.max((d.count / maxWeekLeads) * 100, d.count > 0 ? 6 : 2)}%` }}>
                <i>{d.count}</i>
              </span>
            ))}
          </div>
        </article>
      </section>

      <section className="panel panel-spacious">
        <div className="panel-heading"><h2>Unit status by facility</h2><DoorOpen className="muted-icon" /></div>
        <div className="table-wrap" role="region" aria-label="Unit status by facility" tabIndex={0}>
        <table className="unit-status-table">
          <thead>
            <tr>
              <th>Facility</th>
              <th>Total units</th>
              <th>Available</th>
              <th>Reserved / held</th>
              <th>Occupied</th>
              <th>Service / unavailable</th>
              <th>Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {unitStats.map((f) => (
              <tr key={f.facilityId}>
                <td>{f.facilityName}</td>
                <td>{f.total}</td>
                <td>{f.available}</td>
                <td>{f.reserved}</td>
                <td>{f.occupied}</td>
                <td>{f.service}</td>
                <td>
                  <span className="occupancy-pct-cell">
                    <i style={{ width: `${f.occupancyPct}%` }} />
                    {f.occupancyPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
            {unitStats.length === 0 && (
              <tr><td colSpan={7} className="empty-row">No facilities in scope.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
