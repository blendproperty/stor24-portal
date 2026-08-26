import { db } from "@/lib/db";
import { emailProvider, escapeEmailHtml } from "@/lib/email";
import { TwilioSmsProvider } from "@/lib/integrations/twilio-provider";
import type { ProviderResult } from "@/lib/integrations/providers";
import { privacyHash } from "@/lib/request-security";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";

type Channel = "EMAIL" | "SMS" | "WHATSAPP";

type ReservationConfirmationInput = {
  organisationId: string;
  facilityId: string;
  customerId: string;
  idempotencyKey: string;
  consent: { email: boolean; sms: boolean; phone: boolean; whatsapp?: boolean };
  to: { email: string; phone: string };
  allowWhatsappWhenAutomationDisabled?: boolean;
  variables: {
    firstName: string;
    facilityName: string;
    unitNumber: string;
    monthlyRateZar: string;
    holdExpiresAt: string;
    intendedMoveIn: string;
    reference: string;
  };
};

const DEFAULT_TEMPLATES: Record<Channel, { subject?: string; body: string }> = {
  EMAIL: {
    subject: "Your Stor24 unit is held — {{reference}}",
    body: "Hi {{firstName}},\n\nUnit {{unitNumber}} at {{facilityName}} is held for you until {{holdExpiresAt}} at R{{monthlyRateZar}}/month.\n\nYour reference is {{reference}}. Our team will be in touch to confirm your move-in.\n\nStor24",
  },
  SMS: { body: "Stor24: Unit {{unitNumber}} at {{facilityName}} is held until {{holdExpiresAt}}. Ref {{reference}}. We'll be in touch to confirm." },
  WHATSAPP: { body: "Stor24: Unit {{unitNumber}} at {{facilityName}} is held until {{holdExpiresAt}}. Ref {{reference}}. We'll be in touch to confirm." },
};

function render(text: string, variables: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => variables[key] ?? match);
}

async function resolveTemplate(organisationId: string, channel: Channel) {
  const template = await db.communicationTemplate.findFirst({
    where: { organisationId, key: "reservation-confirmation", channel, active: true },
    orderBy: { version: "desc" },
  });
  return {
    templateId: template?.id ?? null,
    subject: template?.subject ?? DEFAULT_TEMPLATES[channel].subject,
    body: template?.body ?? DEFAULT_TEMPLATES[channel].body,
  };
}

async function logDelivery(input: {
  organisationId: string;
  facilityId: string;
  customerId: string;
  templateId: string | null;
  channel: Channel;
  recipient: string;
  idempotencyKey: string;
  provider: string;
  result: { ok: true; providerReference: string } | { ok: false; code: string; message: string };
}) {
  await db.communicationLog.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      organisationId: input.organisationId,
      facilityId: input.facilityId,
      customerId: input.customerId,
      templateId: input.templateId,
      channel: input.channel,
      recipientHash: privacyHash(input.recipient),
      provider: input.provider,
      providerRef: input.result.ok ? input.result.providerReference : undefined,
      status: input.result.ok ? "SUCCEEDED" : "FAILED",
      idempotencyKey: input.idempotencyKey,
      failureCode: input.result.ok ? undefined : input.result.code,
      failureMessage: input.result.ok ? undefined : input.result.message,
      sentAt: input.result.ok ? new Date() : undefined,
      failedAt: input.result.ok ? undefined : new Date(),
    },
    update: {},
  });
}

/**
 * Sends the reservation-confirmation notification across whichever channels
 * the customer consented to, using an active CommunicationTemplate for the
 * organisation if one exists, otherwise a built-in default so the pilot
 * works before anyone has set up templates through the (currently
 * placeholder) Communications screen.
 *
 * Never throws — a notification failure must not fail or roll back the
 * reservation itself. Every attempt, success or failure, is logged to
 * CommunicationLog with the recipient stored only as a privacy-safe hash.
 *
 * Note: WhatsApp currently reuses the "phone" consent checkbox (there is no
 * separate WhatsApp opt-in in the booking form or the consent schema).
 * Revisit if the business wants WhatsApp consent tracked distinctly.
 */
