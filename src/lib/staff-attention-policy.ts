import { z } from "zod";
import { dateKey } from "@/lib/collections-policy";

export const eventKinds = ["BOOKING", "SIGNED", "MOVE_IN_STARTED", "HANDED_OVER"] as const;
export type EventKind = typeof eventKinds[number];
export const eventLabels: Record<EventKind, string> = { BOOKING: "Booking created", SIGNED: "Agreement signed", MOVE_IN_STARTED: "Move-in started", HANDED_OVER: "Key handover recorded" };
const cursorSchema = z.object({ at: z.iso.datetime(), kind: z.enum(eventKinds), id: z.string().min(1).max(100), snapshot: z.iso.datetime() }).strict();
export type EventCursor = z.infer<typeof cursorSchema>;
export function decodeEventCursor(value?: string): EventCursor | null {
  if (!value) return null;
  try { return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); } catch { throw new Error("CONFLICT"); }
}
export function encodeEventCursor(value: EventCursor) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export const eventQuerySchema = z.object({ cursor: z.string().max(1000).optional() }).strict();
export const eventAcknowledgeSchema = z.object({ sourceKey: z.string().regex(/^(BOOKING|SIGNED|MOVE_IN_STARTED|HANDED_OVER):[A-Za-z0-9_-]{1,100}$/), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export const arrivalQuerySchema = z.object({ from: dateKey, to: dateKey, facilityId: z.string().cuid().optional(), cursor: z.string().max(100).optional() }).strict().refine(q => { const days = (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86400000; return days >= 0 && days <= 31; }, "Choose a period of up to32days.");
export const arrivalChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ASSIGN"), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: z.number().int().min(0).nullable(), ownerId: z.string().cuid(), coverId: z.string().cuid().nullable(), notes: z.string().trim().min(2).max(3000) }).strict(),
  z.object({ action: z.literal("ACKNOWLEDGE"), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: z.number().int().min(0) }).strict(),
]);
