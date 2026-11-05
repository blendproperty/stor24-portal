import { requirePermissionScope } from "@/lib/scope";
import { protectDlpResponse } from "@/lib/dlp-transfer-service";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { captureAdditionalPhoto, previewAdditionalPhoto, reviewAdditionalPhoto, withdrawAdditionalPhoto } from "@/lib/additional-access-people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("access.manage"), url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const bytes = await previewAdditionalPhoto(scope, id, Number(url.searchParams.get("version")));
    return await protectDlpResponse(new Response(new Uint8Array(bytes), { headers: { ...tenantPrivateHeaders, "Content-Type": "image/jpeg", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox" } }), { organisationId: scope.organisationId, actorId: scope.userId, resourceId: id });
  } catch (error) { return facialPhotoError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage");
    const form = await boundedPhotoForm(request), image = form.get("image");
    if (!(image instanceof File)) throw new Error("PHOTO_INVALID");
    await captureAdditionalPhoto(scope, { id: String(form.get("id") ?? ""), version: Number(form.get("version")), policyHash: String(form.get("policyHash") ?? ""), consent: form.get("consent") === "on", identityConfirmed: form.get("identityConfirmed") === "on", image });
    return Response.json({ data: { captured: true } }, { status: 201, headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage"), url = new URL(request.url), decision = url.searchParams.get("decision");
    if (decision !== "APPROVE" && decision !== "REJECT") throw new Error("PHOTO_CHANGED");
    await reviewAdditionalPhoto(scope, url.searchParams.get("id") ?? "", Number(url.searchParams.get("version")), decision);
    return Response.json({ data: { reviewed: true } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage"), url = new URL(request.url);
    await withdrawAdditionalPhoto(scope, url.searchParams.get("id") ?? "", Number(url.searchParams.get("version")));
    return Response.json({ data: { withdrawn: true } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
