import { db } from "@/lib/db";
import { hikCentralLockPolicy, hikCentralLockPolicyHash } from "@/lib/hikcentral-lock-policy";
import { normalizeTwilioRecipient, TwilioSmsProvider } from "@/lib/integrations/twilio-provider";
import { sendNotificationOnce } from "@/lib/notification-delivery";
import type { RequestScope } from "@/lib/scope";

async function target(scope: RequestScope, customerId: string, sourceChargeId: string) {
  const charge = await db.ledgerEntry.findFirst({ where: { id: sourceChargeId, account: { customerId, customer: { organisationId: scope.organisationId } } }, select: { account: { select: { accountNumber: true, customer: { select: { phone: true, phoneVerifiedAt: true } } } } } });
  const phone = charge?.account.customer.phoneVerifiedAt ? normalizeTwilioRecipient(charge.account.customer.phone ?? "") : null;
  return phone && charge ? { accountNumber: charge.account.accountNumber, phone } : null;
}

export async function sendHikCentralLockWarning(scope: RequestScope, customerId: string, facilityId: string, candidate: { sourceChargeId: string; reviewOn: string }, now = new Date()) {
  const policy = await hikCentralLockPolicy(scope.organisationId, facilityId);
  if (!policy) return false;
  const lockAt = new Date(`${candidate.reviewOn}T19:00:00+02:00`);
  if (now.getTime() < lockAt.getTime() - policy.noticeHours * 60 * 60_000) return false;
  const recipient = await target(scope, customerId, candidate.sourceChargeId);
  if (!recipient) return false;
  const text = policy.warningText.replaceAll("{account}", recipient.accountNumber).replaceAll("{lockDate}", `${candidate.reviewOn} after 19:00 SAST, once Block24 is empty`);
  const evidence = { sourceChargeId: candidate.sourceChargeId, approvalReference: policy.approvalReference, policyHash: hikCentralLockPolicyHash(policy) };
  const idempotencyKey = `face-lock-warning:${scope.organisationId}:${facilityId}:${candidate.sourceChargeId}:${evidence.policyHash.slice(0, 16)}`;
  return sendNotificationOnce({ organisationId: scope.organisationId, facilityId, customerId, templateId: null, channel: "SMS", messageType: "FACE_ACCESS_LOCK_WARNING", recipient: recipient.phone, idempotencyKey, provider: "twilio", payload: { text, ...evidence }, evidence, send: () => new TwilioSmsProvider().send({ recipient: recipient.phone, body: text }, { organisationId: scope.organisationId, facilityId, idempotencyKey }) });
}

export async function sendHikCentralLockedNotice(scope: RequestScope, customerId: string, facilityId: string, sourceChargeId: string) {
  const policy = await hikCentralLockPolicy(scope.organisationId, facilityId);
  const recipient = policy ? await target(scope, customerId, sourceChargeId) : null;
  if (!policy || !recipient) return false;
  const text = policy.lockedText.replaceAll("{account}", recipient.accountNumber);
  const evidence = { sourceChargeId, approvalReference: policy.approvalReference, policyHash: hikCentralLockPolicyHash(policy) };
  const idempotencyKey = `face-locked:${scope.organisationId}:${facilityId}:${sourceChargeId}:${evidence.policyHash.slice(0, 16)}`;
  return sendNotificationOnce({ organisationId: scope.organisationId, facilityId, customerId, templateId: null, channel: "SMS", messageType: "FACE_ACCESS_LOCKED", recipient: recipient.phone, idempotencyKey, provider: "twilio", payload: { text, ...evidence }, evidence, send: () => new TwilioSmsProvider().send({ recipient: recipient.phone, body: text }, { organisationId: scope.organisationId, facilityId, idempotencyKey }) });
}
