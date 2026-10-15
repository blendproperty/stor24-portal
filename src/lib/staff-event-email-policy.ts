import { z } from "zod";
import { eventKinds } from "./staff-attention-policy";

export const STAFF_EMAIL_POLICY_DOMAIN = "STAFF_EVENT_EMAIL_POLICY";
export const STAFF_EMAIL_OUTBOX_DOMAIN = "STAFF_EVENT_EMAIL_OUTBOX";
export const STAFF_EMAIL_TEMPLATE_VERSION = 1;
export const staffEmailPolicyId = z.string().regex(/^staff-event-email-policy:[a-f0-9-]{36}$/);
export const staffEmailOutboxId = z.string().regex(/^staff-event-email:[a-f0-9]{64}$/);
export const staffEmailHash = z.string().regex(/^[a-f0-9]{64}$/);
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/).refine(value => z.iso.date().safeParse(value.slice(0, 10)).success, "Choose a valid South African date and time.");
export function staffEmailSastTime(value: string) { return new Date(`${localTime.parse(value)}:00+02:00`); }
export const staffEmailInput = z.object({
  facilityId: z.cuid(), label: z.string().trim().min(3).max(120),
  recipientIds: z.array(z.cuid()).min(1).max(5).refine(ids => new Set(ids).size === ids.length).transform(ids => ids.toSorted()),
  kinds: z.array(z.enum(eventKinds)).min(1).max(4).refine(kinds => new Set(kinds).size === kinds.length).transform(kinds => kinds.toSorted()),
  from: z.iso.date(), to: z.iso.date(), notBefore: localTime, expires: localTime,
}).strict().superRefine((value, ctx) => {
  if (!localTime.safeParse(value.notBefore).success || !localTime.safeParse(value.expires).success) return;
  const days = (new Date(value.to).getTime() - new Date(value.from).getTime()) / 86400000;
  if (days < 0 || days > 31) ctx.addIssue({ code: "custom", message: "Choose up to32 complete South African source days." });
  const start = staffEmailSastTime(value.notBefore), end = staffEmailSastTime(value.expires);
  if (end <= start || end.getTime() - start.getTime() > 32 * 86400000) ctx.addIssue({ code: "custom", message: "Choose a delivery window longer than zero and no longer than32 days." });
  if (new Date(`${value.to}T23:59:59.999+02:00`) > end) ctx.addIssue({ code: "custom", message: "The delivery expiry must cover the complete final source day." });
});
export type StaffEmailInput = z.infer<typeof staffEmailInput>;
const request = { input: staffEmailInput, requestKey: z.uuid() };
export const staffEmailCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ...request }).strict(),
  z.object({ action: z.literal("prepare"), ...request, expectedFingerprint: staffEmailHash }).strict(),
  z.object({ action: z.literal("review"), id: staffEmailPolicyId, revision: z.uuid(), decision: z.enum(["APPROVE", "REJECT", "CANCEL"]), reference: z.string().trim().min(3).max(240) }).strict(),
  z.object({ action: z.literal("evaluate"), id: staffEmailPolicyId, revision: z.uuid() }).strict(),
]);
export const staffEmailQuery = z.object({ facilityId: z.union([z.cuid(), z.literal("")]).default(""), policyId: z.union([staffEmailPolicyId, z.literal("")]).default(""), cursor: z.string().max(1600).default(""), outboxCursor: z.string().max(1600).default("") }).strict();
export const staffEmailRecipient = z.object({ id: z.cuid(), name: z.string().max(5000), email: z.email().max(320) }).strict();
export const staffEmailMessage = z.object({ to: z.email(), subject: z.string().max(5000), text: z.string().max(15000), html: z.string().max(30000) }).strict();
export const staffEmailPreview = z.object({ requestKey: z.uuid(), input: staffEmailInput, facility: z.string().max(5000), sender: z.string(), recipients: z.array(staffEmailRecipient).min(1).max(5), examples: z.array(z.object({ sourceKey: z.string().max(130), sourceHash: staffEmailHash, at: z.iso.datetime(), subject: z.string().max(5000), text: z.string().max(15000) })).max(10), moreSourcePages: z.boolean(), policyFingerprint: staffEmailHash, previewFingerprint: staffEmailHash }).strict();
export type StaffEmailPreview = z.infer<typeof staffEmailPreview>;
export const staffEmailPolicyView = z.object({ id: staffEmailPolicyId, revision: z.uuid(), label: z.string(), status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "CANCELLED"]), facilityId: z.cuid(), facility: z.string(), createdAt: z.iso.datetime(), createdByName: z.string(), createdById: z.cuid(), reviewedAt: z.iso.datetime().nullable(), reviewedByName: z.string().nullable(), reference: z.string().nullable(), input: staffEmailInput, recipients: z.array(staffEmailRecipient).max(5), policyFingerprint: staffEmailHash, authorityCurrent: z.boolean(), blockers: z.array(z.string()), activationConfigured: z.boolean(), canReview: z.boolean(), canCancel: z.boolean(), scanMore: z.boolean() });
export const staffEmailOutboxView = z.object({ id: staffEmailOutboxId, policyId: staffEmailPolicyId, status: z.enum(["HELD_ACTIVATION", "SENDING", "ACCEPTED", "REVIEW_REQUIRED", "BLOCKED_SOURCE", "CANCELLED"]), sourceKey: z.string(), eventAt: z.iso.datetime(), queuedAt: z.iso.datetime(), recipient: staffEmailRecipient, subject: z.string(), text: z.string(), failureCode: z.string().nullable(), attemptedAt: z.iso.datetime().nullable(), acceptedAt: z.iso.datetime().nullable() });
export const staffEmailRead = z.object({ data: z.object({ facilities: z.array(z.object({ id: z.cuid(), name: z.string() })), staff: z.array(staffEmailRecipient), policies: z.array(staffEmailPolicyView).max(25), selectedPolicy: staffEmailPolicyView.nullable(), outbox: z.array(staffEmailOutboxView).max(25), nextCursor: z.string().nullable(), nextOutboxCursor: z.string().nullable(), selectedFacilityId: z.string(), selectedPolicyId: z.string(), capabilities: z.object({ canManage: z.boolean(), canApprove: z.boolean() }), sendingEnabled: z.boolean() }) });
export type StaffEmailRead = z.infer<typeof staffEmailRead>["data"];
