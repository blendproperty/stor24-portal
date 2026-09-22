import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
export function identityError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const errors: Record<string, [number, string]> = {
    ID_SESSION_REQUIRED: [401, "Verify your email again to securely reopen this step."],
    UNAUTHENTICATED: [401, "Please sign in again."], FORBIDDEN: [403, "You do not have access to identity documents."],
    NOT_FOUND: [404, "This identity document is unavailable."], ID_BOOKING_UNAVAILABLE: [409, "This booking is no longer available for an upload. Contact your store."],
    ID_INVALID: [422, "Choose clear JPEG or PNG images, at least 400 pixels on each side, up to 6 MB each. Include both sides of an ID card."],
    ID_NOTICE_REQUIRED: [409, "Read and acknowledge the current privacy notice before continuing."],
    ID_CHANGED: [409, "This document has changed or expired. Refresh before continuing."],
    ID_PREVIEW_REQUIRED: [409, "Open every page of this version before accepting the document."],
    ID_REASON_REQUIRED: [422, "Choose a reason for requesting a replacement."],
    ID_POLICY_UNAVAILABLE: [503, "Online ID collection is not available. Contact your store for help."],
    ID_MAINTENANCE_REQUIRED: [503, "Secure upload is temporarily unavailable. Please try again later or contact your store."],
  };
  const [status, message] = errors[code] ?? [503, "Identity review is temporarily unavailable. Please try again later."];
  return Response.json({ error: { code: errors[code] ? code : "ID_UNAVAILABLE", message } }, { status, headers: tenantPrivateHeaders });
}
