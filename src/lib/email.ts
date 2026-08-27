export type EmailMessage = { to: string; subject: string; text: string; html: string };
export interface EmailProvider { send(message: EmailMessage): Promise<void> }
export function escapeEmailHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!); }

function parseFromAddress(raw: string | undefined) {
  const match = raw?.match(/^(.*)<(.+)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, "") || undefined, email: match[2].trim() };
  return { email: (raw ?? "").trim(), name: undefined };
}

class ResendEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }) });
    if (!response.ok) throw new Error(`Email provider rejected request (${response.status}).`);
  }
}

/**
 * Email via Twilio SendGrid — a separate Twilio-owned product with its own
 * API key (SENDGRID_API_KEY) and its own sender verification step (a single
 * verified sender address, or a fully verified/DKIM-signed domain) done in
 * the SendGrid console before it will send anything. Reuses EMAIL_FROM
 * ("Name <email@domain>") so both providers share one config value.
 */
class SendGridEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const from = parseFromAddress(process.env.EMAIL_FROM);
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from,
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Email provider rejected request (${response.status}).`);
  }
}

/**
 * Email via the newer Twilio Email API (comms.twilio.com) — a different
 * product from Twilio SendGrid above. It authenticates with the same
 * Account SID / Auth Token already used for SMS and WhatsApp (no separate
 * signup or API key), and during the trial period sends from an
 * auto-provisioned "{AccountSID}@twilio.email" sandbox address with no
 * domain verification required. TWILIO_EMAIL_FROM can override that once a
 * real sending domain is authenticated in the Twilio console.
 */
class TwilioEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
    const fromAddress = process.env.TWILIO_EMAIL_FROM || `${accountSid}@twilio.email`;
    const fromName = parseFromAddress(process.env.EMAIL_FROM).name ?? "Stor24";
    const response = await fetch("https://comms.twilio.com/v1/Emails", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: { address: fromAddress, name: fromName },
        to: [{ address: message.to }],
        content: { subject: message.subject, html: message.html, text: message.text },
      }),
    });
    if (!response.ok) throw new Error(`Email provider rejected request (${response.status}).`);
  }
}

class DisabledEmailProvider implements EmailProvider { async send() { throw new Error("Email delivery is not configured."); } }

export function emailProvider(): EmailProvider {
  if (process.env.EMAIL_PROVIDER === "resend") return new ResendEmailProvider();
  if (process.env.EMAIL_PROVIDER === "sendgrid") return new SendGridEmailProvider();
  if (process.env.EMAIL_PROVIDER === "twilio") return new TwilioEmailProvider();
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) return new TwilioEmailProvider();
  return new DisabledEmailProvider();
}
