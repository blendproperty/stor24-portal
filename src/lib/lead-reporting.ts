import { leadSourceLabel, websiteSourceLabel } from "@/lib/lead-sources";
import type { LeadMarketProfile } from './lead-market-profile';
export const leadStages = ["NEW", "CONTACTED", "QUALIFIED", "QUOTED", "VIEWING_BOOKED", "RESERVED", "WON", "LOST"] as const;
export const stageLabels: Record<string, string> = { NEW: "New enquiry", CONTACTED: "Contacted", QUALIFIED: "Qualified", QUOTED: "Quoted", VIEWING_BOOKED: "Viewing booked", RESERVED: "Reserved", WON: "Moved in", LOST: "Lost" };
export type ReportingLead = { marketProfile?:LeadMarketProfile|null; stage: string; source: string; createdAt: string; nextActionAt: string | null; attribution: { source: string; medium?: string; landingPage: string; conversionPage: string } | null; reservations: { status: string; quotedRate: number; convertedTenancyId: string | null }[] };
export function leadReport(leads: ReportingLead[], now = new Date()) {
  const open = leads.filter(l => !["WON", "LOST"].includes(l.stage));
  const won = leads.filter(l => l.stage === "WON").length;
  const sources = new Map<string, { total: number; won: number }>();
  const paths = new Map<string, number>();
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(now.getTime() + 2*3600000); start.setUTCDate(start.getUTCDate() - (7 * (7 - i)) - ((start.getUTCDay() + 6) % 7)); start.setUTCHours(0, 0, 0, 0);
    return { label: start.toISOString().slice(0, 10), count: 0, start: start.getTime() - 2*3600000 };
  });
  for (const lead of leads) {
    const key = lead.attribution ? `${websiteSourceLabel(lead.attribution)} · website` : leadSourceLabel(lead.source) || "Unknown";
    const current = sources.get(key) ?? { total: 0, won: 0 }; current.total++; if (lead.stage === "WON") current.won++; sources.set(key, current);
    if (lead.attribution) { const route = `${lead.attribution.landingPage} → ${lead.attribution.conversionPage}`; paths.set(route, (paths.get(route) ?? 0) + 1); }
    const at = new Date(lead.createdAt).getTime(); const week = weeks.findLast(w => at >= w.start); if (week && at <= now.getTime()) week.count++;
  }
  const breakdown=(field:keyof LeadMarketProfile)=>{const values=new Map<string,number>();for(const l of leads){const recorded=l.marketProfile?.[field];const key=!recorded||recorded==='UNKNOWN'?'Unknown':recorded;values.set(key,(values.get(key)??0)+1);}return [...values].map(([label,count])=>({label,count}));};
  return { genders:breakdown('gender'),storageUses:breakdown('storageUse'),discoverySources:breakdown('discoverySource'), total: leads.length, open: open.length, won, conversionRate: leads.length ? Math.round(won / leads.length * 100) : 0,
    overdue: open.filter(l => l.nextActionAt && new Date(l.nextActionAt) < now).length,
    attributed: leads.filter(l => l.attribution).length,
    pipelineValue: open.reduce((sum, l) => sum + l.reservations.filter(r => r.status === "ACTIVE").reduce((n, r) => n + r.quotedRate, 0), 0),
    stages: leadStages.map(stage => ({ stage, label: stageLabels[stage], count: leads.filter(l => l.stage === stage).length })),
    sources: [...sources.entries()].map(([label, values]) => ({ label, ...values })).sort((a,b) => b.total-a.total),
    paths: [...paths.entries()].map(([label, count]) => ({ label, count })).sort((a,b) => b.count-a.count), weeks };
}
