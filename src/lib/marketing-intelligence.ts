import { marketingReport } from "./marketing-reporting";
import type { MarketingWorkspace } from "./marketing-service";
import { southAfricaDateKey } from "./south-africa-time";
export const ratio = (value: number, denominator: number, multiplier = 1) =>
  denominator > 0 ? (value / denominator) * multiplier : null;
export function marketingIntelligence(
  data: MarketingWorkspace,
  from: string,
  to: string,
  facility = "",
) {
  const start = new Date(from + "T00:00:00+02:00").getTime();
  const days =
    Math.round(
      (new Date(to + "T00:00:00+02:00").getTime() - start) / 86400000,
    ) + 1;
  const previousTo = southAfricaDateKey(new Date(start - 86400000));
  const previousFrom = southAfricaDateKey(new Date(start - days * 86400000));
  const current = marketingReport(
    data.leads,
    data.campaigns,
    from,
    to,
    facility,
  );
  const previous = marketingReport(
    data.leads,
    data.campaigns,
    previousFrom,
    previousTo,
    facility,
  );
  const leads = data.leads.filter(
    (l) =>
      (!facility || l.facilityId === facility) &&
      southAfricaDateKey(new Date(l.createdAt)) >= from &&
      southAfricaDateKey(new Date(l.createdAt)) <= to,
  );
  const budgets = data.campaigns
    .filter((c) => !facility || c.facilityId === facility)
    .map((c) => {
      const lifetimeSpend = c.activities.reduce((n, a) => n + a.spend, 0);
      const first = new Date(c.startsAt).getTime(),
        last = c.endsAt ? new Date(c.endsAt).getTime() : null;
      const cutoff = new Date(to + "T23:59:59.999+02:00").getTime();
      const spendToCutoff = c.activities
        .filter((a) => new Date(a.occurredAt).getTime() <= cutoff)
        .reduce((n, a) => n + a.spend, 0);
      const elapsed =
        last && last > first
          ? Math.max(0, Math.min(1, (cutoff - first) / (last - first)))
          : null;
      return {
        ...c,
        lifetimeSpend,
        remaining: c.budget - lifetimeSpend,
        utilisation: ratio(lifetimeSpend, c.budget, 100),
        expectedToDate: elapsed === null ? null : c.budget * elapsed,
        spendToCutoff,
      };
    });
  const channels = new Map<
    string,
    {
      label: string;
      spend: number;
      clicks: number;
      impressions: number;
      leads: number;
      won: number;
      registered: boolean;
    }
  >();
  for (const c of current.campaigns) {
    const key = c.source + " / " + c.medium;
    const row = channels.get(key) ?? {
      label: key,
      spend: 0,
      clicks: 0,
      impressions: 0,
      leads: 0,
      won: 0,
      registered: true,
    };
    row.spend += c.spend;
    row.clicks += c.clicks;
    row.impressions += c.impressions;
    row.leads += c.leads;
    row.won += c.won;
    channels.set(key, row);
  }
  const unmatched = leads.filter(
    (l) =>
      !current.campaigns.some(
        (c) =>
          c.facilityId === l.facilityId && c.id === l.attribution?.campaignId,
      ),
  );
  for (const l of unmatched) {
    const key = l.attribution
      ? `${l.attribution.source} / ${l.attribution.medium} · unregistered`
      : `${l.source || "Unknown"} · recorded source`;
    const row = channels.get(key) ?? {
      label: key,
      spend: 0,
      clicks: 0,
      impressions: 0,
      leads: 0,
      won: 0,
      registered: false,
    };
    row.leads++;
    if (l.won) row.won++;
    channels.set(key, row);
  }
  const placements = data.campaigns
    .filter((c) => !facility || c.facilityId === facility)
    .flatMap((c) =>
      c.links.map((link) => {
        const matched = leads.filter(
          (l) =>
            l.facilityId === c.facilityId &&
            l.attribution?.campaignId === c.id &&
            l.attribution.linkId === link.id,
        );
        return {
          ...link,
          campaignName: c.name,
          source: c.source,
          medium: c.medium,
          leads: matched.length,
          won: matched.filter((l) => l.won).length,
        };
      }),
    );
  const landingPages = new Map<
    string,
    { path: string; leads: number; won: number }
  >();
  for (const l of leads)
    if (l.attribution) {
      const path = l.attribution.landingPage;
      const row = landingPages.get(path) ?? { path, leads: 0, won: 0 };
      row.leads++;
      if (l.won) row.won++;
      landingPages.set(path, row);
    }
  return {
    current,
    previous,
    previousFrom,
    previousTo,
    budgets,
    placements,
    landingPages: [...landingPages.values()].sort((a, b) => b.leads - a.leads),
    channels: [...channels.values()].sort((a, b) => b.leads - a.leads),
    registeredLeads: current.campaigns.reduce((n, c) => n + c.leads, 0),
  };
}
