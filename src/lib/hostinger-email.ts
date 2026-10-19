import nodemailer from "nodemailer";
import type { EmailMessage, EmailProvider } from "@/lib/email";

export const HOSTINGER_EMAIL_ADDRESS = "bookings@stor24.co.za";

/** Separate credentials; constructing/verifying this transport never changes EMAIL_PROVIDER. */
export function hostingerTransport() {
  const password = process.env.HOSTINGER_SMTP_PASSWORD;
  if (!password) throw new Error("Hostinger SMTP credential is not configured.");
  return nodemailer.createTransport({
    host: "smtp.hostinger.com", port: 465, secure: true,
    auth: { user: HOSTINGER_EMAIL_ADDRESS, pass: password },
    tls: { servername: "smtp.hostinger.com", minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    dnsTimeout: 8_000, pool: false, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

export class HostingerEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    // Preserve one customer per message; do not accept a comma-separated mailing list.
    if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(message.to) || /[\r\n]/.test(message.subject)) {
      throw new Error("Invalid email recipient or subject.");
    }
    const transport = hostingerTransport();
    try {
      const result = await transport.sendMail({
        from: { name: "Stor24", address: HOSTINGER_EMAIL_ADDRESS },
        envelope: { from: HOSTINGER_EMAIL_ADDRESS, to: [message.to] },
        to: [{ address: message.to }], subject: message.subject,
        text: message.text, html: message.html,
        disableFileAccess: true, disableUrlAccess: true,
      });
      if (result.rejected?.length || result.accepted?.length !== 1) {
        throw new Error("SMTP_RECIPIENT_NOT_ACCEPTED");
      }
      // SMTP acceptance is not inbox delivery. No delivery/read timestamp is manufactured.
    } catch {
      // Provider errors may contain credentials, recipient addresses or message content.
      // Never retry here: a timed-out response can follow an accepted message.
      throw new Error("Hostinger SMTP send failed or outcome uncertain; review before retrying.");
    } finally { transport.close(); }
  }
}
