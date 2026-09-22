import { requirePermissionScope } from "@/lib/scope";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { listFacialPhotos, previewFacialPhoto, reviewFacialPhoto } from "@/lib/facial-photo-service";
import { facialPhotoError } from "@/lib/facial-photo-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("preview") === "true") {
      const scope = await requirePermissionScope("access.manage");
      const bytes = await previewFacialPhoto(scope, url.searchParams.get("id") ?? "", Number(url.searchParams.get("version")));
      return new Response(new Uint8Array(bytes), { headers: { ...tenantPrivateHeaders, "Content-Type": "image/jpeg", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    return Response.json({ data: await listFacialPhotos(await requirePermissionScope("access.view")) }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage"), url = new URL(request.url);
    const decision = url.searchParams.get("decision");
    if (decision !== "APPROVE" && decision !== "REJECT") throw new Error("PHOTO_CHANGED");
    await reviewFacialPhoto(scope, url.searchParams.get("id") ?? "", Number(url.searchParams.get("version")), decision);
    return Response.json({ data: { reviewed: true } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
