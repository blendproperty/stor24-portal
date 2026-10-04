import { z } from "zod";
import { publicJourneyPath } from "./lead-attribution";
export const marketingSources = [
  "google",
  "bing",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube",
  "newsletter",
  "other",
] as const;
export const marketingMedia = [
  "cpc",
  "paid_social",
  "social",
  "email",
  "referral",
  "display",
  "organic",
  "other",
] as const;
const id = z.string().regex(/^c[a-z0-9]{24,32}$/);
const money = z
  .number()
  .finite()
  .min(0)
  .max(999999999.99)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Use cents",
  );
export const campaignSchema = z
  .object({
    kind: z.literal("campaign"),
    submissionId: z.uuid(),
    facilityId: z.string().min(1).max(100),
    name: z.string().trim().min(2).max(100),
    source: z.enum(marketingSources),
    medium: z.enum(marketingMedia),
    budget: money,
    status: z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETE"]),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((v) => !v.endsAt || v.endsAt >= v.startsAt, "End must follow start");
export const linkSchema = z
  .object({
    kind: z.literal("link"),
    submissionId: z.uuid(),
    campaignId: id,
    label: z.string().trim().min(2).max(100),
    landingPage: publicJourneyPath,
    keyword: z.string().trim().max(100).optional(),
  })
  .strict();
export const activitySchema = z
  .object({
    kind: z.literal("activity"),
    submissionId: z.uuid(),
    campaignId: id,
    title: z.string().trim().min(2).max(100),
    activityKind: z.enum([
      "ADVERTISING",
      "SOCIAL",
      "EMAIL",
      "EVENT",
      "PRINT",
      "PARTNERSHIP",
      "CONTENT",
      "OTHER",
    ]),
    occurredAt: z.iso.datetime(),
    spend: money,
    impressions: z.number().int().min(0).max(2147483647),
    clicks: z.number().int().min(0).max(2147483647),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export const marketingInput = z.union([
  campaignSchema,
  linkSchema,
  activitySchema,
]);
export const campaignUpdateSchema = z
  .object({
    campaignId: id,
    version: z.number().int().positive(),
    name: z.string().trim().min(2).max(100),
    budget: money,
    status: z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETE"]),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((v) => !v.endsAt || v.endsAt >= v.startsAt, "End must follow start");
export const activityUpdateSchema = activitySchema
  .omit({ kind: true, submissionId: true, campaignId: true })
  .extend({ activityId: id, version: z.number().int().positive() })
  .strict();
export const marketingUpdate = z.union([
  campaignUpdateSchema,
  activityUpdateSchema,
]);
export function trackedUrl(
  campaign: { id: string; source: string; medium: string },
  link: { id: string; landingPage: string; keyword: string | null },
) {
  const path = publicJourneyPath.parse(link.landingPage);
  const url = new URL(path, "https://stor24.co.za");
  url.searchParams.set("utm_source", campaign.source);
  url.searchParams.set("utm_medium", campaign.medium);
  // Registered opaque identifiers carry campaign/content/term without public customer or free-text data.
  url.searchParams.set("utm_campaign", campaign.id);
  url.searchParams.set("utm_id", campaign.id);
  url.searchParams.set("utm_content", link.id);
  if (link.keyword) url.searchParams.set("utm_term", link.id);
  return url.toString();
}
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return (
    '"' +
    (/^[\s]*[=+@-]/.test(text) ? "'" : "") +
    text.replaceAll('"', '""') +
    '"'
  );
}
