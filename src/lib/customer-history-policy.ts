import { z } from "zod";

export const noteCategories = {
  GENERAL: "General",
  CALL: "Phone call",
  CUSTOMER_MESSAGE: "Customer message",
  PAYMENT_FOLLOW_UP: "Payment follow-up",
  MOVE_IN: "Move-in",
  MOVE_OUT: "Move-out request",
  COMPLAINT: "Complaint",
  HANDOVER: "Staff handover",
} as const;
export const noteCategorySchema = z.enum(Object.keys(noteCategories) as [keyof typeof noteCategories, ...Array<keyof typeof noteCategories>]);
export const customerNoteSchema = z.object({
  facilityId: z.string().min(1).max(100),
  requestKey: z.string().uuid(),
  category: noteCategorySchema,
  body: z.string().trim().min(1).max(5000),
}).strict();
export type CustomerNoteInput = z.infer<typeof customerNoteSchema>;
export const historyQuerySchema = z.object({
  kind: z.enum(["ALL", "NOTE", "COLLECTION", "COMMUNICATION"]).default("ALL"),
  category: noteCategorySchema.optional(),
  search: z.string().trim().max(200).default(""),
  cursor: z.string().max(1000).optional(),
});
export const historyExportSchema = historyQuerySchema.omit({cursor:true}).extend({format:z.enum(["PDF","CSV"]),entryId:z.string().min(1).max(100).optional(),entryKind:z.enum(["NOTE","COLLECTION","COMMUNICATION"]).optional()}).strict().refine(q=>!!q.entryId===!!q.entryKind);
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export const historyCursorSchema = z.object({
  at: z.iso.datetime(),
  kind: z.enum(["NOTE", "COLLECTION", "COMMUNICATION"]),
  id: z.string().min(1).max(100),
  snapshot: z.iso.datetime(),
}).strict();
export type HistoryCursor = z.infer<typeof historyCursorSchema>;
export function decodeHistoryCursor(value?: string): HistoryCursor | null {
  if (!value) return null;
  try { return historyCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); }
  catch { throw new Error("HISTORY_CURSOR_INVALID"); }
}
export function encodeHistoryCursor(value: HistoryCursor) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export type HistoryEntry = {
  id: string; kind: "NOTE" | "COLLECTION" | "COMMUNICATION"; at: string;
  title: string; body: string | null; category: string | null; author: string | null;
  facility: string | null; channel: string | null; status: string | null;
  sentAt: string | null; deliveredAt: string | null; readAt: string | null;
};
export function compareHistoryEntries(a: HistoryEntry, b: HistoryEntry) {
  return b.at.localeCompare(a.at) || b.kind.localeCompare(a.kind) || b.id.localeCompare(a.id);
}
export const historyReadSchema = z.object({ data: z.object({
  entries: z.array(z.object({
    id: z.string().min(1), kind: z.enum(["NOTE", "COLLECTION", "COMMUNICATION"]), at: z.iso.datetime(),
    title: z.string(), body: z.string().nullable(), category: z.string().nullable(), author: z.string().nullable(),
    facility: z.string().nullable(), channel: z.string().nullable(), status: z.string().nullable(),
    sentAt: z.iso.datetime().nullable(), deliveredAt: z.iso.datetime().nullable(), readAt: z.iso.datetime().nullable(),
  })),
  nextCursor: z.string().nullable(),
  facilities: z.array(z.object({ id: z.string(), name: z.string() })),
  writableFacilities: z.array(z.object({ id: z.string(), name: z.string() })),
  visibility: z.object({ communications: z.boolean(), collections: z.boolean() }),
  legacyNotes: z.string().nullable(),
  canExport: z.boolean().optional(),
}) });
export type CustomerHistoryRead = z.infer<typeof historyReadSchema>["data"];
