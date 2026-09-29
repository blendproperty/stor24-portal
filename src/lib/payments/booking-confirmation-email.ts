import { db } from "@/lib/db";
import { emailProvider, escapeEmailHtml as safe, type EmailMessage } from "@/lib/email";
import type { Prisma } from "@/generated/prisma/client";

export type BookingConfirmation = { to: string; reference: string; unit: string; amount: string; test: boolean };
export function bookingConfirmationMessage(data: BookingConfirmation): EmailMessage {
  const portal = new URL("/my", process.env.APP_URL || "https://stor24-site.srv938083.hstgr.cloud");
  portal.searchParams.set("booking", data.reference);
  const title = data.test ? "TEST — no money received" : "Your payment is confirmed";
  const notice = data.test ? "Your sandbox transaction was verified. No real rent was paid. This is not a payment receipt and does not authorise key collection or precinct access." : "Your payment was verified through Netcash. This confirmation is not a tax invoice or approval for key collection or precinct access.";
  const next = "Open My STOR24 to review your booking. Before keys can be handed over, staff must confirm your move-in date, payment requirements, identity and approved access photograph. Photo collection and precinct access remain subject to activation.";
  return { to: data.to, subject: `${data.test ? "[TEST] " : ""}STOR24 payment confirmation · ${data.reference}`,
    text: `${title}\n\n${notice}\n\nBooking: ${data.reference}\nUnit: ${data.unit}\n${data.test ? "Test amount" : "Amount"}: R ${data.amount}\n\n${next}\n\nView My STOR24: ${portal}\n\nNeed help? https://stor4.srv938083.hstgr.cloud/contact\n\nSafe space. Smart storage. STOR24.`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f5f3ea;font-family:Arial,Helvetica,sans-serif;color:#071411"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:600px;background:white;border-top:6px solid #ff5a0a;border-radius:16px"><tr><td style="padding:28px"><div style="font-size:30px;font-weight:900">ST<span style="color:#ff5a0a">&#11042;</span>R24</div><h1 style="font-size:28px">${safe(title)}</h1><p style="line-height:1.7">${safe(notice)}</p><table role="presentation" width="100%" style="background:#f5f3ea;padding:16px;line-height:1.8"><tr><td>Booking</td><td><strong>${safe(data.reference)}</strong></td></tr><tr><td>Unit</td><td>${safe(data.unit)}</td></tr><tr><td>${data.test ? "Test amount" : "Amount"}</td><td>R ${safe(data.amount)}</td></tr></table><h2 style="font-size:20px">Your next steps</h2><p style="line-height:1.7">${safe(next)}</p><p style="padding:12px 0"><a href="${safe(portal.toString())}" style="display:inline-block;background:#ff5a0a;color:#fff;padding:14px 22px;border-radius:24px;text-decoration:none;font-weight:bold">View My STOR24 →</a></p><p>Need a hand? <a href="https://stor4.srv938083.hstgr.cloud/contact">Talk to your STOR24 store</a>.</p></td></tr><tr><td style="padding:20px;background:#071411;color:white">Safe space. Smart storage. STOR24.</td></tr></table></td></tr></table></body></html>` };
}

/** Queue once with the verified settlement. Never backfill previously completed payments. */
export async function queueBookingConfirmation(tx: Prisma.TransactionClient, paymentId: string, test: boolean) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { account: { include: { customer: true } } } });
  const { account } = payment;
  const customer = account.customer;
  const reservationId = account.accountNumber.startsWith("ST24-T-") ? account.accountNumber.slice(7) : "";
  const reservation = await tx.reservation.findFirst({ where: { id: reservationId, customerId: customer.id, facility: { organisationId: customer.organisationId }, publicLease: { status: "SIGNED" } }, include: { unit: true } });
  if (!reservation?.publicReference || !customer.email || !customer.emailVerifiedAt) return;
  const payload: BookingConfirmation = { to: customer.email, reference: reservation.publicReference, unit: reservation.unit?.number ?? "To be confirmed", amount: Number(payment.amount).toFixed(2), test };
  await tx.webhookOutbox.create({ data: { organisationId: customer.organisationId, facilityId: reservation.facilityId, eventType: "booking.payment_confirmation", aggregateType: "Payment", aggregateId: paymentId, destination: "email://booking-confirmation", payload, idempotencyKey: `booking-confirmation:${paymentId}` } });
}

/** Claim before sending. Ambiguous provider failures are retained for review, never blindly resent. */
export async function deliverBookingConfirmation(paymentId: string, send = (message: EmailMessage) => emailProvider().send(message)) {
  const idempotencyKey = `booking-confirmation:${paymentId}`;
  const claimed = await db.webhookOutbox.updateMany({ where: { idempotencyKey, status: "PENDING" }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
  if (!claimed.count) return;
  const entry = await db.webhookOutbox.findUniqueOrThrow({ where: { idempotencyKey } });
  try {
    await send(bookingConfirmationMessage(entry.payload as BookingConfirmation));
    await db.webhookOutbox.update({ where: { id: entry.id }, data: { status: "SUCCEEDED", deliveredAt: new Date() } });
  } catch {
    await db.webhookOutbox.update({ where: { id: entry.id }, data: { status: "FAILED", failureCode: "EMAIL_DELIVERY_REVIEW", failureMessage: "Delivery not confirmed. Review provider delivery before any resend." } });
  }
}
