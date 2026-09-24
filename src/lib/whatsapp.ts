import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { TwilioWhatsAppProvider } from "@/lib/integrations/twilio-provider";
import { privacyHash } from "@/lib/request-security";
import { getWhatsAppAutomationState, whatsAppServerGateEnabled } from "@/lib/integrations/whatsapp-automation";

export const WHATSAPP_TEMPLATE_ENV = {
  RESERVATION_CONFIRMED: "TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID",
  VIEWING_BOOKED: "TWILIO_WHATSAPP_VIEWING_BOOKED_SID",
  PAYMENT_RECEIVED: "TWILIO_WHATSAPP_PAYMENT_RECEIVED_SID",
  MOVE_IN_REMINDER: "TWILIO_WHATSAPP_MOVE_IN_REMINDER_SID",
  ACCESS_READY: "TWILIO_WHATSAPP_ACCESS_READY_SID",
  PAYMENT_REMINDER: "TWILIO_WHATSAPP_PAYMENT_REMINDER_SID",
  PAYMENT_OVERDUE: "TWILIO_WHATSAPP_PAYMENT_OVERDUE_SID",
  MOVE_OUT_CONFIRMATION: "TWILIO_WHATSAPP_MOVE_OUT_CONFIRMATION_SID",
} as const;

export type WhatsAppMessageType = keyof typeof WHATSAPP_TEMPLATE_ENV;
type Consent = { whatsapp?: boolean; optedOutAt?: string | null } | null | undefined;

export function whatsAppAutomationEnabled() {
  return whatsAppServerGateEnabled();
}

export function hasWhatsAppConsent(value: unknown): value is Consent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const consent = value as Record<string, unknown>;
  return consent.whatsapp === true && !consent.optedOutAt;
}

