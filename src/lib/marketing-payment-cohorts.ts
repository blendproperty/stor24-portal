import type {BookingPriceEvidence} from "./reservation-price-evidence";
import { leadAttributionSchema } from "./lead-attribution";
import { readEnquiryLocation } from "./enquiry-location";
import { publicInitialRent } from "./public-initial-rent";
import { REPORT_SOURCE_LIMIT, ReportError } from "./visual-report-engine";
import type { VisualReportRow } from "./visual-report-contract";

export type CohortBooking = {
  id: string; facilityId: string; customerId: string; status: string;
  quotedRate: unknown; intendedMoveIn: Date | null; initialRentSnapshot: unknown;
  priceEvidence?: BookingPriceEvidence;
  convertedTenancyId: string | null;
  tenancy: {id: string; facilityId: string; customerId: string; accountId: string} | null;
};
export type CohortLead = {
  id: string; facilityId: string; facility: string; customerId: string | null;
  source: string; stage: string; createdAt: Date; enquiryLocation: unknown;
  bookings: CohortBooking[];
};
export type CohortAttribution = {leadId: string; facilityId: string | null; attribution: unknown; campaign: {id: string; facilityId: string; name: string} | null};
export type CohortOutcome = {accountId: string; facilityId: string; customerId: string; issue: string | null; overdueCents: number | null; netReceiptCents: number | null; receiptCount: number | null; hold: string | null};
const money = (value: number | null) => {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) throw new ReportError("INVALID_REPORT_AMOUNT");
  const n = BigInt(value), a = n < BigInt(0) ? -n : n;
  return `${n < BigInt(0) ? "-" : ""}${a / BigInt(100)}.${String(a % BigInt(100)).padStart(2, "0")}`;
};

/** One enquiry, including unconverted and review rows. Explicit identities alone
 * establish joins; billing addresses, current market rates and GA counts do not. */
