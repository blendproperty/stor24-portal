import type { RequestScope } from "./scope";

export const isCollectionLetter = (messageType: string | null) => messageType === "COLLECTION_REMINDER";

/** Delivery metadata has its own communication grant. A letter's arrears content also needs collection authority at that same store. */
export function canReadCollectionLetter(scope: RequestScope, communications: RequestScope | null, collections: RequestScope | null, facilityId: string | null) {
  if (!facilityId || !communications || !collections) return false;
  return [communications, collections].every(grant => grant.userId === scope.userId && grant.organisationId === scope.organisationId && (grant.unrestrictedFacilities || grant.facilityIds.includes(facilityId))) && (scope.unrestrictedFacilities || scope.facilityIds.includes(facilityId));
}
