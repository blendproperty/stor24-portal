import { createHash } from "node:crypto";
import { escapeEmailHtml } from "@/lib/email";
export const COLLECTION_NOTICE_VERSION = "2026-10-13.1";
export function renderCollectionNotice(input: { accountNumber: string; facility: string; asOf: string; overdueCents: number; recipient: string }) {
  if (!Number.isSafeInteger(input.overdueCents) || input.overdueCents <= 0) throw Error("COLLECTION_NOTICE_HOLD");
  const url = new URL("/my", process.env.APP_URL || "https://portal.stor24.co.za"); if (url.protocol !== "https:") throw Error("COLLECTION_NOTICE_CONFIG");
  const amount = `${Math.floor(input.overdueCents / 100)}.${String(input.overdueCents % 100).padStart(2,"0")}`, subject = "STOR24 account payment reminder";
  const text = `Account ${input.accountNumber} · ${input.facility}\n\nOur records show R${amount} overdue as at ${input.asOf}. Please sign in to My STOR24 to review your account: ${url.toString()}\n\nIf you have already paid, or need to discuss this amount, please contact your STOR24 team so we can review it. This reminder does not add fees or change your account or access.\n\nSTOR24`;
  const html = `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#172b3b;max-width:640px;margin:auto;padding:24px"><h1>STOR24 account reminder</h1><p>Account ${escapeEmailHtml(input.accountNumber)} · ${escapeEmailHtml(input.facility)}</p><p>Our records show <strong>R${amount}</strong> overdue as at ${escapeEmailHtml(input.asOf)}.</p><p><a href="${escapeEmailHtml(url.toString())}">Sign in to My STOR24 to review your account</a></p><p>If you have already paid, or need to discuss this amount, please contact your STOR24 team so we can review it. This reminder does not add fees or change your account or access.</p><p>STOR24</p></body></html>`;
  return { recipient: input.recipient, subject, text, html, templateVersion: COLLECTION_NOTICE_VERSION };
}
export const noticeHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function collectionEmailConfigured() {
  if (process.env.EMAIL_PROVIDER === "hostinger") return Boolean(process.env.HOSTINGER_SMTP_PASSWORD);
  if (process.env.EMAIL_PROVIDER === "sendgrid") return Boolean(process.env.EMAIL_FROM && process.env.SENDGRID_API_KEY);
  if (process.env.EMAIL_PROVIDER === "resend") return Boolean(process.env.EMAIL_FROM && process.env.RESEND_API_KEY);
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}
