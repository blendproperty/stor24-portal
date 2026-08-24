export type BlendSignLeaseState = "COMPLETED" | "AWAITING_SIGNATURE" | "DISPATCHING" | "DISPATCH_FAILED" | "OVERDUE" | "RECONCILIATION_REQUIRED";

type LeaseDocumentState = { status: string; externalId: string | null; createdAt: Date; expiresAt: Date | null; tenancyStatus: string };
const ACTIVE_TENANCY_STATES = new Set(["ACTIVE", "NOTICE_GIVEN"]);
const WAITING_DOCUMENT_STATES = new Set(["SENT", "PARTIALLY_SIGNED"]);

export function classifyBlendSignLease(document: LeaseDocumentState, now = new Date()): BlendSignLeaseState {
  const tenancyActive = ACTIVE_TENANCY_STATES.has(document.tenancyStatus);
  if (document.status === "SIGNED" && tenancyActive) return "COMPLETED";
  if (document.status === "SIGNED" || tenancyActive) return "RECONCILIATION_REQUIRED";
  if (!document.externalId && document.status === "PENDING") return now.getTime() - document.createdAt.getTime() >= 5 * 60_000 ? "DISPATCH_FAILED" : "DISPATCHING";
  if (WAITING_DOCUMENT_STATES.has(document.status) && document.expiresAt && document.expiresAt <= now) return "OVERDUE";
  if (document.externalId || WAITING_DOCUMENT_STATES.has(document.status)) return "AWAITING_SIGNATURE";
  return "RECONCILIATION_REQUIRED";
}

export const blendSignLeaseStateLabel = (state: BlendSignLeaseState) => ({ COMPLETED: "Completed", AWAITING_SIGNATURE: "Awaiting signature", DISPATCHING: "Dispatching", DISPATCH_FAILED: "Envelope not created", OVERDUE: "Signing overdue", RECONCILIATION_REQUIRED: "Reconciliation required" })[state];
export const blendSignLeaseStateNeedsAction = (state: BlendSignLeaseState) => state === "DISPATCH_FAILED" || state === "OVERDUE" || state === "RECONCILIATION_REQUIRED";
