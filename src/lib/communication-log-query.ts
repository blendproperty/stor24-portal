import { z } from "zod";
import { historyDateRange } from "./customer-history-policy";

const optionalId = z.union([z.literal(""), z.cuid()]).default("");
const date = z.union([z.literal(""), z.iso.date()]).default("");
export const communicationFiltersSchema = z.object({
  search: z.string().trim().max(200).default("").refine(value => value.split(/\s+/).length <= 20, "Use a shorter customer search."),
  from: date, to: date, channel: z.enum(["", "EMAIL", "SMS", "WHATSAPP"]).default(""),
  status: z.enum(["", "PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "DEAD_LETTER"]).default(""),
  facilityId: optionalId, customerId: optionalId,
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, "The from date must be before or equal to the to date.");
export type CommunicationFilters = z.infer<typeof communicationFiltersSchema>;
export const emptyCommunicationFilters: CommunicationFilters = { search: "", from: "", to: "", channel: "", status: "", facilityId: "", customerId: "" };
export function communicationDateRange(filters: CommunicationFilters) {
  return historyDateRange({ from: filters.from || undefined, to: filters.to || undefined });
}
export function readCommunicationQuery(params: URLSearchParams) {
  if (params.toString().length > 4000) throw Error("COMMUNICATION_FILTER_INVALID");
  const entries = new Map<string, string>();
  for (const [key, value] of params) { if (entries.has(key)) throw Error("COMMUNICATION_FILTER_INVALID"); entries.set(key, value); }
  const cursor = entries.get("cursor") ?? ""; entries.delete("cursor");
  if (cursor.length > 1800) throw Error("COMMUNICATION_CURSOR_INVALID");
  const filters = communicationFiltersSchema.safeParse(Object.fromEntries(entries));
  if (!filters.success) throw Error("COMMUNICATION_FILTER_INVALID");
  return { filters: filters.data, cursor };
}
const nullableDate = z.iso.datetime().nullable();
export const communicationLogReadSchema = z.object({ data: z.object({
  rows: z.array(z.object({
    id: z.cuid(), customerId: z.cuid().nullable(), customerName: z.string().max(5000), canOpenCustomer: z.boolean(),
    facilityName: z.string().max(5000), channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
    messageType: z.string().max(5000).nullable(), direction: z.enum(["INBOUND", "OUTBOUND", "UNKNOWN"]),
    status: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "DEAD_LETTER"]),
    queuedAt: z.iso.datetime(), sentAt: nullableDate, deliveredAt: nullableDate, readAt: nullableDate,
    failureCode: z.string().max(100).nullable(), canRetryWhatsApp: z.boolean(),
  })).max(25),
  facilities: z.array(z.object({ id: z.cuid(), name: z.string().max(5000) })).max(1000),
  filters: communicationFiltersSchema, snapshotAt: z.iso.datetime(), nextCursor: z.string().max(1800).nullable(),
}) });
export type CommunicationLogRead = z.infer<typeof communicationLogReadSchema>["data"];
