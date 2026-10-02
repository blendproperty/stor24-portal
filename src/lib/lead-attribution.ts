import { z } from "zod";

// Only public, non-identifying paths may be attached to an enquiry. Never store URL queries or signing/account routes.
export const publicJourneyPath = z.string().max(120).refine(value => /^\/(?:|book|contact|personal-storage|business-storage|student-storage|moving-storage|storage-unit-sizes|faq|terms|paia|privacy|space-guide|storage\/(?:midpoint|melrose)|blog(?:\/[a-z0-9-]+)?|storage-insights(?:\/[a-z0-9-]+)?)$/.test(value), "Public page required");
export const leadAttributionSchema = z.object({
  version: z.literal(1), consent: z.literal("granted"),
  landingPage: publicJourneyPath, conversionPage: publicJourneyPath,
  pages: z.array(publicJourneyPath).min(1).max(12),
  source: z.enum(["direct", "google", "bing", "facebook", "instagram", "linkedin", "newsletter", "other"]),
  medium: z.enum(["direct", "organic", "cpc", "social", "email", "referral", "display", "other"]),
}).strict();
export type LeadAttribution = z.infer<typeof leadAttributionSchema>;
