import registry from "./launch-advertising.json";

type Campaign = { id: string; name: string; source: string; medium: string; ads: Record<string, {adId: string; adGroupId?: string; adSetId?: string}>; keywords: string[] };
export const launchAdvertising: Record<string, Campaign> = registry;
export type AdvertisingAttribution = { campaign: string; campaignId: string; content?: string; adId?: string; adGroupId?: string; adSetId?: string; term?: string };

// shortcut: this launch registry must be refreshed when approved ads or purchased keywords change.
// Only approved public metadata is retained; arbitrary URL text never becomes analytics data.
function approvedAdvertising(campaign: string, content?: string, term?: string): AdvertisingAttribution | undefined {
  if (!Object.hasOwn(launchAdvertising, campaign)) return undefined;
  const entry = launchAdvertising[campaign];
  const ad = content && Object.hasOwn(entry.ads, content) ? entry.ads[content] : undefined;
  return {campaign, campaignId: entry.id, ...(ad ? {content, ...ad} : {}), ...(term && entry.keywords.includes(term) ? {term} : {})};
}
export function advertisingFromSearch(search: string): AdvertisingAttribution | undefined {
  const query = new URLSearchParams(search);
  if (["utm_source","utm_medium","utm_campaign","utm_id","utm_content","utm_term"].some(key => query.getAll(key).length > 1)) return undefined;
  const campaign = query.get("utm_campaign") || "";
  const approved = approvedAdvertising(campaign, query.get("utm_content") || undefined, query.get("utm_term") || undefined);
  if (!approved) return undefined;
  const entry = launchAdvertising[campaign];
  const source = query.get("utm_source")?.toLowerCase();
  const medium = query.get("utm_medium")?.toLowerCase().replace(/[ -]+/g, "_");
  if (!(entry.source === source || entry.source === "facebook" && source === "fb" || entry.source === "google" && source === "google_ads") || entry.medium !== medium) return undefined;
  // A conflicting explicit ID must never be silently mapped to another campaign.
  if (query.has("utm_id") && query.get("utm_id") !== entry.id) return undefined;
  return approved;
}
export function validAdvertising(value: unknown): value is AdvertisingAttribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (typeof input.campaign !== "string" || typeof input.campaignId !== "string" || input.content !== undefined && typeof input.content !== "string" || input.term !== undefined && typeof input.term !== "string") return false;
  const approved = approvedAdvertising(input.campaign, input.content as string | undefined, input.term as string | undefined);
  return !!approved && Object.keys(input).length === Object.keys(approved).length && Object.entries(approved).every(([key, expected]) => input[key] === expected);
}
export function advertisingMatches(value: AdvertisingAttribution, source: string, medium: string) {
  return validAdvertising(value) && launchAdvertising[value.campaign].source === source && launchAdvertising[value.campaign].medium === medium;
}
