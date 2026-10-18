import { z } from "zod";
import { noticeHash, renderCollectionNotice } from "./collection-notice-policy";
import { normalizeTwilioRecipient } from "./integrations/twilio-provider";

export const phoneChannel = z.enum(["SMS", "WHATSAPP"]);
export const phonePayload = z.object({ recipient: z.string(), subject: z.string(), text: z.string().min(1).max(1600), channel: phoneChannel, contentSid: z.string().regex(/^HX[0-9a-f]{32}$/i).nullable(), variables: z.record(z.string(), z.string()), templateHash: z.string(), templateVersion: z.literal("arrears-phone-v1") }).strict();
export type PhonePayload = z.infer<typeof phonePayload>;
const target = { accountId: z.cuid(), channel: phoneChannel }, saved = { id: z.string().min(1).max(120), revision: z.uuid() };
export const phoneCommand = z.discriminatedUnion("action", [
  z.object({ ...target, action: z.literal("prepare"), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...target, ...saved, action: z.enum(["approve", "cancel"]), reference: z.string().trim().min(3).max(240) }).strict(),
  z.object({ ...target, ...saved, action: z.literal("send"), confirm: z.literal(true) }).strict(),
]);
export type PhoneSource = { recipient: string; accountNumber: string; facility: string; asOf: string; overdueCents: number; channel: "SMS" | "WHATSAPP" };
export function phoneFields(source: PhoneSource) {
  const amount = (source.overdueCents / 100).toFixed(2), portal = new URL("/my", process.env.APP_URL || "https://portal.stor24.co.za");
  if (portal.protocol !== "https:") throw Error("COLLECTION_PHONE_CONFIG");
  return { account: source.accountNumber, store: source.facility, amount, date: source.asOf, portal: portal.toString() };
}
export function smsPayload(source: PhoneSource): PhonePayload {
  const recipient = normalizeTwilioRecipient(source.recipient); if (!recipient) throw Error("COLLECTION_PHONE_IDENTITY");
  const letter = renderCollectionNotice({ ...source, recipient });
  return phonePayload.parse({ recipient, subject: letter.subject, text: letter.text, channel: "SMS", contentSid: null, variables: {}, templateHash: noticeHash(["SMS", letter.templateVersion, letter.text]), templateVersion: "arrears-phone-v1" });
}
export function approvedWhatsAppPayload(source: PhoneSource, content: unknown, approval: unknown, mapping: unknown, accountSid: string, expectedSid: string): PhonePayload {
  const template = z.object({ sid: z.string(), account_sid: z.string(), language: z.string(), types: z.record(z.string(), z.unknown()) }).parse(content);
  const approved = z.object({ sid: z.string(), account_sid: z.string(), whatsapp: z.object({ status: z.literal("approved"), category: z.literal("UTILITY"), content_type: z.literal("twilio/text") }) }).parse(approval);
  if (template.sid !== expectedSid || approved.sid !== expectedSid || template.account_sid !== accountSid || approved.account_sid !== accountSid || Object.keys(template.types).length !== 1) throw Error("COLLECTION_PHONE_TEMPLATE");
  const body = z.object({ body: z.string().min(1).max(1600) }).strict().parse(template.types["twilio/text"]).body;
  const fields = phoneFields(source), map = z.record(z.string().regex(/^[1-9][0-9]?$/), z.enum(["account", "store", "amount", "date", "portal"])).parse(mapping);
  const names = [...new Set([...body.matchAll(/\{\{([1-9][0-9]?)\}\}/g)].map(m => m[1]))].sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(map).sort()) || !Object.values(map).includes("account") || !Object.values(map).includes("amount")) throw Error("COLLECTION_PHONE_TEMPLATE");
  const variables = Object.fromEntries(Object.entries(map).map(([key, field]) => [key, fields[field]]));
  const text = body.replace(/\{\{([1-9][0-9]?)\}\}/g, (_, name: string) => variables[name]);
  if (/\{\{|\}\}/.test(text)) throw Error("COLLECTION_PHONE_TEMPLATE");
  if (text !== smsPayload({ ...source, channel: "SMS" }).text) throw Error("COLLECTION_PHONE_TEMPLATE");
  const recipient = normalizeTwilioRecipient(source.recipient); if (!recipient) throw Error("COLLECTION_PHONE_IDENTITY");
  return phonePayload.parse({ recipient, subject: "STOR24 account payment reminder", text, channel: "WHATSAPP", contentSid: expectedSid, variables, templateHash: noticeHash([template, approved, map]), templateVersion: "arrears-phone-v1" });
}
