import Link from "next/link";
import { ArrowUpRight, DoorOpen, CreditCard, Users } from "lucide-react";

export function PortfolioOverview({ occupiedUnits, totalUnits, occupancyPct, receivables, overdueAccounts, activeLeads, newLeadsThisWeek }: {
  occupiedUnits: number; totalUnits: number; occupancyPct: number; receivables: number; overdueAccounts: number; activeLeads: number; newLeadsThisWeek: number;
}) {
  const circumference = 2 * Math.PI * 62;
  const fill = Math.min(100, Math.max(0, occupancyPct));
  return <section className="portfolio-overview" aria-label="Portfolio metrics" data-guide="dashboard-metrics">
    <article className="portfolio-occupancy">
      <div className="portfolio-occupancy-copy"><p className="eyebrow">Portfolio at a glance</p><h2>Space working.<br/>Business moving.</h2><p>{occupiedUnits} occupied · {totalUnits - occupiedUnits} not occupied</p><Link href="/units">Explore inventory <ArrowUpRight size={16}/></Link></div>
      <div className="occupancy-gauge" role="img" aria-label={`Physical occupancy ${occupancyPct.toFixed(1)} percent. ${occupiedUnits} of ${totalUnits} units.`}>
        <svg viewBox="0 0 152 152" aria-hidden="true"><circle cx="76" cy="76" r="62" className="gauge-track"/><circle cx="76" cy="76" r="62" className="gauge-value" strokeDasharray={`${circumference * fill / 100} ${circumference}`} transform="rotate(-90 76 76)"/></svg>
        <div><strong>{occupancyPct.toFixed(1)}<small>%</small></strong><span>Physical occupancy</span></div>
      </div>
    </article>
    <div className="portfolio-signals">
      <Link className="portfolio-signal" href="/collections"><span className="signal-icon"><CreditCard size={20}/></span><div><span>Receivables</span><strong>{receivables.toLocaleString("en-ZA", { style: "currency", currency: "ZAR" })}</strong><small>{overdueAccounts} accounts with balances</small></div><ArrowUpRight size={17}/></Link>
      <Link className="portfolio-signal" href="/leads"><span className="signal-icon"><Users size={20}/></span><div><span>Active leads</span><strong>{activeLeads}</strong><small>{newLeadsThisWeek} created in the last 7 days</small></div><ArrowUpRight size={17}/></Link>
      <Link className="portfolio-signal" href="/tenants"><span className="signal-icon"><DoorOpen size={20}/></span><div><span>Occupied units</span><strong>{occupiedUnits}<em> / {totalUnits}</em></strong><small>Across your permitted facilities</small></div><ArrowUpRight size={17}/></Link>
    </div>
  </section>;
}
