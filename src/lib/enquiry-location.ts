import { z } from "zod";

const place = z.string().trim().max(100).refine(value => !/[\u0000-\u001f\u007f]/u.test(value), "Use a place name without control characters.");
export const enquiryLocationInputSchema = z.object({
  city: place.optional(),
  province: place.optional(),
  postalCode: z.string().trim().max(16).regex(/^[\p{L}\p{N} -]*$/u).optional(),
  country: place.optional(),
}).strict();
export type EnquiryLocationInput = z.infer<typeof enquiryLocationInputSchema>;
export const enquiryLocationRecordSchema = enquiryLocationInputSchema.extend({
  version: z.literal(1),
  source: z.enum(["PUBLIC_SELF_REPORTED", "STAFF_RECORDED"]),
  capturedAt: z.iso.datetime(),
}).strict();
export type EnquiryLocationRecord = z.infer<typeof enquiryLocationRecordSchema>;

/** Optional enquiry origin, never a verified billing address or inferred location. */
export function recordEnquiryLocation(input: EnquiryLocationInput | undefined, source: EnquiryLocationRecord["source"], now = new Date()): EnquiryLocationRecord | undefined {
  if (!input) return undefined;
  const parsed = enquiryLocationInputSchema.parse(input);
  const fields = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value));
  if (!Object.keys(fields).length) return undefined;
  return { ...fields, version: 1, source, capturedAt: now.toISOString() };
}

export function readEnquiryLocation(value: unknown): EnquiryLocationRecord | null {
  const parsed = enquiryLocationRecordSchema.safeParse(value);
  return parsed.success && [parsed.data.city, parsed.data.province, parsed.data.postalCode, parsed.data.country].some(Boolean) ? parsed.data : null;
}

export function enquiryLocationReport(leads: { enquiryLocation?: unknown }[]) {
  const rows = (field: keyof EnquiryLocationInput) => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const lead of leads) {
      const label = readEnquiryLocation(lead.enquiryLocation)?.[field] || "Unknown";
      const key = label.toLocaleLowerCase("en-ZA");
      const row = counts.get(key) ?? { label, count: 0 };
      row.count++; counts.set(key, row);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  return { cities: rows("city"), provinces: rows("province"), postalCodes: rows("postalCode"), countries: rows("country") };
}
