import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { emailProvider, escapeEmailHtml, type EmailMessage } from "@/lib/email";

export function tenantWelcomeMessage(firstName: string | null, organisation: string, to: string): EmailMessage {
  if (!process.env.APP_URL) throw new Error("PORTAL_URL_UNCONFIGURED");
  const link = new URL("/my", process.env.APP_URL);
  if (process.env.NODE_ENV === "production" && link.protocol !== "https:") throw new Error("PORTAL_URL_UNCONFIGURED");
  link.searchParams.set("organisation", organisation);
  const safe = escapeEmailHtml;
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  return { to, subject: "Welcome to My STOR24 — your space, sorted.",
    text: `${greeting}\n\nWelcome to My STOR24. A little less admin. A lot more space.\n\nOpen My STOR24: ${link}\n\nView your account and statements, download statement PDFs, and find available payment receipts, issued invoices and signed agreements. Documents appear when issued; some may not be available yet.\n\nUse your registered email address to request a six-digit sign-in code. No password to remember. Codes expire after 10 minutes and sessions after 30 minutes. Never share your code. This link does not grant access on its own.\n\nThis welcome email does not confirm payment, a completed mandate or move-in/access approval.\n\nNeed a hand? Contact your STOR24 store: https://stor4.srv938083.hstgr.cloud/contact\n\nSafe space. Smart storage. STOR24.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f3ea;font-family:Arial,Helvetica,sans-serif;color:#071411">
<div style="display:none;max-height:0;overflow:hidden">Your statements, receipts and agreements. One secure space.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:20px;border-top:6px solid #ff5a0a">
<tr><td style="padding:30px 28px"><img src="${safe(link.origin)}/brand/stor24-logo-official-email-20260909.png" width="183" alt="STOR24" style="display:block;max-width:100%;height:auto"><p style="color:#ce4600;font-size:12px;letter-spacing:2px;font-weight:bold;margin-top:28px">WELCOME TO MY STOR24</p><h1 style="font-size:34px;line-height:1.12;margin:12px 0 22px">Your space.<br>Your account.<br>All sorted.</h1><p style="font-size:16px;line-height:1.6">${safe(greeting)}</p><p style="font-size:16px;line-height:1.6;color:#52615b">A little less admin. A lot more space. Your secure STOR24 account is ready to explore.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ea;border-radius:12px"><tr><td style="padding:20px;font-size:15px;line-height:1.8"><strong>Everything in its place</strong><br>View account balances and statements.<br>Download a statement PDF or email yourself a secure link.<br>Find available receipts, issued invoices and signed agreements.</td></tr></table>
<p style="font-size:13px;line-height:1.6;color:#52615b">Documents appear when issued. Some may not be available yet.</p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ff5a0a" style="border-radius:30px"><a href="${safe(link.toString())}" style="display:inline-block;padding:17px 26px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none">Open My STOR24 &rarr;</a></td></tr></table>
<h2 style="font-size:20px;margin-top:28px">No password. No fuss.</h2><p style="font-size:15px;line-height:1.7">1. Open My STOR24.<br>2. Enter your registered email address.<br>3. Enter the six-digit code we email you.</p><p style="font-size:13px;line-height:1.6;color:#52615b">Codes expire after 10 minutes; sessions end after 30 minutes. Never share your code, including with our team. This link alone does not grant account access.</p><p style="font-size:12px;line-height:1.6;color:#52615b">This welcome email does not confirm payment, a completed mandate or move-in/access approval.</p><p style="font-size:14px;line-height:1.6">Need a hand? <a href="https://stor4.srv938083.hstgr.cloud/contact" style="color:#071411">Talk to your STOR24 store</a>.</p></td></tr><tr><td style="padding:20px 28px;background:#071411;color:#fff;font-size:12px">Safe space. Smart storage. STOR24.</td></tr></table></td></tr></table></body></html>` };
}

/** Called only for a specific lifecycle event or explicit staff send. Never bulk-backfills existing customers. */
export async function sendTenantWelcome(customerId: string, organisationId: string, options: { resend?: boolean; actorId?: string } = {}, database = db, send = (message: EmailMessage) => emailProvider().send(message)) {
  const customer = await database.customer.findFirst({ where: { id: customerId, organisationId, emailVerifiedAt: { not: null }, OR: [{ accounts: { some: {} } }, { reservations: { some: { publicLease: { status: "SIGNED" } } } }] }, select: { firstName: true, email: true, organisation: { select: { slug: true } } } });
  if (!customer?.email) return "ineligible" as const;
  const email = customer.email.trim().toLowerCase();
  const message = tenantWelcomeMessage(customer.firstName, customer.organisation.slug, email);
  const id = createHash("sha256").update(`${organisationId}\0${email}`).digest("hex");
  await database.tenantPortalWelcome.upsert({ where: { id }, create: { id, organisationId, email }, update: {} });
  const claimed = await database.tenantPortalWelcome.updateMany({ where: { id, nextAttemptAt: { lte: new Date() }, ...(!options.resend ? { sentAt: null } : {}) }, data: { nextAttemptAt: new Date(Date.now() + 600000), attempts: { increment: 1 }, failed: false } });
  if (!claimed.count) return "already_sent_or_cooling_down" as const;
  try {
    await send(message);
  } catch {
    await database.tenantPortalWelcome.update({ where: { id }, data: { failed: true } });
    await database.auditEvent.create({ data: { organisationId, actorId: options.actorId, action: "tenant_portal.welcome_delivery_failed", entityType: "Customer", entityId: customerId } });
    throw new Error("WELCOME_DELIVERY_FAILED");
  }
  await database.tenantPortalWelcome.update({ where: { id }, data: { sentAt: new Date(), failed: false } });
  await database.auditEvent.create({ data: { organisationId, actorId: options.actorId, action: "tenant_portal.welcome_sent", entityType: "Customer", entityId: customerId } });
  return "sent" as const;
}

/** Email failure must not undo an already committed signature/account/verification. Staff can retry. */
export async function welcomeTenantWhenReady(customerId: string, organisationId: string) {
  try { await sendTenantWelcome(customerId, organisationId); }
  catch { console.error("My STOR24 welcome delivery needs staff review."); }
}
