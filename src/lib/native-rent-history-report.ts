import { z } from "zod";
import { ReportError, REPORT_SOURCE_LIMIT } from "./visual-report-engine";
import { southAfricaDateKey } from "./south-africa-time";
import type { VisualReportRow } from "./visual-report-contract";
import { rentReviewInput, increasedRate } from "./rent-review-policy";

const identity = z.string().min(1).max(100);
const rate = z.number().finite().min(0).max(10000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001);
const approvalSchema = z.object({
  batchId: z.uuid(), approvalReference: z.string().trim().min(5).max(250),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  request: rentReviewInput,
  changes: z.array(z.object({ occupancyId: identity, before: rate, after: rate })).min(1).max(1000),
});
export type RentApprovalEvent = { id: string; entityId: string; facilityId: string | null; facility: {name: string} | null; occurredAt: Date; after: unknown };
export type RentHistoryOccupancy = { id: string; tenancyId: string; unitId: string; unit: {number: string; facilityId: string}; tenancy: {facilityId: string; account: {accountNumber: string; currency: string}} };
const reviewText: Record<string,string> = {
  RATE_APPROVAL_PAYLOAD_REVIEW: "Approval details are incomplete or invalid.",
  RATE_APPROVAL_REFERENCE_REVIEW: "Original occupancy is missing or outside this store.",
  RATE_APPROVAL_CURRENCY_REVIEW: "The recorded currency needs review.",
  RATE_APPROVAL_DUPLICATE_REVIEW: "Approval batch or occupancy appears more than once.",
  RATE_APPROVAL_AMOUNT_REVIEW: "Recorded increase differs from the approved terms.",
};
const parse = (events: RentApprovalEvent[]) => {
  if (events.length > REPORT_SOURCE_LIMIT) throw new ReportError("REPORT_LIMIT");
  if (new Set(events.map(event => event.id)).size !== events.length) throw new ReportError("REPORT_RATE_REVIEW_REQUIRED");
  return events.map(event => ({event, approval: approvalSchema.safeParse(event.after)}));
};
export function rentHistoryReferenceIds(events: RentApprovalEvent[]) {
  const ids = new Set<string>();
  for (const {approval} of parse(events)) if (approval.success) for (const change of approval.data.changes) {
    ids.add(change.occupancyId);
    if (ids.size > REPORT_SOURCE_LIMIT) throw new ReportError("REPORT_LIMIT");
  }
  return [...ids];
}
/** Recorded approved increases only. Current labels are lookups, never historical snapshots.
 * No current rate, payment, invoice or effective baseline is reconstructed here. */
export function nativeRentHistoryRows(events: RentApprovalEvent[], occupancies: RentHistoryOccupancy[], options: {effectiveDateFilter?: boolean; totalingMoney?: boolean} = {}): VisualReportRow[] {
  const parsed = parse(events), indexed = new Map(occupancies.map(row => [row.id, row]));
  if (indexed.size !== occupancies.length) throw new ReportError("REPORT_RATE_REVIEW_REQUIRED");
  const batches = new Set<string>(), duplicates = new Set<string>();
  for (const {approval} of parsed) if (approval.success) {
    if (batches.has(approval.data.batchId)) duplicates.add(approval.data.batchId);
    batches.add(approval.data.batchId);
  }
  const rows: VisualReportRow[] = [];
  for (const {event, approval} of parsed) {
    const base = {facility: event.facility?.name ?? "Unassigned", approval: event.id, date: southAfricaDateKey(event.occurredAt), recordedAt: event.occurredAt.toISOString()};
    if (!approval.success) {
      if (options.effectiveDateFilter) throw new ReportError("REPORT_RATE_DATE_REVIEW");
      rows.push({...base, batch: null, approvalReference: null, effective: null, occupancy: null, tenancy: null, unit: null, account: null, previousRate: null, newRate: null, changeAmount: null, currency: null, verified: false, reviewCode: "RATE_APPROVAL_PAYLOAD_REVIEW", review: reviewText.RATE_APPROVAL_PAYLOAD_REVIEW});
    } else {
      const data = approval.data, counts = new Map<string, number>();
      for (const change of data.changes) counts.set(change.occupancyId, (counts.get(change.occupancyId) ?? 0) + 1);
      for (const change of data.changes) {
        const occupancy = indexed.get(change.occupancyId);
        const bound = occupancy && event.facilityId && event.entityId === event.facilityId && data.request.facilityId === event.facilityId && occupancy.unit.facilityId === event.facilityId && occupancy.tenancy.facilityId === event.facilityId;
        let ratesAgree = false;
        try { ratesAgree = increasedRate(change.before, data.request.type, data.request.value) === change.after; } catch { /* Invalid source amounts remain review rows. */ }
        const review = !bound ? "RATE_APPROVAL_REFERENCE_REVIEW" : occupancy.tenancy.account.currency !== "ZAR" ? "RATE_APPROVAL_CURRENCY_REVIEW" : counts.get(change.occupancyId)! > 1 || duplicates.has(data.batchId) ? "RATE_APPROVAL_DUPLICATE_REVIEW" : !ratesAgree ? "RATE_APPROVAL_AMOUNT_REVIEW" : null;
        const valid = review === null;
        rows.push({...base, batch: data.batchId, approvalReference: data.approvalReference, effective: data.request.effectivePeriod + "-01", occupancy: change.occupancyId, tenancy: bound ? occupancy.tenancyId : null, unit: bound ? occupancy.unit.number : null, account: bound ? occupancy.tenancy.account.accountNumber : null,
          previousRate: valid ? change.before.toFixed(2) : null, newRate: valid ? change.after.toFixed(2) : null, changeAmount: valid ? ((Math.round(change.after * 100) - Math.round(change.before * 100)) / 100).toFixed(2) : null, currency: valid ? "ZAR" : null, verified: valid, reviewCode: review, review: review ? reviewText[review] : null});
        if (rows.length > REPORT_SOURCE_LIMIT) throw new ReportError("REPORT_LIMIT");
      }
    }
    if (rows.length > REPORT_SOURCE_LIMIT) throw new ReportError("REPORT_LIMIT");
  }
  if (options.totalingMoney && rows.some(row => !row.verified)) throw new ReportError("REPORT_RATE_REVIEW_REQUIRED");
  return rows;
}
