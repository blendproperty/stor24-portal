import { approveCustomerFaceAccessRestoration, customerFaceAccessReadiness, reconcileCustomerFaceAccess } from "@/lib/hikcentral-customer-access";
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
    return Response.json({ data: { eligible: state.eligible, arrearsLocked: state.arrearsLocked, restorationReady: state.restorationReady, blockers: state.blockers, grants: state.grants.map(item => ({ accessLevelId: item.accessLevelId, status: item.status, grantedAt: item.grantedAt, revokedAt: item.revokedAt, lastError: item.lastError })) } }, { headers: tenantPrivateHeaders });
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
    const input = JSON.parse(body) as { customerId?: unknown; facilityId?: unknown; action?: unknown };
    if (typeof input.customerId !== "string" || typeof input.facilityId !== "string") throw Error("PHOTO_INVALID");
    if (input.action && input.action !== "restore") throw Error("PHOTO_INVALID");
    const data = input.action === "restore" ? await approveCustomerFaceAccessRestoration(scope, input.customerId, input.facilityId) : await reconcileCustomerFaceAccess(scope, input.customerId, input.facilityId);
    return Response.json({ data }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
