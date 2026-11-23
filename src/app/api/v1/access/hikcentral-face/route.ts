import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { decideHikCentralFace, issueHikCentralFaceHandoff, previewHikCentralFace } from "@/lib/hikcentral-face-capture";
import { rateLimit, sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("access.manage");
    const url = new URL(request.url), id = url.searchParams.get("id") ?? "", version = Number(url.searchParams.get("version"));
    const bytes = await previewHikCentralFace(scope, id, version);
    return await protectDlpResponse(new Response(new Uint8Array(bytes), { headers: { ...tenantPrivateHeaders, "Content-Type": "image/jpeg", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox" } }), { organisationId: scope.organisationId, actorId: scope.userId, resourceId: id });
  } catch (error) { return facialPhotoError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request) || Number(request.headers.get("content-length") ?? 0) > 2048) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage");
    if (await rateLimit(`hikcentral-face:${scope.organisationId}:${scope.userId}`, 10, 60_000)) throw Error("PHOTO_RATE_LIMITED");
    const body = await request.text();
    if (body.length > 2048) throw Error("PHOTO_INVALID");
    const input = JSON.parse(body);
    if (input?.action === "prepare") {
      if (typeof input.customerId !== "string" || typeof input.facilityId !== "string" || !Number.isSafeInteger(input.version) || input.version < 0 || (input.identityChecked !== true && input.syntheticTest !== true)) throw Error("PHOTO_IDENTITY_REQUIRED");
      if (input.syntheticTest === true) {
        const manager = await requirePermissionScope("integrations.manage");
        if (!manager.unrestrictedFacilities || !scope.unrestrictedFacilities || typeof input.syntheticTestReason !== "string" || input.syntheticTestReason.trim().length < 8 || input.syntheticTestReason.trim().length > 200 || input.testAcknowledged !== true) throw Error("HIKCENTRAL_TEST_GRANT_NOT_READY");
      }
      const data = await issueHikCentralFaceHandoff(scope, input);
      return Response.json({ data }, { headers: tenantPrivateHeaders });
    }
    if (!input || typeof input.id !== "string" || !Number.isSafeInteger(input.version) || input.version < 1 || !["SEND", "REJECT"].includes(input.action)) throw Error("PHOTO_CHANGED");
    if (input.action === "SEND") await requirePermissionScope("integrations.manage");
    const data = await decideHikCentralFace(scope, input.id, input.version, input.action);
    return Response.json({ data }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