export async function sendWhatsAppTemplate(input: {
  organisationId: string;
  facilityId?: string;
  customerId: string;
  recipient: string;
  consent: unknown;
  messageType: WhatsAppMessageType;
  variables: Record<string, string>;
  idempotencyKey: string;
  allowWhenAutomationDisabled?: boolean;
}) {
  if (!hasWhatsAppConsent(input.consent)) return { ok: false as const, code: "CONSENT_REQUIRED" };
  if (!input.allowWhenAutomationDisabled && !(await getWhatsAppAutomationState(input.organisationId)).enabled) return { ok: false as const, code: "AUTOMATION_DISABLED" };
  const contentSid = process.env[WHATSAPP_TEMPLATE_ENV[input.messageType]];
  if (!contentSid) return { ok: false as const, code: "TEMPLATE_NOT_CONFIGURED" };

  const delivery: Prisma.CommunicationLogUncheckedCreateInput = {
    organisationId: input.organisationId,
    facilityId: input.facilityId,
    customerId: input.customerId,
    channel: "WHATSAPP",
    direction: "OUTBOUND",
    messageType: input.messageType,
    recipientHash: privacyHash(input.recipient),
    provider: "twilio",
    status: "PENDING",
    idempotencyKey: input.idempotencyKey,
    metadata: { contentSid, variables: input.variables, deliveryOutcome: "IN_PROGRESS" },
  };
  let log;
  try {
    // Persist the unique attempt before any external side effect.
    log = await db.communicationLog.create({ data: delivery });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
    const existing = await db.communicationLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!existing) throw error;
    const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata : {};
    const variables = metadata.variables && typeof metadata.variables === "object" && !Array.isArray(metadata.variables) ? metadata.variables : {};
    const sameVariables = Object.keys(variables).length === Object.keys(input.variables).length && Object.entries(input.variables).every(([key, value]) => variables[key] === value);
    if (existing.organisationId !== input.organisationId || (existing.facilityId ?? null) !== (input.facilityId ?? null) || existing.customerId !== input.customerId || existing.channel !== "WHATSAPP" || existing.direction !== "OUTBOUND" || existing.provider !== "twilio" || existing.messageType !== input.messageType || existing.recipientHash !== delivery.recipientHash || metadata.contentSid !== contentSid || !sameVariables) return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" };
    if (["PROCESSING", "SUCCEEDED"].includes(existing.status) && existing.providerRef) return { ok: true as const, code: "DUPLICATE", logId: existing.id, providerReference: existing.providerRef };
    return { ok: false as const, code: "DELIVERY_REVIEW_REQUIRED", logId: existing.id };
  }

  let result: Awaited<ReturnType<TwilioWhatsAppProvider["sendTemplate"]>>;
  try {
    result = await new TwilioWhatsAppProvider().sendTemplate(input.recipient, contentSid, input.variables, { organisationId: input.organisationId, facilityId: input.facilityId, idempotencyKey: input.idempotencyKey });
  } catch {
    result = { ok: false, retryable: true, code: "NETWORK_ERROR", message: "Delivery could not be confirmed. Review the provider record before retrying." };
  }
  const accepted = result.ok && Boolean(result.providerReference);
  const uncertain = result.ok ? !result.providerReference : result.retryable;
  try {
    await db.communicationLog.update({ where: { id: log.id }, data: {
      providerRef: accepted && result.ok ? result.providerReference : null,
      status: accepted ? "PROCESSING" : "FAILED",
      failureCode: accepted ? null : uncertain ? "DELIVERY_REVIEW_REQUIRED" : !result.ok ? result.code : "DELIVERY_REVIEW_REQUIRED",
      failureMessage: accepted ? null : uncertain ? "Delivery could not be confirmed. Review the provider record before retrying." : !result.ok ? result.message : null,
      failedAt: accepted ? null : new Date(),
      nextRetryAt: null,
      metadata: { contentSid, variables: input.variables, deliveryOutcome: accepted ? "ACCEPTED" : uncertain ? "UNCERTAIN" : "REJECTED" },
    } });
  } catch {
    // The durable pending claim prevents a resend after uncertain finalisation.
    return { ok: false as const, code: "DELIVERY_REVIEW_REQUIRED", logId: log.id, attempted: true };
  }
  return accepted && result.ok ? { ok: true as const, logId: log.id, providerReference: result.providerReference, attempted: true } : { ok: false as const, logId: log.id, code: uncertain ? "DELIVERY_REVIEW_REQUIRED" : !result.ok ? result.code : "DELIVERY_REVIEW_REQUIRED", attempted: true };
}

export function canRetryWhatsAppDelivery(log: { status: string; providerRef: string | null; failureCode: string | null; failedAt: Date | null; deliveredAt?: Date | null; readAt?: Date | null; metadata: unknown }) {
  if (log.status !== "FAILED" || log.deliveredAt || log.readAt || ["NETWORK_ERROR", "DELIVERY_REVIEW_REQUIRED"].includes(log.failureCode ?? "")) return false;
  const metadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata) ? log.metadata as Record<string, unknown> : {};
  if (metadata.deliveryOutcome === "UNCERTAIN" || metadata.deliveryOutcome === "IN_PROGRESS") return false;
  return metadata.deliveryOutcome === "REJECTED" || Boolean(log.providerRef && log.failedAt) || ["CONFIG_REQUIRED", "INVALID_RECIPIENT", "INVALID_CONTENT_SID"].includes(log.failureCode ?? "");
}

export async function recordWhatsAppOptOut(customerId: string, at = new Date()) {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { communicationConsent: true } });
  if (!customer) return;
  const current = customer.communicationConsent && typeof customer.communicationConsent === "object" && !Array.isArray(customer.communicationConsent)
    ? customer.communicationConsent as Record<string, unknown> : {};
  await db.customer.update({ where: { id: customerId }, data: { communicationConsent: { ...current, whatsapp: false, optedOutAt: at.toISOString(), source: "WHATSAPP_INBOUND" } } });
}
