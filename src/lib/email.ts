export type EmailMessage = { to: string; subject: string; text: string; html: string };
export interface EmailProvider { send(message: EmailMessage): Promise<void> }
export function escapeEmailHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!); }

export function stor24EmailVerificationHtml(code: string) {
  const safeCode = escapeEmailHtml(code);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ea;color:#071411;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your secure Stor24 verification code is ${safeCode}. It expires in 10 minutes.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f3ea;">
    <tr><td align="center" style="padding:28px 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dfe3df;border-radius:22px;overflow:hidden;">
        <tr><td style="height:7px;background:#ff5a0a;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:30px 32px 16px;">
          <div style="font-size:32px;line-height:1;font-weight:900;letter-spacing:-2px;color:#071411;">ST<span style="color:#ff5a0a;font-size:30px;">&#11042;</span>R<sup style="font-size:15px;letter-spacing:-1px;">24</sup></div>
        </td></tr>
        <tr><td style="padding:10px 32px 34px;">
          <div style="margin-bottom:12px;color:#ff5a0a;font-size:11px;line-height:1.4;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Quick security check</div>
          <h1 style="margin:0 0 12px;font-size:30px;line-height:1.12;letter-spacing:-1px;color:#071411;">Let&rsquo;s confirm it&rsquo;s you.</h1>
          <p style="margin:0 0 24px;color:#52615b;font-size:16px;line-height:1.55;">Use this six-digit code to verify your email and keep your Stor24 booking moving.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#071411;border-radius:16px;">
            <tr><td align="center" style="padding:25px 16px;">
              <div style="margin-bottom:8px;color:#aebcb6;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Your verification code</div>
              <div style="color:#ffffff;font-size:38px;line-height:1.15;font-weight:900;letter-spacing:10px;">${safeCode}</div>
            </td></tr>
          </table>
          <p style="margin:22px 0 0;color:#52615b;font-size:14px;line-height:1.55;"><strong style="color:#071411;">Ready when you are.</strong> This code expires in 10 minutes.</p>
          <p style="margin:10px 0 0;color:#7b8883;font-size:12px;line-height:1.5;">Didn&rsquo;t request this? You can safely ignore this email. Never share this code with anyone&mdash;including the Stor24 team.</p>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#071411;color:#aebcb6;font-size:12px;line-height:1.5;">Safe space. Smart storage. Stor24.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function stor24ReservationHeldHtml(input: {
  firstName: string;
  facilityName: string;
  unitNumber: string;
  monthlyRateZar: string;
  holdExpiresAt: string;
  intendedMoveIn: string;
  reference: string;
}) {
  const value = Object.fromEntries(Object.entries(input).map(([key, item]) => [key, escapeEmailHtml(item)])) as Record<keyof typeof input, string>;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ea;color:#071411;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Unit ${value.unitNumber} is safely held for you. Reference ${value.reference}.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f3ea;"><tr><td align="center" style="padding:28px 14px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dfe3df;border-radius:22px;overflow:hidden;">
      <tr><td style="height:7px;background:#ff5a0a;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:30px 32px 14px;"><div style="font-size:32px;line-height:1;font-weight:900;letter-spacing:-2px;">ST<span style="color:#ff5a0a;font-size:30px;">&#11042;</span>R<sup style="font-size:15px;letter-spacing:-1px;">24</sup></div></td></tr>
      <tr><td style="padding:12px 32px 34px;">
        <div style="margin-bottom:12px;color:#ff5a0a;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Space secured</div>
        <h1 style="margin:0 0 12px;font-size:30px;line-height:1.12;letter-spacing:-1px;">Nice one, ${value.firstName}. Your unit is held.</h1>
        <p style="margin:0 0 24px;color:#52615b;font-size:16px;line-height:1.55;">We&rsquo;ve taken Unit ${value.unitNumber} off the market while you finish the next steps.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#071411;border-radius:16px;color:#fff;">
          <tr><td style="padding:22px 24px;">
            <div style="margin-bottom:14px;color:#ff8b51;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Your Stor24 hold</div>
            <div style="font-size:17px;font-weight:800;">Unit ${value.unitNumber} &middot; ${value.facilityName}</div>
            <div style="margin-top:8px;color:#c7d2cd;font-size:14px;line-height:1.6;">R${value.monthlyRateZar} per month<br>Move-in: ${value.intendedMoveIn}<br>Held until: ${value.holdExpiresAt}</div>
          </td></tr>
        </table>
        <p style="margin:22px 0 5px;color:#52615b;font-size:14px;line-height:1.55;">Your team will be in touch if anything else is needed.</p>
        <p style="margin:0;color:#071411;font-size:14px;font-weight:800;">Reference: <span style="color:#ff5a0a;">${value.reference}</span></p>
      </td></tr>
      <tr><td style="padding:18px 32px;background:#071411;color:#aebcb6;font-size:12px;line-height:1.5;">Safe space. Smart storage. Stor24.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

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
