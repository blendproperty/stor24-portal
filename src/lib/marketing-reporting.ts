export type MarketingLead = {
  facilityId: string;
  createdAt: string;
  won: boolean;
  reserved: boolean;
  source: string;
  attribution: {
    source: string;
    medium: string;
    campaignId?: string | null;
    linkId?: string | null;
    landingPage: string;
    conversionPage: string;
  } | null;
};
export type MarketingActivity = {
  occurredAt: string;
  spend: number;
  clicks: number;
  impressions: number;
};
export type MarketingCampaign = {
  id: string;
  facilityId: string;
  name: string;
  source: string;
  medium: string;
  budget: number;
  status: string;
  activities: MarketingActivity[];
};
export function marketingReport(
  leads: MarketingLead[],
  campaigns: MarketingCampaign[],
  from: string,
  to: string,
  facilityId = "",
) {
  const start = new Date(`${from}T00:00:00+02:00`).getTime(),
    end = new Date(`${to}T23:59:59.999+02:00`).getTime();
  const within = (at: string) =>
    new Date(at).getTime() >= start && new Date(at).getTime() <= end;
  const selected = leads.filter(
    (l) => (!facilityId || l.facilityId === facilityId) && within(l.createdAt),
  );
  const campaignRows = campaigns
    .filter((c) => !facilityId || c.facilityId === facilityId)
    .map((c) => {
      const matched = selected.filter(
          (l) =>
            l.facilityId === c.facilityId && l.attribution?.campaignId === c.id,
        ),
        activities = c.activities.filter((a) => within(a.occurredAt));
      const spend = activities.reduce((n, a) => n + a.spend, 0),
        clicks = activities.reduce((n, a) => n + a.clicks, 0),
        impressions = activities.reduce((n, a) => n + a.impressions, 0),
        won = matched.filter((l) => l.won).length;
      return {
        ...c,
        leads: matched.length,
        won,
        spend,
        clicks,
        impressions,
        cpl: matched.length ? spend / matched.length : null,
        cac: won ? spend / won : null,
      };
    });
  const channels = new Map<
    string,
    { label: string; leads: number; won: number }
  >();
  for (const l of selected) {
    const label = l.attribution
      ? `${l.attribution.source} / ${l.attribution.medium}`
      : `${l.source || "Unknown"} · recorded source`;
    const row = channels.get(label) ?? { label, leads: 0, won: 0 };
    row.leads++;
    if (l.won) row.won++;
    channels.set(label, row);
  }
  const days = Math.min(366, Math.max(1, Math.ceil((end - start) / 86400000))),
    bucketDays = days > 90 ? 7 : 1;
  const trend = Array.from({ length: Math.ceil(days / bucketDays) }, (_, i) => {
    const at = start + i * bucketDays * 86400000,
      until = Math.min(end + 1, at + bucketDays * 86400000);
    return {
      date: new Date(at + 7200000).toISOString().slice(0, 10),
      leads: selected.filter((l) => {
        const t = new Date(l.createdAt).getTime();
        return t >= at && t < until;
      }).length,
      spend: campaignRows.reduce(
        (n, c) =>
          n +
          c.activities
            .filter((a) => {
              const t = new Date(a.occurredAt).getTime();
              return t >= at && t < until;
            })
            .reduce((sum, a) => sum + a.spend, 0),
        0,
      ),
    };
  });
  const won = selected.filter((l) => l.won).length,
    attributed = selected.filter((l) => l.attribution).length;
  return {
    leads: selected.length,
    won,
    reserved: selected.filter((l) => l.reserved).length,
    attributed,
    unknown: selected.length - attributed,
    conversion: selected.length ? (won / selected.length) * 100 : 0,
    spend: campaignRows.reduce((n, c) => n + c.spend, 0),
    clicks: campaignRows.reduce((n, c) => n + c.clicks, 0),
    impressions: campaignRows.reduce((n, c) => n + c.impressions, 0),
    campaigns: campaignRows,
    channels: [...channels.values()].sort((a, b) => b.leads - a.leads),
    trend,
  };
}
