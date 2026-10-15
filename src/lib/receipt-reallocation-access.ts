import { requirePermissionScope, type RequestScope } from "./scope";

export function intersectReceiptScopes(scopes: RequestScope[]): RequestScope {
  const first = scopes[0];
  if (!first || scopes.some(s => s.userId !== first.userId || s.organisationId !== first.organisationId)) throw Error("FORBIDDEN");
  const limited = scopes.filter(s => !s.unrestrictedFacilities);
  const facilityIds = limited.length ? [...new Set(limited[0].facilityIds)].filter(id => limited.every(s => s.facilityIds.includes(id))) : [];
  if (limited.length && !facilityIds.length) throw Error("FORBIDDEN");
  return { ...first, unrestrictedFacilities: !limited.length, facilityIds };
}

export async function receiptCorrectionScope(action: "view" | "request" | "approve" = "view") {
  const scopes = [await requirePermissionScope("adjustments.view"), await requirePermissionScope("billing.view")];
  if (action !== "view") scopes.push(await requirePermissionScope(`adjustments.${action}`));
  return intersectReceiptScopes(scopes);
}

export async function receiptCorrectionCapabilities(scope: RequestScope) {
  const can = async (action: "request" | "approve") => {
    try { intersectReceiptScopes([scope, await receiptCorrectionScope(action)]); return true; }
    catch (error) { if (error instanceof Error && error.message === "FORBIDDEN") return false; throw error; }
  };
  return { canRequest: await can("request"), canApprove: await can("approve") };
}
