import { db } from "./db";
import { emailProvider, escapeEmailHtml, type EmailMessage } from "./email";
import { recurringLease, paidUpfrontEvidence } from "./public-recurring-payments";
import { readRentalPlan } from "./public-rental-plan";
import { parseDebitOrderPreferences } from "./debit-order-preferences";
import { debitOrderSchedule } from "./debit-order-schedule";
import { mandatePolicy } from "./payments/netcash-mandate-policy";
import { southAfricaDateKey } from "./south-africa-time";

export async function sendMonthlyMandateInvitation(token: string, resend = false, database = db, send = (message: EmailMessage) => emailProvider().send(message)) {
  const lease = await recurringLease(token);
  const m = lease.mandate;
  const payment = await paidUpfrontEvidence(lease.reservation);
  if (lease.reservation.status !== "ACTIVE" || lease.expiresAt <= new Date() || readRentalPlan(lease.reservation.rentalPlan).futurePaymentMethod !== "DEBIT_ORDER" || !payment.ready || !lease.reservation.customer.email || m?.status !== "AWAITING_SIGNATURE" || !m.hostedUrl) return "NOT_READY" as const;
  const preferences = parseDebitOrderPreferences(lease.debitOrderPreferences, "0000-01-01");
  const terms = m.terms as { amount?: string; debitDay?: number; commencementMonth?: number } | null;
  const policy = mandatePolicy();
  const today = southAfricaDateKey(new Date());
  const anchor = preferences && preferences.firstCollectionDate < today ? preferences.firstCollectionDate : today;
  if (!policy || policy.organisationId !== lease.reservation.customer.organisationId || !debitOrderSchedule(lease.reservation, preferences, anchor, policy.allowedDays, true).ready || !preferences || !terms || Number(terms.amount) !== Number(lease.reservation.quotedRate) || terms.debitDay !== preferences.collectionDay || terms.commencementMonth !== Number(preferences.firstCollectionDate.slice(5, 7))) return "NOT_READY" as const;
  const now = new Date();
  const claimed = await database.publicDebitMandate.updateMany({ where: { id: m.id, ...(!resend ? { invitationSentAt: null } : {}), OR: [{ invitationAttemptAt: null }, { invitationAttemptAt: { lte: new Date(now.getTime() - 600000) } }] }, data: { invitationAttemptAt: now, invitationFailed: false } });
  if (!claimed.count) return m.invitationSentAt ? "EMAIL_ACCEPTED" as const : "COOLING_DOWN" as const;
  const customer = lease.reservation.customer;
  const to = customer.email!;
  const testMandate = payment.isTest || m.environment !== "live";
  const prefix = testMandate ? "TEST — " : "";
  const opening = payment.isTest ? "Your upfront test transaction is confirmed. It did not settle rent or approve access." : "Your upfront payment is confirmed.";
  const text = `Hi ${customer.firstName || "there"},\n\n${opening} You asked to pay future monthly rent by debit order.\n\nReview and sign your separate bank mandate securely with Netcash:\n${m.hostedUrl}\n\nMonthly rent: R ${Number(lease.reservation.quotedRate).toFixed(2)}. Your collection dates are shown on the mandate and start after the rental months included in your upfront payment.\n\nSigning authorises future collections; it does not charge another upfront payment. Bank details are entered with Netcash. Never email your bank details or OTP to STOR24.\n\n${testMandate ? "This mandate is for testing and collections remain disabled." : "STOR24 will confirm your recurring setup separately. Staff handover checks still apply."}\n\nSTOR24`;
  try {
    await send({ to, subject: `${prefix}Sign your future monthly debit-order mandate`, text, html: `<p>${escapeEmailHtml(text).replaceAll("\n", "<br>")}</p><p><a href="${escapeEmailHtml(m.hostedUrl)}">Open secure Netcash signing</a></p>`, dlp: { organisationId: customer.organisationId, facilityId: lease.reservation.facilityId, resourceId: m.id, approvedRecipient: to } });
    await database.publicDebitMandate.update({ where: { id: m.id }, data: { invitationSentAt: now, invitationFailed: false } });
    await database.auditEvent.create({ data: { organisationId: customer.organisationId, facilityId: lease.reservation.facilityId, action: "monthly_mandate.invitation_email_accepted", entityType: "PublicDebitMandate", entityId: m.id, after: { isTest: testMandate, upfrontIsTest: payment.isTest, collectionEnabled: false } } });
    return "EMAIL_ACCEPTED" as const;
  } catch {
    await database.publicDebitMandate.update({ where: { id: m.id }, data: { invitationFailed: true } });
    await database.auditEvent.create({ data: { organisationId: customer.organisationId, facilityId: lease.reservation.facilityId, action: "monthly_mandate.invitation_email_failed", entityType: "PublicDebitMandate", entityId: m.id } });
    return "FAILED" as const;
  }
}
