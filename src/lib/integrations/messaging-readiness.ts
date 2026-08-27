export type MessagingChannel = "Email" | "SMS" | "WhatsApp";

type MessagingEnvironment = {
  [key: string]: string | undefined;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  SENDGRID_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_SMS_FROM?: string;
  TWILIO_WHATSAPP_FROM?: string;
  TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID?: string;
};

function present(value: string | undefined) {
  return Boolean(value?.trim());
}

export function configuredMessagingChannels(env: MessagingEnvironment): Set<MessagingChannel> {
  const channels = new Set<MessagingChannel>();
  const twilioCredentials = present(env.TWILIO_ACCOUNT_SID) && present(env.TWILIO_AUTH_TOKEN);
  const emailProvider = env.EMAIL_PROVIDER?.trim().toLowerCase();
  const emailConfigured = emailProvider === "resend"
    ? present(env.RESEND_API_KEY) && present(env.EMAIL_FROM)
    : emailProvider === "sendgrid"
      ? present(env.SENDGRID_API_KEY) && present(env.EMAIL_FROM)
      : (emailProvider === "twilio" || !emailProvider) && twilioCredentials;

  if (emailConfigured) channels.add("Email");
  if (twilioCredentials && present(env.TWILIO_SMS_FROM)) channels.add("SMS");
  if (twilioCredentials && present(env.TWILIO_WHATSAPP_FROM) && present(env.TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID)) channels.add("WhatsApp");
  return channels;
}

export function messagingReadiness(configured: Set<MessagingChannel>, verified: Set<MessagingChannel>) {
  const required: MessagingChannel[] = ["Email", "SMS", "WhatsApp"];
  const missing = required.filter((channel) => !configured.has(channel));
  const awaitingTest = required.filter((channel) => configured.has(channel) && !verified.has(channel));

  if (!missing.length && !awaitingTest.length) {
    return { state: "Connected", detail: "Email, SMS and WhatsApp provider delivery verified", tone: "positive" } as const;
  }
  if (!missing.length) {
    return { state: "Ready to test", detail: `Run a live test for ${awaitingTest.join(", ")}`, tone: "warning" } as const;
  }
  return { state: "Configuration required", detail: `Configure ${missing.join(", ")}`, tone: "warning" } as const;
}
