import type { MessageProvider, ProviderContext, ProviderResult } from "./providers";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

type TwilioMessageResponse = { sid?: string; message?: string; code?: number };

function twilioAuth() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return { sid, header: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
}

async function sendTwilioMessage(kind: "SMS" | "WHATSAPP", to: string, body: string, content?: { sid: string; variables: Record<string, string> }): Promise<ProviderResult<{ status: "QUEUED" }>> {
  const auth = twilioAuth();
  const from = kind === "WHATSAPP" ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
  if (!auth || !from)
    return { ok: false, retryable: false, code: "CONFIG_REQUIRED", message: `Twilio ${kind} has not been configured.` };

  const recipient = kind === "WHATSAPP" ? `whatsapp:${to}` : to;
  const sender = kind === "WHATSAPP" ? `whatsapp:${from}` : from;

  try {
    const response = await fetch(`${TWILIO_API}/Accounts/${auth.sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: auth.header, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(content
        ? { To: recipient, From: sender, ContentSid: content.sid, ContentVariables: JSON.stringify(content.variables) }
        : { To: recipient, From: sender, Body: body }),
    });
    const payload = await response.json() as TwilioMessageResponse;
    if (!response.ok)
      return { ok: false, retryable: response.status >= 500, code: String(payload.code ?? response.status), message: payload.message ?? "Twilio rejected the message." };
    return { ok: true, providerReference: payload.sid ?? "", data: { status: "QUEUED" } };
  } catch (error) {
    return { ok: false, retryable: true, code: "NETWORK_ERROR", message: error instanceof Error ? error.message : "Twilio request failed." };
  }
}

/**
 * SMS via Twilio's Messages API. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 * and TWILIO_SMS_FROM (an SMS-capable Twilio number). On a trial account,
 * Twilio will only deliver to phone numbers verified in the console under
 * Phone Numbers > Manage > Verified Caller IDs.
 */
export class TwilioSmsProvider implements MessageProvider {
  readonly category = "SMS" as const;

  async health(): Promise<ProviderResult<{ latencyMs: number }>> {
    const auth = twilioAuth();
    if (!auth || !process.env.TWILIO_SMS_FROM)
      return { ok: false, retryable: false, code: "CONFIG_REQUIRED", message: "Twilio SMS has not been configured." };
    return { ok: true, providerReference: auth.sid, data: { latencyMs: 0 } };
  }

  async send(message: { recipient: string; subject?: string; body: string }, _context: ProviderContext) {
    return sendTwilioMessage("SMS", message.recipient, message.body);
  }
}

/**
 * WhatsApp via Twilio's Messages API. Requires TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM (the Twilio WhatsApp sender
 * number, without the "whatsapp:" prefix — this code adds it).
 *
 * On the Twilio Sandbox (default until WhatsApp Business is approved),
 * TWILIO_WHATSAPP_FROM is Twilio's shared sandbox number, and each recipient
 * must first opt in by sending the sandbox join code to that number from
 * WhatsApp. That is a Twilio/Meta-side step, not something this code can do.
 */
export class TwilioWhatsAppProvider implements MessageProvider {
  readonly category = "WHATSAPP" as const;

  async health(): Promise<ProviderResult<{ latencyMs: number }>> {
    const auth = twilioAuth();
    if (!auth || !process.env.TWILIO_WHATSAPP_FROM)
      return { ok: false, retryable: false, code: "CONFIG_REQUIRED", message: "Twilio WhatsApp has not been configured." };
    return { ok: true, providerReference: auth.sid, data: { latencyMs: 0 } };
  }

  async send(message: { recipient: string; subject?: string; body: string }, _context: ProviderContext) {
    return sendTwilioMessage("WHATSAPP", message.recipient, message.body);
  }

  async sendTemplate(recipient: string, contentSid: string, variables: Record<string, string>, _context: ProviderContext) {
    if (!/^HX[a-f0-9]{32}$/i.test(contentSid)) return { ok: false as const, retryable: false, code: "INVALID_CONTENT_SID", message: "Twilio WhatsApp template SID is invalid." };
    return sendTwilioMessage("WHATSAPP", recipient, "", { sid: contentSid, variables });
  }
}
