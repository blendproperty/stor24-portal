import { db } from "@/lib/db";
import { TwilioWhatsAppProvider } from "@/lib/integrations/twilio-provider";
import { privacyHash } from "@/lib/request-security";
import { getWhatsAppAutomationState, whatsAppServerGateEnabled } from "@/lib/integrations/whatsapp-automation";

export const WHATSAPP_TEMPLATE_ENV = {
  RESERVATION_CONFIRMED: "TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID",
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

  const existing = await db.communicationLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { ok: existing.status !== "FAILED", code: "DUPLICATE", logId: existing.id };

  const result = await new TwilioWhatsAppProvider().sendTemplate(input.recipient, contentSid, input.variables, {
    organisationId: input.organisationId,
    facilityId: input.facilityId,
    idempotencyKey: input.idempotencyKey,
  });
  const log = await db.communicationLog.create({ data: {
    organisationId: input.organisationId,
    facilityId: input.facilityId,
    customerId: input.customerId,
    channel: "WHATSAPP",
    direction: "OUTBOUND",
    messageType: input.messageType,
    recipientHash: privacyHash(input.recipient),
    provider: "twilio",
    providerRef: result.ok ? result.providerReference : undefined,
    status: result.ok ? "PROCESSING" : "FAILED",
    idempotencyKey: input.idempotencyKey,
    failureCode: result.ok ? undefined : result.code,
    failureMessage: result.ok ? undefined : result.message,
    failedAt: result.ok ? undefined : new Date(),
    nextRetryAt: !result.ok && result.retryable ? new Date(Date.now() + 5 * 60_000) : undefined,
    metadata: { contentSid, variables: input.variables },
  } });
  return result.ok ? { ok: true as const, logId: log.id, providerReference: result.providerReference } : { ok: false as const, logId: log.id, code: result.code };
}

export async function recordWhatsAppOptOut(customerId: string, at = new Date()) {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { communicationConsent: true } });
  if (!customer) return;
  const current = customer.communicationConsent && typeof customer.communicationConsent === "object" && !Array.isArray(customer.communicationConsent)
    ? customer.communicationConsent as Record<string, unknown> : {};
  await db.customer.update({ where: { id: customerId }, data: { communicationConsent: { ...current, whatsapp: false, optedOutAt: at.toISOString(), source: "WHATSAPP_INBOUND" } } });
}
