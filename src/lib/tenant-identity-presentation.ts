// Customer-visible metadata only. Never select the document, policy, or reviewer details.
export const tenantIdentitySelect = { status: true, acknowledgedAt: true, reviewedAt: true, expiresAt: true, retentionMode: true } as const;
export type TenantIdentity = { status: string; acknowledgedAt: string | Date; reviewedAt: string | Date | null; expiresAt: string | Date | null; retentionMode: string };

export function tenantIdentityMessage(document: TenantIdentity | null | undefined, now = Date.now()) {
  if (!document) return { title: "No ID upload recorded", detail: "Contact your store to arrange your identity check." };
  if (document.status === "ACCEPTED") return { title: "ID verified", detail: "Your identity document has been accepted by the store." };
  if (document.status === "REPLACEMENT_REQUIRED") return { title: "Replacement ID needed", detail: "The store needs a replacement document. Contact your store for the next step." };
  if (document.status === "WITHDRAWN") return { title: "ID upload withdrawn", detail: "Contact your store to arrange a new identity check." };
  const expired = document.retentionMode === "TENANCY" ? document.expiresAt !== null : !document.expiresAt || new Date(document.expiresAt).getTime() <= now;
  if (document.status === "EXPIRED" || (document.status === "AWAITING_REVIEW" && expired)) return { title: "ID upload expired", detail: "Your previous upload is no longer available for review. Contact your store to arrange a replacement." };
  if (document.status === "AWAITING_REVIEW") return { title: "ID uploaded — pending verification", detail: "We received your identity document. Our team still needs to review it before key handover. No further upload is needed unless we ask for a replacement." };
  return { title: "ID review status unavailable", detail: "Contact your store to confirm the next step." };
}
