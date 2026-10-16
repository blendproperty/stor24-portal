import { db } from "./db";
import { emailProvider, type EmailProvider } from "./email";
import { collectionEmailConfigured } from "./collection-notice-policy";
import { STAFF_EMAIL_POLICY_DOMAIN, STAFF_EMAIL_OUTBOX_DOMAIN, staffEmailSastTime } from "./staff-event-email-policy";
import { staffEmailActivationMatches, staffEmailAuthority, staffEmailPolicyRecord, withinStaffEmailRange, evaluateStaffEventEmail } from "./staff-event-email-service";
import { staffEmailDecode, staffEmailDigest, staffEmailLock, staffEmailRender, staffEmailSourceFingerprint, staffEmailStore, staffEmailTransaction, type StaffEmailClient } from "./staff-event-email-source";
import { staffOperationalEmailSource } from "./staff-operational-events";

/** Durable claims are never reclaimed. A crash or ambiguous provider result requires human investigation. */
export async function processStaffEventEmail(provider?: EmailProvider) {
  const fingerprint = process.env.STAFF_EVENT_EMAIL_APPROVED_FINGERPRINT ?? "";
  if (!staffEmailActivationMatches(fingerprint)) return { disabled: true, prepared: 0, claimed: 0, accepted: 0, reviewRequired: 0 };
  if (!provider && !collectionEmailConfigured()) throw Error("STAFF_EMAIL_PROVIDER_REQUIRED");
  const candidates = await db.configurationProfile.findMany({ where: { domain: STAFF_EMAIL_POLICY_DOMAIN, status: "APPROVED", config: { path: ["policyFingerprint"], equals: fingerprint } }, take: 2 });
  if (candidates.length !== 1) throw Error("STAFF_EMAIL_APPROVED_POLICY_REQUIRED");
  const policy = candidates[0], initial = staffEmailDecode(policy);
  if (initial.kind !== "POLICY" || !initial.reviewedById || !policy.facilityId) throw Error("STAFF_EMAIL_INTEGRITY");
  const scope = { userId: initial.reviewedById, organisationId: policy.organisationId, facilityIds: [policy.facilityId], unrestrictedFacilities: false };
  const now = new Date();
  if (now < staffEmailSastTime(initial.input.notBefore) || now >= staffEmailSastTime(initial.input.expires)) return { disabled: false, prepared: 0, claimed: 0, accepted: 0, reviewRequired: 0 };
  const evaluated = await evaluateStaffEventEmail(scope, { action: "evaluate", id: policy.id, revision: initial.revision }, true);
  const rows = await db.configurationProfile.findMany({ where: { organisationId: policy.organisationId, facilityId: policy.facilityId, domain: STAFF_EMAIL_OUTBOX_DOMAIN, status: "HELD_ACTIVATION", config: { path: ["policyId"], equals: policy.id } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 });
  let claimed = 0, accepted = 0, reviewRequired = 0;
  async function inspect(tx: StaffEmailClient, id: string, expected: "HELD_ACTIVATION" | "SENDING") {
    await staffEmailLock(tx, policy.id); await staffEmailLock(tx, id);
    const row = await tx.configurationProfile.findUnique({ where: { id } });
    if (!row || row.status !== expected) return null;
    const value = staffEmailDecode(row), current = await staffEmailPolicyRecord(tx, policy.organisationId, policy.id);
    if (value.kind !== "OUTBOX" || value.policyId !== policy.id || value.policyFingerprint !== fingerprint || row.organisationId !== policy.organisationId || row.facilityId !== policy.facilityId || current.state.policyFingerprint !== fingerprint || !staffEmailActivationMatches(fingerprint)) throw Error("STAFF_EMAIL_SOURCE_CHANGED");
    await staffEmailAuthority(tx, current.row, current.state, true);
    const at = new Date(); if (at < staffEmailSastTime(current.state.input.notBefore) || at >= staffEmailSastTime(current.state.input.expires)) throw Error("STAFF_EMAIL_TIMING_EXPIRED");
    const recipient = current.state.recipients.find(item => item.id === value.recipient.id);
    const event = await staffOperationalEmailSource(scope, value.sourceKey, tx);
    if (!recipient || staffEmailDigest(recipient) !== staffEmailDigest(value.recipient) || !event || !current.state.input.kinds.includes(event.kind) || !withinStaffEmailRange(current.state.input, event.at) || staffEmailSourceFingerprint(event) !== value.sourceFingerprint || staffEmailDigest(staffEmailRender(event, recipient)) !== value.messageFingerprint) throw Error("STAFF_EMAIL_SOURCE_CHANGED");
    return { row, value, reviewer: current.state.reviewedById! };
  }
  for (const item of rows) {
    // A failure before a durable claim sends nothing and leaves the original row held.
    const claim = await staffEmailTransaction(async tx => {
      const result = await inspect(tx, item.id, "HELD_ACTIVATION"); if (!result) return null;
      result.value.status = "SENDING"; result.value.attemptedAt = new Date().toISOString();
      await staffEmailStore(tx, { id: result.row.id, organisationId: result.row.organisationId, facilityId: result.row.facilityId!, domain: result.row.domain, name: result.row.id }, result.value, true);
      await tx.auditEvent.create({ data: { organisationId: policy.organisationId, facilityId: policy.facilityId, action: "staff_email.claimed", entityType: "ConfigurationProfile", entityId: item.id, after: { policyFingerprint: fingerprint, providerAccepted: false } } });
      return result;
    });
    if (!claim) continue; claimed++;
    let providerAccepted = false;
    try {
      const fresh = await staffEmailTransaction(tx => inspect(tx, item.id, "SENDING")); if (!fresh) throw Error("STAFF_EMAIL_CLAIM_CHANGED");
      // No provider call is inside a retriable database callback.
      await (provider ?? emailProvider()).send({ ...fresh.value.message, dlp: { organisationId: policy.organisationId, facilityId: policy.facilityId!, actorId: fresh.reviewer, resourceId: item.id, approvedRecipient: fresh.value.recipient.email } });
      providerAccepted = true;
    } catch { /* Unknown outcomes are deliberately not replayed. */ }
    try {
      await staffEmailTransaction(async tx => {
        await staffEmailLock(tx, item.id); const row = await tx.configurationProfile.findUnique({ where: { id: item.id } }); if (!row || row.status !== "SENDING") throw Error("STAFF_EMAIL_CLAIM_CHANGED");
        const value = staffEmailDecode(row); if (value.kind !== "OUTBOX" || value.attemptedAt !== claim.value.attemptedAt) throw Error("STAFF_EMAIL_CLAIM_CHANGED");
        value.status = providerAccepted ? "ACCEPTED" : "REVIEW_REQUIRED"; value.acceptedAt = providerAccepted ? new Date().toISOString() : null; value.failureCode = providerAccepted ? null : "OUTCOME_UNCONFIRMED";
        await staffEmailStore(tx, { id: row.id, organisationId: row.organisationId, facilityId: row.facilityId!, domain: row.domain, name: row.id }, value, true);
        await tx.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, action: "staff_email.outcome", entityType: "ConfigurationProfile", entityId: row.id, after: { policyFingerprint: fingerprint, status: value.status, providerAccepted, inboxVerified: false } } });
      });
      if (providerAccepted) accepted++; else reviewRequired++;
    } catch { reviewRequired++; /* SENDING remains durable; never automatically reclaim it. */ }
  }
  return { disabled: false, prepared: evaluated.prepared, claimed, accepted, reviewRequired };
}
