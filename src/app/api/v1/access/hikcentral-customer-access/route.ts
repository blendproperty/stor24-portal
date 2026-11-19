import { approveCustomerFaceAccessRestoration, approveCustomerFaceVisit, customerFaceAccessReadiness, reconcileCustomerFaceAccess, revokeCustomerFaceVisit, setCustomerFaceManualLock } from "@/lib/hikcentral-customer-access";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { rateLimit, sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("access.view");
    const url = new URL(request.url), customerId = url.searchParams.get("customerId") ?? "", facilityId = url.searchParams.get("facilityId") ?? "";
    if (!customerId || !facilityId) throw Error("PHOTO_INVALID");
    const state = await customerFaceAccessReadiness(scope, customerId, facilityId);
    return Response.json({ data: { eligible: state.eligible, approvalExpiresAt: state.approvalExpiresAt, arrearsLocked: state.arrearsLocked, manuallyLocked: state.manuallyLocked, accessLocked: state.accessLocked, restorationReady: state.restorationReady, blockers: state.blockers, grants: state.grants.map(item => ({ accessLevelId: item.accessLevelId, status: item.status, grantedAt: item.grantedAt, revokedAt: item.revokedAt, lastError: item.lastError })) } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request) || Number(request.headers.get("content-length") ?? 0) > 1024) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage");
    await requirePermissionScope("integrations.manage");
    if (await rateLimit(`hikcentral-access:${scope.organisationId}:${scope.userId}`, 5, 60_000)) throw Error("PHOTO_RATE_LIMITED");
    const body = await request.text();
    if (body.length > 1024) throw Error("PHOTO_INVALID");
    const input = JSON.parse(body) as { customerId?: unknown; facilityId?: unknown; action?: unknown; photoMatchesId?: unknown; reason?: unknown };
    if (typeof input.customerId !== "string" || typeof input.facilityId !== "string") throw Error("PHOTO_INVALID");
    if (input.action && !["restore", "approve-visit", "revoke-visit", "manager-lock", "manager-unlock"].includes(input.action as string)) throw Error("PHOTO_INVALID");
    const data = input.action === "restore" ? await approveCustomerFaceAccessRestoration(scope, input.customerId, input.facilityId) : input.action === "approve-visit" ? await approveCustomerFaceVisit(scope, input.customerId, input.facilityId, input.photoMatchesId === true) : input.action === "revoke-visit" ? await revokeCustomerFaceVisit(scope, input.customerId, input.facilityId) : input.action === "manager-lock" || input.action === "manager-unlock" ? await setCustomerFaceManualLock(scope, input.customerId, input.facilityId, input.action === "manager-lock", typeof input.reason === "string" ? input.reason : "") : await reconcileCustomerFaceAccess(scope, input.customerId, input.facilityId);
    return Response.json({ data }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
