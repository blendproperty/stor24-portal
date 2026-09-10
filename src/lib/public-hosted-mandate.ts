import { createHash, randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import { preparePublicReservationLease } from "@/lib/public-lease-workflow";
import { getNetcashConnection } from "@/lib/payments/netcash-client";
import { mandatePolicy } from "@/lib/payments/netcash-mandate-policy";
import { addHostedMandate, requestMandateData, retrieveMandateData, requestMandatePdf, retrieveMandatePdf, validateMandateTerms, verifyMandateReport, type MandateTerms } from "@/lib/payments/netcash-mandate";
import { NETCASH_SOFTWARE_VENDOR_KEY } from "@/lib/integrations/netcash-configuration";
import { parseDebitOrderPreferences } from "@/lib/debit-order-preferences";

function view(m: { status: string; reference: string; hostedUrl: string | null; verifiedAt: Date | null; failureCode: string | null; signedPdfSha256?: string | null }) {
  return { status: m.status, reference: m.reference, hostedUrl: m.status === "AWAITING_SIGNATURE" ? m.hostedUrl : null, verifiedAt: m.verifiedAt?.toISOString() ?? null, failureCode: m.failureCode, pdfAvailable: !!m.signedPdfSha256, collectionEnabled: false };
}
async function findLease(token: string) {
  const lease = await db.publicReservationLease.findUnique({ where: { signingToken: token }, include: { mandate: true, reservation: { include: { customer: true } } } });
  if (!lease || lease.status !== "SIGNED" || lease.paymentMethod !== "DEBIT_ORDER") throw new Error("MANDATE_BOOKING_UNAVAILABLE");
  return lease;
}
export async function hostedMandateStatus(token: string) {
  const lease = await findLease(token);
  const policy = mandatePolicy();
  const scoped = policy?.organisationId === lease.reservation.customer.organisationId ? policy : null;
  const available = lease.reservation.status === "ACTIVE" && lease.expiresAt > new Date();
  return { enabled: !!scoped && available, allowedDays: scoped?.allowedDays ?? [], noticeDays: scoped?.noticeDays ?? null, holiday: scoped?.holiday ?? null, mandate: lease.mandate ? { ...view(lease.mandate), ...(!available ? { hostedUrl: null } : {}) } : null };
}
export async function startHostedMandate(token: string) {
  const lease = await findLease(token);
  if (lease.expiresAt <= new Date() || lease.reservation.status !== "ACTIVE") throw new Error("MANDATE_BOOKING_UNAVAILABLE");
  const policy = mandatePolicy();
  if (!policy || policy.organisationId !== lease.reservation.customer.organisationId) throw new Error("MANDATE_CONFIGURATION_REQUIRED");
  if (lease.mandate) return view(lease.mandate); // One provider request per signed lease, even after ambiguous timeout.
  const same = await preparePublicReservationLease(lease.reservation.publicReference!, "DEBIT_ORDER");
  if (!same.ok || same.status !== "SIGNED") throw new Error("MANDATE_AGREEMENT_CHANGED");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const preferences = parseDebitOrderPreferences(lease.debitOrderPreferences, today);
  // Standard eMandate exposes commencement month/day, NOT a separate first-payment
  // date or year. Never silently translate mismatched dates or a future year.
  if (!preferences || !policy.allowedDays.includes(preferences.collectionDay) || Number(preferences.firstCollectionDate.slice(8)) !== preferences.collectionDay || preferences.firstCollectionDate.slice(0, 4) !== today.slice(0, 4)) throw new Error("MANDATE_SCHEDULE_REVIEW_REQUIRED");
  const customer = lease.reservation.customer;
  if (customer.type !== "INDIVIDUAL" || customer.companyName) throw new Error("MANDATE_BUSINESS_DETAILS_REQUIRED");
  const connection = await getNetcashConnection(customer.organisationId);
  if (!connection.config.debitOrderServiceKey) throw new Error("MANDATE_CONFIGURATION_REQUIRED");
  // Current merchant configuration is test-only. Explicit live approval is a later gate.
  if (connection.config.environment !== "sandbox" || !/^5\d{10}$/.test(connection.config.merchantAccount ?? "")) throw new Error("MANDATE_LIVE_SETUP_NOT_APPROVED");
  const terms: MandateTerms = { reference: `ST24${randomBytes(9).toString("hex")}`, agreementReference: lease.reservation.publicReference!, agreementDate: lease.signedAt!.toISOString().slice(0, 10).replaceAll("-", ""), firstName: customer.firstName ?? "", surname: customer.lastName ?? "", phone: (customer.phone ?? "").replace(/^\+?27/, "0").replace(/\s/g, ""), email: customer.email ?? "", amount: lease.reservation.quotedRate.toFixed(2), commencementMonth: Number(preferences.firstCollectionDate.slice(5, 7)), debitDay: preferences.collectionDay, noticeDays: policy.noticeDays, holiday: policy.holiday, correlation: randomBytes(24).toString("base64url") };
  validateMandateTerms(terms);
  // Unique leaseId is the concurrency guard. A losing caller must NOT call provider.
  const m = await db.$transaction(async tx => {
    const claim = await tx.publicReservationLease.updateMany({ where: { id: lease.id, mandate: { is: null }, debitOrderPreferences: { equals: lease.debitOrderPreferences! } }, data: { debitOrderRequestedAt: lease.debitOrderRequestedAt ?? new Date() } });
    if (!claim.count) throw new Error("MANDATE_DETAILS_CHANGED");
    const created = await tx.publicDebitMandate.create({ data: { leaseId: lease.id, reference: terms.reference, correlation: terms.correlation, terms } });
    await tx.auditEvent.create({ data: { organisationId: customer.organisationId, facilityId: lease.reservation.facilityId, action: "public_mandate.creation_started", entityType: "PublicDebitMandate", entityId: created.id, after: { reference: terms.reference, amount: terms.amount, approvedBy: policy.approvedBy, collectionEnabled: false } } });
    return created;
  });
  try {
    const hostedUrl = await addHostedMandate(connection.config.debitOrderServiceKey, terms);
    return view(await db.publicDebitMandate.update({ where: { id: m.id }, data: { status: "AWAITING_SIGNATURE", hostedUrl } }));
  } catch (error) {
    const code = error instanceof Error && /^MANDATE_[A-Z0-9_]+$/.test(error.message) ? error.message : "MANDATE_PROVIDER_OUTCOME_UNKNOWN";
    await db.publicDebitMandate.update({ where: { id: m.id }, data: { status: "REVIEW_REQUIRED", failureCode: code } });
    throw new Error(code); // Never blindly reissue a potentially created mandate.
  }
}
export async function refreshHostedMandate(token: string) {
  const lease = await findLease(token);
  const m = lease.mandate;
  if (!m) throw new Error("MANDATE_NOT_STARTED");
  if (m.status === "CREATING" || m.status === "REVIEW_REQUIRED" || (m.lastCheckedAt && Date.now() - m.lastCheckedAt.getTime() < 30_000)) return view(m);
  const claimed = await db.publicDebitMandate.updateMany({ where: { id: m.id, lastCheckedAt: m.lastCheckedAt }, data: { lastCheckedAt: new Date() } });
  if (!claimed.count) return view(m);
  const connection = await getNetcashConnection(lease.reservation.customer.organisationId);
  const key = connection.config.debitOrderServiceKey;
  if (!key) throw new Error("MANDATE_CONFIGURATION_REQUIRED");
  if (m.status === "SIGNED" && !m.signedPdf) {
    if (!m.pdfToken) {
      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const pdfToken = await requestMandatePdf(key, m.reference, NETCASH_SOFTWARE_VENDOR_KEY, date);
      await db.publicDebitMandate.update({ where: { id: m.id }, data: { pdfToken } });
      return view(m);
    }
    const pdf = await retrieveMandatePdf(key, m.pdfToken, m.reference);
    const document = await PDFDocument.load(pdf);
    if (document.getPageCount() < 1) throw new Error("MANDATE_PDF_INVALID");
    const signedPdfSha256 = createHash("sha256").update(pdf).digest("hex");
    return view(await db.publicDebitMandate.update({ where: { id: m.id }, data: { signedPdf: pdf, signedPdfSha256 } }));
  }
  if (!m.reportToken || !m.reportRequestedAt || Date.now() - m.reportRequestedAt.getTime() > 120_000) {
    const reportToken = await requestMandateData(key);
    await db.publicDebitMandate.update({ where: { id: m.id }, data: { reportToken, reportRequestedAt: new Date() } });
    return view(m); // Provider asynchronous report: next customer refresh retrieves it.
  }
  const report = await retrieveMandateData(key, m.reportToken);
  const status = verifyMandateReport(report, m.terms as MandateTerms);
  // The raw account-wide report is neither persisted nor returned to the customer.
  return db.$transaction(async tx => {
    const updated = await tx.publicDebitMandate.update({ where: { id: m.id }, data: { status, reportToken: null, verifiedAt: status === "SIGNED" ? new Date() : null } });
    if (status !== m.status) {
      await tx.auditEvent.create({ data: { organisationId: lease.reservation.customer.organisationId, facilityId: lease.reservation.facilityId, action: "public_mandate.provider_status_verified", entityType: "PublicDebitMandate", entityId: m.id, after: { status, reference: m.reference, collectionEnabled: false } } });
      await tx.task.updateMany({ where: { id: `public-debit-order-${lease.id}`, customerId: lease.reservation.customerId }, data: { title: status === "SIGNED" ? `Confirm first payment and move-in ${lease.reservation.publicReference}` : `Review mandate ${lease.reservation.publicReference}`, description: `Netcash mandate ${m.reference}: ${status}, independently checked with the provider. No collection has been submitted. Confirm the initial payment, any deposit/package charges and move-in readiness separately. Do not request bank details by email.`, priority: "HIGH" } });
    }
    return view(updated);
  });
}
export async function hostedMandatePdf(token: string) {
  const lease = await findLease(token);
  const m = lease.mandate;
  if (!m?.signedPdf || !m.signedPdfSha256 || createHash("sha256").update(m.signedPdf).digest("hex") !== m.signedPdfSha256) throw new Error("MANDATE_PDF_PENDING");
  return { pdf: m.signedPdf, reference: m.reference };
}
