import type { EmailMessage, EmailProvider } from "@/lib/email";

import { HOSTINGER_EMAIL_ADDRESS, hostingerTransport } from "./hostinger-transport.mjs";
export { HOSTINGER_EMAIL_ADDRESS, hostingerTransport } from "./hostinger-transport.mjs";

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
        to: [{ name: "", address: message.to }], subject: message.subject,
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
