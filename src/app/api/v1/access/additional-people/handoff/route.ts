import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { issueAdditionalPhotoHandoff } from "@/lib/additional-access-people";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    if (Number(request.headers.get("content-length") ?? 0) > 1024) throw new Error("PHOTO_INVALID");
    const scope = await requirePermissionScope("access.manage");
    const data = await request.json();
    if (!data || typeof data.id !== "string" || !Number.isSafeInteger(data.version) || data.identityConfirmed !== true) throw new Error("PHOTO_IDENTITY_REQUIRED");
    const result = await issueAdditionalPhotoHandoff(scope, data.id, data.version, true);
    return Response.json({ data: result }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