export function marketingPaymentCohortRows(leads: CohortLead[], evidence: CohortAttribution[], outcomes: CohortOutcome[], asOf: string, totalingMoney = false): VisualReportRow[] {
  if (leads.length > REPORT_SOURCE_LIMIT || evidence.length > REPORT_SOURCE_LIMIT || outcomes.length > 2000) throw new ReportError("REPORT_LIMIT");
  if (new Set(leads.map(l => l.id)).size !== leads.length || new Set(outcomes.map(o => o.accountId)).size !== outcomes.length) throw new ReportError("REPORT_COHORT_REVIEW");
  const accountUses = new Map<string, number>();
  for (const lead of leads) for (const booking of lead.bookings) if (booking.tenancy?.accountId && booking.status === "CONVERTED") accountUses.set(booking.tenancy.accountId, (accountUses.get(booking.tenancy.accountId) ?? 0) + 1);
  const indexed = new Map(outcomes.map(o => [o.accountId, o]));
  const evidenceByLead = new Map<string, CohortAttribution[]>();
  for (const event of evidence) {
    const group = evidenceByLead.get(event.leadId) ?? [];
    group.push(event); evidenceByLead.set(event.leadId, group);
  }
  const rows = leads.map(lead => {
    const location = readEnquiryLocation(lead.enquiryLocation);
    const attributions = (evidenceByLead.get(lead.id) ?? []).filter(e => e.facilityId === lead.facilityId).map(e => ({e, parsed: leadAttributionSchema.safeParse(e.attribution)}));
    const valid = attributions.filter(v => v.parsed.success);
    const unique = new Set(valid.map(v => JSON.stringify(v.parsed.data)));
    const attribution = unique.size === 1 && valid.length === attributions.length ? valid[0] : undefined;
    const acquisition = attribution?.parsed.success ? attribution.parsed.data : null;
    const campaign = acquisition?.campaignId && attribution?.e.campaign?.id === acquisition.campaignId && attribution.e.campaign.facilityId === lead.facilityId ? attribution.e.campaign.name : !acquisition?.campaignId ? acquisition?.advertising?.campaign ?? "Unknown" : "Unknown";
    const converted = lead.bookings.filter(b => b.status === "CONVERTED");
    const booking = lead.bookings.length === 1 ? lead.bookings[0] : null;
    const linked = booking && booking.facilityId === lead.facilityId && lead.customerId && booking.customerId === lead.customerId;
    const tenancy = linked && booking.status === "CONVERTED" && booking.tenancy && booking.convertedTenancyId === booking.tenancy.id && booking.tenancy.facilityId === lead.facilityId && booking.tenancy.customerId === lead.customerId ? booking.tenancy : null;
    const outcome = tenancy ? indexed.get(tenancy.accountId) : null;
    const boundOutcome = outcome && outcome.facilityId === lead.facilityId && outcome.customerId === lead.customerId ? outcome : null;
    let price: string | null = null, priceReview: string | null = null;
    if (booking) {
      if (!linked) priceReview = "Booking identity needs review";
      else if (booking.priceEvidence?.issue) priceReview = booking.priceEvidence.issue;
      else if (booking.initialRentSnapshot == null) priceReview = "Original booking price snapshot is missing";
      else try {
        publicInitialRent(booking);
        const original=booking.priceEvidence?.original??booking;
        publicInitialRent(original);
        const rate = Number(original.quotedRate), cents = Math.round(rate * 100);
        if (rate <= 0 || !Number.isSafeInteger(cents) || Math.abs(rate * 100 - cents) > 0.000001) throw Error("INVALID_RATE");
        price = money(cents);
      } catch { priceReview = "Original booking price snapshot needs review"; }
    }
    const review = lead.bookings.length > 1 ? "Multiple bookings require an explicit attribution decision" : converted.length && !tenancy ? "Converted booking/tenancy identity needs review" : tenancy && accountUses.get(tenancy.accountId) !== 1 ? "Account appears in multiple enquiry/booking links" : tenancy && !boundOutcome ? "Scoped account outcome is unavailable" : boundOutcome?.issue ?? priceReview;
    const financial = review ? null : boundOutcome;
    return {
      facility: lead.facility, enquiry: lead.id, date: lead.createdAt.toISOString(), asOf,
      source: lead.source || "Unknown", acquisitionSource: acquisition?.source ?? "Unknown", medium: acquisition?.medium ?? "Unknown", campaign,
      locationSource: location?.source ?? "Unknown", city: location?.city || "Unknown", province: location?.province || "Unknown", postalCode: location?.postalCode || "Unknown",
      stage: lead.stage, bookingCount: lead.bookings.length, convertedCount: converted.length,
      booking: linked ? booking.id : null, originalMonthlyQuote: review ? null : price, currency: price !== null || financial ? "ZAR" : null,
      acceptedPriceChanges: review ? null : booking?.priceEvidence?.acceptedChanges ?? 0,
      latestAcceptedQuote: review ? null : booking?.priceEvidence?.latestAcceptedQuote ?? null,
      latestAcceptedAt: review ? null : booking?.priceEvidence?.latestAcceptedAt ?? null,
      netReceipts: financial ? money(financial.netReceiptCents) : null, overdue: financial ? money(financial.overdueCents) : null,
      paymentOutcome: review ? "REVIEW_REQUIRED" : !tenancy ? "NOT_CONVERTED" : financial?.overdueCents ? "OVERDUE" : financial?.receiptCount ? "VERIFIED_RECEIPTS_NO_OVERDUE" : "NO_VERIFIED_RECEIPTS",
      review, acquisitionReview: unique.size > 1 || attributions.some(a => !a.parsed.success) ? "Conflicting or invalid retained attribution" : acquisition?.campaignId && campaign === "Unknown" ? "Original campaign reference needs review" : null,
      hold: financial?.hold ?? null,
    };
  });
  if (totalingMoney && rows.some(row => row.review)) throw new ReportError("REPORT_COHORT_REVIEW");
  return rows;
}
