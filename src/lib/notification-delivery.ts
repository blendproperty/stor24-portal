import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { privacyHash } from "@/lib/request-security";

type Attempt = { ok: true; providerReference?: string } | { ok: false; code: string; retryable: boolean };

/** One provider attempt per logical notification. A timeout or missing final
 * record requires review; it must never authorize an automatic second send. */
export async function sendNotificationOnce(input: {
  organisationId: string; facilityId: string; customerId: string;
  templateId: string | null; channel: "EMAIL" | "SMS";
  messageType: "RESERVATION_CONFIRMED" | "VIEWING_BOOKED";
  recipient: string; idempotencyKey: string; provider: string;
  payload: unknown; send: () => Promise<Attempt>;
}): Promise<boolean> {
  const payloadHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  const recipientHash = privacyHash(input.recipient);
  let claimed;
  try {
    claimed = await db.communicationLog.create({ data: {
      organisationId: input.organisationId, facilityId: input.facilityId, customerId: input.customerId,
      templateId: input.templateId, channel: input.channel, direction: "OUTBOUND", messageType: input.messageType,
      recipientHash, idempotencyKey: input.idempotencyKey, provider: input.provider,
      status: "PENDING", attempts: 1, nextRetryAt: null,
      metadata: { payloadHash, deliveryOutcome: "IN_PROGRESS" },
    } });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) return false;
    const old = await db.communicationLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!old) return false;
    const metadata = old.metadata && typeof old.metadata === "object" && !Array.isArray(old.metadata) ? old.metadata : {};
    const same = old.organisationId === input.organisationId && old.facilityId === input.facilityId && old.customerId === input.customerId && old.channel === input.channel && old.direction === "OUTBOUND" && old.messageType === input.messageType && old.provider === input.provider && old.recipientHash === recipientHash && metadata.payloadHash === payloadHash;
    // Legacy logs without a comparable payload cannot safely authorize a resend.
    return same && old.status === "SUCCEEDED" && metadata.deliveryOutcome === "ACCEPTED";
  }

  let result: Attempt;
  try { result = await input.send(); }
  catch { result = { ok: false, code: "DELIVERY_REVIEW_REQUIRED", retryable: true }; }
  if (result.ok && input.channel === "SMS" && !result.providerReference) result = { ok: false, code: "DELIVERY_REVIEW_REQUIRED", retryable: true };
  const uncertain = !result.ok && result.retryable;
  try {
    await db.communicationLog.update({ where: { id: claimed.id }, data: {
      // SUCCEEDED retains the existing API-acceptance contract; delivered/read
      // timestamps remain the evidence of actual SMS delivery.
      status: result.ok ? "SUCCEEDED" : "FAILED",
      providerRef: result.ok ? result.providerReference ?? null : null,
      sentAt: result.ok ? new Date() : null, failedAt: result.ok ? null : new Date(), nextRetryAt: null,
      failureCode: result.ok ? null : uncertain ? "DELIVERY_REVIEW_REQUIRED" : result.code,
      failureMessage: result.ok ? null : uncertain ? "Delivery could not be confirmed. Review the provider record before retrying." : "The provider rejected this notification. Review before retrying.",
      metadata: { payloadHash, deliveryOutcome: result.ok ? "ACCEPTED" : uncertain ? "UNCERTAIN" : "REJECTED" },
    } });
  } catch { return false; } // The pending claim remains durable if finalisation fails.
  return result.ok;
}
