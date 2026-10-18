import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import type { RequestScope } from "./scope";
import { arrearsAuthority } from "./arrears-authority";
import { collectionPhoneSource } from "./collections-service";
import { phoneCommand, phonePayload, smsPayload, approvedWhatsAppPayload, type PhonePayload } from "./collection-phone-policy";
import { noticeHash } from "./collection-notice-policy";
import { southAfricaDateKey } from "./south-africa-time";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "./integrations/integration-secret-vault";
import { boundedBody } from "./payments/netcash-mandate";
import { privacyHash } from "./request-security";
import { historyEvidence } from "./customer-history-message-policy";
import { guardDlpTransfer } from "./dlp-transfer-service";
import { TwilioSmsProvider, TwilioWhatsAppProvider } from "./integrations/twilio-provider";

export const COLLECTION_PHONE_DOMAIN = "COLLECTION_PHONE_NOTICE";
const permissions = ["collections.view", "collections.manage"];
const status = z.enum(["DRAFT", "APPROVED", "SENDING", "ACCEPTED", "REVIEW_REQUIRED", "CANCELLED"]);
const stored = z.object({ id: z.string(), organisationId: z.cuid(), facilityId: z.cuid(), accountId: z.cuid(), channel: z.enum(["SMS", "WHATSAPP"]), asOf: z.iso.date(), revision: z.uuid(), status, fingerprint: z.string(), payload: phonePayload, contributors: z.array(z.cuid()).min(1).max(64), creatorId: z.cuid(), approvedBy: z.cuid().nullable(), approvedAt: z.iso.datetime().nullable(), reference: z.string().nullable() }).strict();
type Stored = z.infer<typeof stored>;
type Tx = Prisma.TransactionClient;
type Source = Awaited<ReturnType<typeof collectionPhoneSource>>;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const idFor = (org: string, account: string, channel: string, day: string) => `collection-phone:${noticeHash([org, account, channel, day])}`;
function mac(encrypted: string) {
  const key = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim(); if (!key || key.length < 32) throw Error("COLLECTION_PHONE_CONFIG");
  return createHmac("sha256", key).update("collection-phone-v1:" + encrypted).digest("hex");
}
async function load(tx: Tx, scope: RequestScope, id: string) {
  const row = await tx.configurationProfile.findFirst({ where: { id, organisationId: scope.organisationId, domain: COLLECTION_PHONE_DOMAIN } });
  if (!row) return null;
  const envelope = z.object({ version: z.literal(1), encrypted: z.string().max(32768), integrity: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(row.config);
  if (!timingSafeEqual(Buffer.from(envelope.integrity), Buffer.from(mac(envelope.encrypted)))) throw Error("COLLECTION_PHONE_INTEGRITY");
  const state = stored.parse(JSON.parse(decryptIntegrationSecret(envelope.encrypted)));
  if (state.id !== row.id || state.organisationId !== row.organisationId || state.facilityId !== row.facilityId || state.status !== row.status || state.payload.channel !== state.channel || state.id !== idFor(state.organisationId, state.accountId, state.channel, state.asOf)) throw Error("COLLECTION_PHONE_INTEGRITY");
  if (["APPROVED", "SENDING", "ACCEPTED", "REVIEW_REQUIRED"].includes(state.status) && (!state.approvedBy || !state.approvedAt || !state.reference || state.contributors.includes(state.approvedBy))) throw Error("COLLECTION_PHONE_INTEGRITY");
  await arrearsAuthority(tx, scope, state.facilityId, ["collections.view"]);
  return state;
}
async function save(tx: Tx, state: Stored, existing: boolean) {
  const value = stored.parse(state), encrypted = encryptIntegrationSecret(JSON.stringify(value));
  const data = { facilityId: value.facilityId, status: value.status, config: { version: 1, encrypted, integrity: mac(encrypted) } };
  if (existing) await tx.configurationProfile.update({ where: { id: value.id }, data });
  else await tx.configurationProfile.create({ data: { id: value.id, organisationId: value.organisationId, domain: COLLECTION_PHONE_DOMAIN, name: value.id, ...data } });
}
export function phoneSendConfigured(channel: "SMS" | "WHATSAPP", organisationId: string) {
  return process.env.ARREARS_PHONE_ORGANISATION_ID === organisationId && process.env[channel === "SMS" ? "ARREARS_SMS_ENABLED" : "ARREARS_WHATSAPP_ENABLED"] === "true" && (channel !== "WHATSAPP" || process.env.WHATSAPP_AUTOMATION_ENABLED === "true") && !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env[channel === "SMS" ? "TWILIO_SMS_FROM" : "TWILIO_WHATSAPP_FROM"];
}
async function sendEnabled(tx: Tx, channel: "SMS" | "WHATSAPP", organisationId: string) {
  if (!phoneSendConfigured(channel, organisationId)) return false;
  if (channel === "SMS") return true;
  const connection = await tx.integrationConnection.findFirst({ where: { organisationId, facilityId: null, category: "MESSAGING", provider: "TWILIO_WHATSAPP" }, orderBy: { createdAt: "asc" }, select: { config: true } });
  return (connection?.config as { automationEnabled?: boolean } | null)?.automationEnabled === true;
}
async function payloadFor(source: Source): Promise<PhonePayload> {
  if (source.channel === "SMS") return smsPayload(source);
  const sid = process.env.ARREARS_WHATSAPP_CONTENT_SID ?? "", mapping = process.env.ARREARS_WHATSAPP_VARIABLE_MAP;
  const account = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  if (!/^HX[a-f0-9]{32}$/i.test(sid) || !account || !token || !mapping || process.env.ARREARS_PHONE_ORGANISATION_ID === undefined) throw Error("COLLECTION_PHONE_TEMPLATE");
  const get = async (suffix: string) => {
    const response = await fetch(`https://content.twilio.com/v1/Content/${sid}${suffix}`, { headers: { authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}` }, signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "error" });
    if (!response.ok) throw Error("COLLECTION_PHONE_TEMPLATE");
    return JSON.parse((await boundedBody(response, 64_000)).toString());
  };
  const [content, approval] = await Promise.all([get(""), get("/ApprovalRequests")]);
  return approvedWhatsAppPayload(source, content, approval, JSON.parse(mapping), account, sid);
}
async function previewParts(scope: RequestScope, accountId: string, channel: "SMS" | "WHATSAPP") {
  const source = await collectionPhoneSource(db, scope, accountId, channel);
  await arrearsAuthority(db, scope, source.facilityId, ["collections.view"]);
  let payload: PhonePayload | null = null;
  const blockers = [...source.blockers];
  try {
    if (channel === "WHATSAPP" && process.env.ARREARS_PHONE_ORGANISATION_ID !== scope.organisationId) throw Error("COLLECTION_PHONE_TEMPLATE");
    payload = await payloadFor(source);
  } catch { blockers.push(channel === "WHATSAPP" ? "An approved utility text template and its reviewed variable mapping must be configured for this organisation." : "The verified phone number and reminder text need review."); }
  return { source, payload, blockers };
}
export async function previewPhoneNotice(scope: RequestScope, accountId: string, channel: "SMS" | "WHATSAPP") {
  const { source, payload, blockers } = await previewParts(scope, accountId, channel), id = idFor(scope.organisationId, accountId, channel, source.asOf);
  const state = await load(db, scope, id);
  const sourceCurrent = !!state && !blockers.length && state.fingerprint === source.fingerprint && noticeHash(state.payload) === noticeHash(payload);
  let canManage = false, canSend = false;
  try { await arrearsAuthority(db, scope, source.facilityId, permissions); canManage = true; } catch { /* viewer */ }
  try { await arrearsAuthority(db, scope, source.facilityId, [...permissions, "billing.documents.send"]); canSend = true; } catch { /* no dispatch authority */ }
  return { source, message: payload, blockers, notice: state ? { id: state.id, revision: state.revision, status: state.status, ...state.payload, approvedAt: state.approvedAt, reference: state.reference, canApprove: !state.contributors.includes(scope.userId), sourceCurrent } : null, canManage, canSend, sendConfigured: await sendEnabled(db, channel, scope.organisationId), deliveryVerified: false };
}
async function record(tx: Tx, scope: RequestScope, state: Stored, action: string) {
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: state.facilityId, actorId: scope.userId, entityType: "ConfigurationProfile", entityId: state.id, action: `collection.phone.${action}`, after: { revision: state.revision, status: state.status, channel: state.channel, payloadHash: noticeHash(state.payload), financialApproval: false, accessApproval: false } } });
  const c = await tx.collectionCase.findUnique({ where: { accountId: state.accountId }, select: { id: true } });
  if (c) await tx.collectionActivity.create({ data: { caseId: c.id, actorId: scope.userId, requestKey: `phone:${noticeHash([state.id, state.revision, action])}`, action: `${state.channel} reminder · ${action}`, note: "Recorded reviewed reminder workflow. Provider acceptance is separate from delivery; no fee or access action is authorised.", payload: { noticeId: state.id, status: state.status, payloadHash: noticeHash(state.payload) } } });
}
export async function actPhoneNotice(scope: RequestScope, raw: unknown) {
  const command = phoneCommand.parse(raw), fresh = await previewParts(scope, command.accountId, command.channel);
  const id = idFor(scope.organisationId, command.accountId, command.channel, fresh.source.asOf);
  if ("id" in command && command.id !== id) throw Error("COLLECTION_PHONE_CHANGED");
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${command.accountId} FOR UPDATE`;
    const source = await collectionPhoneSource(tx, scope, command.accountId, command.channel);
    await arrearsAuthority(tx, scope, source.facilityId, permissions);
    const old = await load(tx, scope, id);
    if (command.action === "send" && old && ["SENDING", "ACCEPTED", "REVIEW_REQUIRED"].includes(old.status)) return { attempted: false as const, state: old };
    if (command.action !== "prepare" && (!old || old.revision !== command.revision || command.id !== id)) throw Error("COLLECTION_PHONE_CHANGED");
    if (command.action === "cancel") {
      if (!old || !["DRAFT", "APPROVED"].includes(old.status) || !command.reference) throw Error("COLLECTION_PHONE_STAGE");
      const next = { ...old, status: "CANCELLED" as const, revision: randomUUID(), reference: command.reference, approvedAt: null, approvedBy: null };
      await save(tx, next, true); await record(tx, scope, next, "cancelled"); return { attempted: false as const, state: next };
    }
    if (source.fingerprint !== fresh.source.fingerprint || source.asOf !== southAfricaDateKey(new Date()) || fresh.blockers.length || !fresh.payload) throw Error("COLLECTION_PHONE_HOLD");
    if (command.action === "prepare") {
      if (command.fingerprint !== source.fingerprint || old && !["DRAFT", "CANCELLED"].includes(old.status)) throw Error("COLLECTION_PHONE_STAGE");
      if (old?.status === "DRAFT" && old.fingerprint === source.fingerprint && noticeHash(old.payload) === noticeHash(fresh.payload)) return { attempted: false as const, state: old };
      const next: Stored = { id, organisationId: scope.organisationId, facilityId: source.facilityId, accountId: source.accountId, channel: command.channel, asOf: source.asOf, revision: randomUUID(), status: "DRAFT", fingerprint: source.fingerprint, payload: fresh.payload, contributors: [...new Set([...(old?.contributors ?? []), scope.userId])], creatorId: scope.userId, approvedBy: null, approvedAt: null, reference: null };
      await save(tx, next, !!old); await record(tx, scope, next, "prepared"); return { attempted: false as const, state: next };
    }
    if (!old || old.fingerprint !== source.fingerprint || noticeHash(old.payload) !== noticeHash(fresh.payload)) throw Error("COLLECTION_PHONE_CHANGED");
    await arrearsAuthority(tx, scope, source.facilityId, permissions, old.creatorId);
    if (command.action === "approve") {
      if (old.status !== "DRAFT" || old.contributors.includes(scope.userId) || !command.reference) throw Error("COLLECTION_PHONE_APPROVAL");
      const next: Stored = { ...old, status: "APPROVED", revision: randomUUID(), approvedBy: scope.userId, approvedAt: new Date().toISOString(), reference: command.reference };
      await save(tx, next, true); await record(tx, scope, next, "approved"); return { attempted: false as const, state: next };
    }
    if (command.action !== "send" || old.status !== "APPROVED" || !old.approvedBy || !command.confirm || !await sendEnabled(tx, command.channel, scope.organisationId)) throw Error("COLLECTION_PHONE_STAGE");
    await arrearsAuthority(tx, scope, source.facilityId, [...permissions, "billing.documents.send"]);
    await arrearsAuthority(tx, scope, source.facilityId, permissions, old.approvedBy);
    const state: Stored = { ...old, status: "SENDING" };
    await save(tx, state, true);
    await tx.communicationLog.create({ data: { organisationId: scope.organisationId, facilityId: source.facilityId, customerId: source.customerId, channel: command.channel, direction: "OUTBOUND", messageType: "COLLECTION_REMINDER", recipientHash: privacyHash(state.payload.recipient), provider: "twilio", status: "PENDING", attempts: 1, nextRetryAt: null, idempotencyKey: id, metadata: json({ noticeId: id, sourceFingerprint: state.fingerprint, payloadHash: noticeHash(state.payload), templateHash: state.payload.templateHash, historyEvidence: historyEvidence(state.payload), deliveryOutcome: "IN_PROGRESS" }) } });
    await record(tx, scope, state, "send_claimed"); return { attempted: true as const, state };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 20000 });
  if (claim.attempted) {
    let reference: string | null = null;
    try {
      const state = claim.state, context = { organisationId: scope.organisationId, facilityId: state.facilityId, idempotencyKey: id };
      const protect = (input: Parameters<typeof guardDlpTransfer>[0]) => guardDlpTransfer({ ...input, actorId: scope.userId, content: state.payload.text });
      const result = state.channel === "SMS" ? await new TwilioSmsProvider(protect).send({ recipient: state.payload.recipient, body: state.payload.text }, context) : await new TwilioWhatsAppProvider(protect).sendTemplate(state.payload.recipient, state.payload.contentSid!, state.payload.variables, context);
      if (result.ok && result.providerReference) reference = result.providerReference;
    } catch { /* Durable claim prevents any automatic replay, including rejected/uncertain delivery. */ }
    try {
      await db.$transaction(async tx => {
        const state = await load(tx, scope, id); if (!state || state.status !== "SENDING" || state.revision !== claim.state.revision) throw Error("COLLECTION_PHONE_CHANGED");
        const next: Stored = { ...state, status: reference ? "ACCEPTED" : "REVIEW_REQUIRED" };
        await save(tx, next, true);
        await tx.communicationLog.update({ where: { idempotencyKey: id }, data: { providerRef: reference, status: reference ? "PROCESSING" : "PENDING", sentAt: reference ? new Date() : null, failureCode: reference ? null : "ARREARS_DELIVERY_REVIEW", nextRetryAt: null, metadata: json({ noticeId: id, payloadHash: noticeHash(state.payload), templateHash: state.payload.templateHash, historyEvidence: historyEvidence(state.payload), deliveryOutcome: reference ? "ACCEPTED" : "REVIEW_REQUIRED" }) } });
        await record(tx, scope, next, reference ? "provider_accepted" : "delivery_review");
      });
    } catch { /* SENDING remains a durable stop if final persistence is uncertain. */ }
  }
  return previewPhoneNotice(scope, command.accountId, command.channel);
}
