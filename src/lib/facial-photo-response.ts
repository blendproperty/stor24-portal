import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export function facialPhotoError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, [number, string]> = {
    TENANT_UNAUTHENTICATED: [401, "Your session has expired. Please sign in again."],
    UNAUTHENTICATED: [401, "Please sign in again."],
    TENANT_NOT_FOUND: [404, "This booking is unavailable."], NOT_FOUND: [404, "This photograph is unavailable."],
    PHOTO_INVALID: [422, "Choose a clear JPEG or PNG photograph, at least 160 pixels wide and high, up to 5 MB."],
    PHOTO_CONSENT_REQUIRED: [409, "Read and accept the current consent notice before continuing."],
    PHOTO_POLICY_PENDING: [409, "Photo collection is switched off or its settings are unavailable. Contact your store about access."],
    PHOTO_MAINTENANCE_REQUIRED: [503, "Photo collection is temporarily unavailable. Contact your store."],
    PHOTO_COUNTER_VISIT_REQUIRED: [409, "Check the access photo from your Counter visit with the store team."],
    PHOTO_BOOKING_NOT_READY: [409, "A signed agreement, verified booking payment and an active reservation are required."],
    PHOTO_CHANGED: [409, "This photograph has changed or expired. Refresh before continuing."],
    PHOTO_PREVIEW_REQUIRED: [409, "Open and review this version of the photograph before approving it."],
    PHOTO_RATE_LIMITED: [429, "Please wait a minute before trying again."],
    PERSON_INVALID: [422, "Enter a name between 2 and 100 characters."],
    PERSON_LIMIT: [409, "This booking already has the maximum number of nominations. Contact your store for help."],
    PHOTO_IDENTITY_REQUIRED: [409, "Confirm the nominated person's identity before capturing their photo."],
    HANDOFF_STAFF_SESSION: [409, "Open this link on a customer tablet without a staff login."],
    HIKCENTRAL_PERSON_LINK_REQUIRED: [409, "This customer's HikCentral identity needs manager review before a photo visit."],
    HIKCENTRAL_PERSON_LOOKUP_FAILED: [502, "HikCentral's person search could not be completed. Check the API connection and try again."],
    HIKCENTRAL_PERSON_DETAILS_REQUIRED: [409, "Use an individual STOR24 customer with a first and last name before preparing a HikCentral photo."],
    HIKCENTRAL_DEPARTMENT_REQUIRED: [409, "The STOR24 department could not be confirmed in HikCentral. Ask the integration manager to check it."],
    HIKCENTRAL_PERSON_REVIEW_REQUIRED: [409, "HikCentral may already have this person. Ask the integration manager to review the record before sending the photo."],
    HIKCENTRAL_VISIT_NOT_READY: [409, "A supervised visit needs a customer without a tenancy, a current reviewed photo, and an integration manager's approval."],
    HIKCENTRAL_VISIT_ALREADY_APPROVED: [409, "This customer already has an active supervised visit. Check or revoke it before starting another."],
    HIKCENTRAL_TEST_GRANT_NOT_READY: [409, "The controlled test needs an authorised integration manager, the exact accepted HikCentral person, a reviewed recent photo, a reason, and no other access blockers."],
    HIKCENTRAL_LOCK_REASON_REQUIRED: [422, "Enter a reason of 8 to 200 characters for the manager access change."],
    HIKCENTRAL_LOCK_NOT_ACTIVE: [409, "This customer has no active manager lock to remove."],
  };
  const [status, message] = code.includes("FORBIDDEN") ? [403, "You do not have access to this action."] : messages[code] ?? [503, "Facial access is temporarily unavailable. Please try again later."];
  return Response.json({ error: message }, { status, headers: tenantPrivateHeaders });
}