export async function notifyReservationConfirmed(input: ReservationConfirmationInput) {
  const results: Array<{ channel: Channel; ok: boolean }> = [];

  if (input.consent.email && input.to.email) {
    const { templateId, subject, body } = await resolveTemplate(input.organisationId, "EMAIL");
    const idempotencyKey = `${input.idempotencyKey}:EMAIL`;
    const renderedBody = render(body, input.variables);
    try {
      await emailProvider().send({
        to: input.to.email,
        subject: render(subject ?? "Your Stor24 reservation", input.variables),
        text: renderedBody,
        html: `<p>${escapeEmailHtml(renderedBody).replaceAll("\n", "<br/>")}</p>`,
      });
      await logDelivery({ organisationId: input.organisationId, facilityId: input.facilityId, customerId: input.customerId, templateId, channel: "EMAIL", recipient: input.to.email, idempotencyKey, provider: process.env.EMAIL_PROVIDER ?? "disabled", result: { ok: true, providerReference: "" } });
      results.push({ channel: "EMAIL", ok: true });
    } catch (error) {
      await logDelivery({ organisationId: input.organisationId, facilityId: input.facilityId, customerId: input.customerId, templateId, channel: "EMAIL", recipient: input.to.email, idempotencyKey, provider: process.env.EMAIL_PROVIDER ?? "disabled", result: { ok: false, code: "SEND_FAILED", message: error instanceof Error ? error.message : "Email send failed." } });
      results.push({ channel: "EMAIL", ok: false });
    }
  }

  if (input.consent.sms && input.to.phone) {
    const { templateId, body } = await resolveTemplate(input.organisationId, "SMS");
    const idempotencyKey = `${input.idempotencyKey}:SMS`;
    const result: ProviderResult<{ status: "QUEUED" }> = await new TwilioSmsProvider().send(
      { recipient: input.to.phone, body: render(body, input.variables) },
      { organisationId: input.organisationId, facilityId: input.facilityId, idempotencyKey },
    );
    await logDelivery({ organisationId: input.organisationId, facilityId: input.facilityId, customerId: input.customerId, templateId, channel: "SMS", recipient: input.to.phone, idempotencyKey, provider: "twilio", result: result.ok ? { ok: true, providerReference: result.providerReference } : { ok: false, code: result.code, message: result.message } });
    results.push({ channel: "SMS", ok: result.ok });
  }

  if (input.consent.whatsapp && input.to.phone) {
    const result = await sendWhatsAppTemplate({ organisationId: input.organisationId, facilityId: input.facilityId, customerId: input.customerId, recipient: input.to.phone, consent: input.consent, messageType: "RESERVATION_CONFIRMED", idempotencyKey: `${input.idempotencyKey}:WHATSAPP`, variables: { "1": input.variables.firstName, "2": input.variables.unitNumber, "3": input.variables.facilityName, "4": input.variables.intendedMoveIn, "5": `R${input.variables.monthlyRateZar}` }, allowWhenAutomationDisabled: input.allowWhatsappWhenAutomationDisabled });
    results.push({ channel: "WHATSAPP", ok: result.ok });
  }

  return results;
}

/**
 * Emails the DocuSign-style lease signing link generated by moveIn() in
 * leasing-service.ts. Deliberately separate from
 * notifyReservationConfirmed — this fires from a staff action (move-in),
 * not the public booking flow, and always targets a single known customer
 * rather than whichever channels they consented to at booking time.
 *
 * Never throws (same contract as the rest of this file): a delivery
 * failure must not fail or roll back the move-in itself. Staff can resend
 * the link later once notification retry/resend UI exists. Every attempt
 * is logged to CommunicationLog, keyed by documentId so re-sends for the
 * same document reuse one idempotency key today (a deliberate limitation —
 * revisit once a "resend" action exists so retries aren't silently
 * deduped).
 */
export async function sendLeaseSigningLink(input: {
  organisationId: string;
  facilityId: string;
  customerId: string;
  documentId: string;
  to: { email: string | null };
  variables: { customerName: string; facilityName: string; unitNumber: string; signingUrl: string; expiresAt: string };
}) {
  if (!input.to.email) return { ok: false as const, reason: "NO_EMAIL" as const };

  const idempotencyKey = `lease-sign:${input.documentId}`;
  const subject = `Please sign your Stor24 lease — Unit ${input.variables.unitNumber}`;
  const body = `Hi ${input.variables.customerName},\n\nYour storage lease for Unit ${input.variables.unitNumber} at ${input.variables.facilityName} is ready for your signature.\n\nReview and sign here: ${input.variables.signingUrl}\n\nThis link expires on ${input.variables.expiresAt}. If it expires before you sign, contact Stor24 for a new link.\n\nStor24`;

  try {
    await emailProvider().send({
      to: input.to.email,
      subject,
      text: body,
      html: `<p>${escapeEmailHtml(body).replaceAll("\n", "<br/>")}</p>`,
    });
    await logDelivery({ organisationId: input.organisationId, facilityId: input.facilityId, customerId: input.customerId, templateId: null, channel: "EMAIL", recipient: input.to.email, idempotencyKey, provider: process.env.EMAIL_PROVIDER ?? "disabled", result: { ok: true, providerReference: "" } });
    return { ok: true as const };
  } catch (error) {
    await logDelivery({ organisationId: input.organisationId, facilityId: input.facilityId, customerId: input.customerId, templateId: null, channel: "EMAIL", recipient: input.to.email, idempotencyKey, provider: process.env.EMAIL_PROVIDER ?? "disabled", result: { ok: false, code: "SEND_FAILED", message: error instanceof Error ? error.message : "Email send failed." } });
    return { ok: false as const, reason: "SEND_FAILED" as const };
  }
}
