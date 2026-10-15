import { createHash, createHmac, randomUUID, scrypt } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { currentRoleAccess } from "./current-role-access";
import type { RequestScope } from "./scope";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./integrations/integration-secret-vault";
import { staffEmailInput, staffEmailRecipient, staffEmailMessage, staffEmailHash, staffEmailPolicyId, STAFF_EMAIL_POLICY_DOMAIN, STAFF_EMAIL_OUTBOX_DOMAIN, STAFF_EMAIL_TEMPLATE_VERSION } from "./staff-event-email-policy";
import type { StaffOperationalEvent } from "./staff-operational-events";
import { formatSouthAfricaDateTime } from "./south-africa-time";
import { escapeEmailHtml } from "./email";

export type StaffEmailClient = Prisma.TransactionClient;
export const STAFF_EMAIL_VIEW = "staff_event_emails.view", STAFF_EMAIL_MANAGE = "staff_event_emails.manage", STAFF_EMAIL_APPROVE = "staff_event_emails.approve";
const userSelect = { id: true, organisationId: true, name: true, email: true, active: true, roleAssignments: { include: { role: true } } } as const;
export async function staffEmailActor(tx: StaffEmailClient, userId: string, organisationId: string, permission = STAFF_EMAIL_VIEW, facilityId?: string) {
  const actor = await tx.user.findFirst({ where: { id: userId, organisationId, active: true }, select: userSelect });
  if (!actor || ![STAFF_EMAIL_VIEW, "operations.view", permission].every(key => currentRoleAccess(actor.roleAssignments, key, facilityId).allowed)) throw Error("STAFF_EMAIL_FORBIDDEN");
  return actor;
}
export async function staffEmailScope(tx: StaffEmailClient, incoming: RequestScope, permission = STAFF_EMAIL_VIEW): Promise<RequestScope> {
  const actor = await staffEmailActor(tx, incoming.userId, incoming.organisationId, permission);
  let ids: string[] | null = null;
  for (const key of [STAFF_EMAIL_VIEW, "operations.view", permission]) {
    const access = currentRoleAccess(actor.roleAssignments, key).allowedFacilityIds;
    if (access !== null) ids = ids === null ? [...new Set(access)] : ids.filter(id => access.includes(id));
  }
  return { userId: actor.id, organisationId: actor.organisationId, unrestrictedFacilities: ids === null, facilityIds: ids ?? [] };
}
export async function staffEmailRecipients(tx: StaffEmailClient, organisationId: string, facilityId: string, ids?: string[]) {
  const rows = await tx.user.findMany({ where: { organisationId, active: true, ...(ids ? { id: { in: ids } } : {}), roleAssignments: { some: { OR: [{ facilityId }, { facilityId: null }] } } }, select: userSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: ids ? 6 : 501 });
  if (!ids && rows.length > 500) throw Error("STAFF_EMAIL_STAFF_LIMIT");
  const eligible = rows.filter(user => currentRoleAccess(user.roleAssignments, "operations.view", facilityId).allowed && z.email().safeParse(user.email).success).map(user => ({ id: user.id, name: user.name, email: user.email.trim().toLowerCase() })).sort((a, b) => a.id.localeCompare(b.id));
  if (ids && (eligible.length !== ids.length || !ids.every(id => eligible.some(user => user.id === id)))) throw Error("STAFF_EMAIL_RECIPIENT_FORBIDDEN");
  return eligible;
}
export const staffEmailDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function staffEmailMac(value: unknown) {
  const secret = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw Error("STAFF_EMAIL_ENCRYPTION_REQUIRED");
  return createHmac("sha256", createHash("sha256").update(`staff-event-email-v1:${secret}`).digest()).update(JSON.stringify(value)).digest("hex");
}
export async function staffEmailSender() {
  const provider = process.env.EMAIL_PROVIDER === "resend" ? "Resend" : process.env.EMAIL_PROVIDER === "sendgrid" ? "SendGrid" : process.env.EMAIL_PROVIDER === "twilio" || process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? "Twilio email" : "Not configured";
  // Bind credential rotation without storing credentials or hashing them with a fast digest.
  // Async memory-hard derivation also avoids blocking the request event loop.
  const material = JSON.stringify([process.env.TWILIO_ACCOUNT_SID ?? "", process.env.TWILIO_AUTH_TOKEN ?? "", process.env.RESEND_API_KEY ?? "", process.env.SENDGRID_API_KEY ?? ""]);
  const salt = staffEmailMac(["sender-credential-derivation", STAFF_EMAIL_TEMPLATE_VERSION]);
  const derived = await new Promise<Buffer>((resolve, reject) => scrypt(material, salt, 32, { N: 16384, r: 8, p: 1 }, (error, value) => error ? reject(error) : resolve(value)));
  return { label: provider, fingerprint: staffEmailMac([STAFF_EMAIL_TEMPLATE_VERSION, process.env.EMAIL_PROVIDER ?? "", process.env.EMAIL_FROM ?? "", process.env.TWILIO_EMAIL_FROM ?? "", derived.toString("hex")]) };
}
const policyState = z.object({
  kind: z.literal("POLICY"), version: z.literal(1), revision: z.uuid(), requestKey: z.uuid(), input: staffEmailInput,
  facility: z.string(), sender: z.string(), senderFingerprint: staffEmailHash, recipients: z.array(staffEmailRecipient).min(1).max(5), policyFingerprint: staffEmailHash,
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "CANCELLED"]), createdById: z.cuid(), createdByName: z.string(),
  reviewedById: z.cuid().nullable(), reviewedByName: z.string().nullable(), reviewedAt: z.iso.datetime().nullable(), reference: z.string().nullable(),
  scanCursor: z.string().max(1600).nullable(), lastScannedAt: z.iso.datetime().nullable(),
}).strict();
export type StaffEmailPolicyState = z.infer<typeof policyState>;
const outboxState = z.object({
  kind: z.literal("OUTBOX"), version: z.literal(1), policyId: staffEmailPolicyId, policyFingerprint: staffEmailHash,
  status: z.enum(["HELD_ACTIVATION", "SENDING", "ACCEPTED", "REVIEW_REQUIRED", "BLOCKED_SOURCE", "CANCELLED"]),
  sourceKey: z.string().max(130), sourceHash: staffEmailHash, eventAt: z.iso.datetime(), sourceFingerprint: staffEmailHash,
  recipient: staffEmailRecipient, message: staffEmailMessage, messageFingerprint: staffEmailHash,
  attemptedAt: z.iso.datetime().nullable(), acceptedAt: z.iso.datetime().nullable(), failureCode: z.string().max(100).nullable(),
}).strict();
export type StaffEmailOutboxState = z.infer<typeof outboxState>;
export type StaffEmailState = StaffEmailPolicyState | StaffEmailOutboxState;
export type StaffEmailRecord = { id: string; organisationId: string; facilityId: string | null; domain: string; status: string; config: Prisma.JsonValue; createdAt: Date; updatedAt: Date };
const frameSchema = z.object({ id: z.string(), organisationId: z.string(), facilityId: z.string(), value: z.discriminatedUnion("kind", [policyState, outboxState]) }).strict();
const configSchema = z.object({ version: z.literal(1), encrypted: z.string(), integrity: staffEmailHash, policyId: z.string(), policyFingerprint: staffEmailHash }).strict();
export function staffEmailDecode(row: StaffEmailRecord) {
  const config = configSchema.parse(row.config), frame = frameSchema.parse(JSON.parse(decryptIntegrationSecret(config.encrypted)));
  if (frame.id !== row.id || frame.organisationId !== row.organisationId || frame.facilityId !== row.facilityId || frame.value.status !== row.status || staffEmailMac(frame) !== config.integrity || (frame.value.kind === "POLICY" ? row.domain !== STAFF_EMAIL_POLICY_DOMAIN || config.policyId !== row.id : row.domain !== STAFF_EMAIL_OUTBOX_DOMAIN || config.policyId !== frame.value.policyId) || config.policyFingerprint !== frame.value.policyFingerprint) throw Error("STAFF_EMAIL_INTEGRITY");
  if (frame.value.kind === "POLICY" && (frame.value.input.facilityId !== row.facilityId || frame.value.policyFingerprint !== staffEmailMac([row.id, row.organisationId, row.facilityId, frame.value.input, frame.value.facility, frame.value.recipients, frame.value.senderFingerprint, STAFF_EMAIL_TEMPLATE_VERSION]) || row.status === "APPROVED" && (!frame.value.reviewedById || frame.value.reviewedById === frame.value.createdById || !frame.value.reviewedAt || !frame.value.reference))) throw Error("STAFF_EMAIL_INTEGRITY");
  if (frame.value.kind === "OUTBOX" && (staffEmailDigest(frame.value.message) !== frame.value.messageFingerprint || frame.value.message.to !== frame.value.recipient.email || row.id !== staffEmailOutboxKey(row.organisationId, row.facilityId!, frame.value.sourceKey, frame.value.recipient.id))) throw Error("STAFF_EMAIL_INTEGRITY");
  return frame.value;
}
export async function staffEmailStore(tx: StaffEmailClient, row: { id: string; organisationId: string; facilityId: string; domain: string; name: string }, value: StaffEmailState, exists: boolean) {
  const frame = { id: row.id, organisationId: row.organisationId, facilityId: row.facilityId, value };
  const data = { status: value.status, config: { version: 1, encrypted: encryptIntegrationSecret(JSON.stringify(frame)), integrity: staffEmailMac(frame), policyId: value.kind === "POLICY" ? row.id : value.policyId, policyFingerprint: value.policyFingerprint } };
  return exists ? tx.configurationProfile.update({ where: { id: row.id }, data }) : tx.configurationProfile.create({ data: { ...row, name: row.id, ...data } });
}
export const staffEmailPolicyKey = (requestKey: string) => `staff-event-email-policy:${z.uuid().parse(requestKey)}`;
export const staffEmailOutboxKey = (org: string, facility: string, source: string, recipient: string) => `staff-event-email:${staffEmailDigest([org, facility, source, recipient])}`;
export function staffEmailSourceFingerprint(event: StaffOperationalEvent) { return staffEmailDigest([event.sourceKey, event.sourceHash, event.at, event.customerId, event.customer, event.facilityId, event.facility, event.unit]); }
export function staffEmailRender(event: StaffOperationalEvent, recipient: z.infer<typeof staffEmailRecipient>) {
  const subject = `STOR24: ${event.kind.replaceAll("_", " ")} · ${event.facility}`;
  const text = [`STOR24 staff event`, `Event: ${event.kind.replaceAll("_", " ")}`, `Store: ${event.facility}`, `Recorded: ${formatSouthAfricaDateTime(event.at)} SAST`, `Customer: ${event.customer}`, `Unit: ${event.unit ?? "Not recorded"}`, "", "Open the signed-in booking and move-in event inbox to review the current source and readiness.", "https://portal.stor24.co.za/operations/events", "", "This is a recorded event, not confirmation of payment, readiness, physical access or a new approval."].join("\n");
  return { to: recipient.email, subject, text, html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeEmailHtml(text)}</div>` };
}
export async function staffEmailLock(tx: StaffEmailClient, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-event-email:${key}`}, 0))`; }
/** Only proven rolled-back serialization failures repeat. Callbacks must contain database work only. */
export async function staffEmailTransaction<T>(callback: (tx: StaffEmailClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(callback, { isolationLevel: "Serializable", timeout: 15000 }); }
    catch (failure) { if (attempt >= 2 || !failure || typeof failure !== "object" || !("code" in failure) || failure.code !== "P2034") throw failure; }
  }
}
export function freshStaffEmailRevision() { return randomUUID(); }
