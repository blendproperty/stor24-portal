import { disableHikCentralLockPolicy, hikCentralLockPolicy, saveHikCentralLockPolicy } from "@/lib/hikcentral-lock-policy";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { rateLimit, sameOrigin } from "@/lib/request-security";
import { requireFacility, requirePermissionScope } from "@/lib/scope";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("integrations.view");
    const facilityId = new URL(request.url).searchParams.get("facilityId") ?? "";
    await requireFacility(scope, facilityId);
    return Response.json({ data: await hikCentralLockPolicy(scope.organisationId, facilityId) }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function PUT(request: Request) {
  try {
    if (!sameOrigin(request) || Number(request.headers.get("content-length") ?? 0) > 5000) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("integrations.manage");
    if (await rateLimit(`hikcentral-lock-policy:${scope.organisationId}:${scope.userId}`, 3, 60_000)) throw Error("PHOTO_RATE_LIMITED");
    const text = await request.text();
    if (text.length > 5000) throw Error("PHOTO_INVALID");
    return Response.json({ data: await saveHikCentralLockPolicy(scope, JSON.parse(text)) }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("integrations.manage");
    const facilityId = new URL(request.url).searchParams.get("facilityId") ?? "";
    await disableHikCentralLockPolicy(scope, facilityId);
    return Response.json({ data: { disabled: true } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
