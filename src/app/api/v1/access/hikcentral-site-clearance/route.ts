import { confirmHikCentralSiteEmpty, hikCentralSiteClearance } from "@/lib/hikcentral-customer-access";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { rateLimit, sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("access.manage");
    const facilityId = new URL(request.url).searchParams.get("facilityId") ?? "";
    if (!facilityId) throw Error("PHOTO_INVALID");
    return Response.json({ data: await hikCentralSiteClearance(scope, facilityId) }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request) || Number(request.headers.get("content-length") ?? 0) > 256) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage");
    if (await rateLimit(`hikcentral-site-clearance:${scope.organisationId}:${scope.userId}`, 3, 60_000)) throw Error("PHOTO_RATE_LIMITED");
    const text = await request.text();
    if (text.length > 256) throw Error("PHOTO_INVALID");
    const body = JSON.parse(text) as { facilityId?: unknown; confirmedEmpty?: unknown };
    if (typeof body.facilityId !== "string" || body.confirmedEmpty !== true) throw Error("PHOTO_INVALID");
    return Response.json({ data: await confirmHikCentralSiteEmpty(scope, body.facilityId) }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
