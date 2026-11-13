import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { captureAdditionalPhotoHandoff } from "@/lib/additional-access-people";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { sameOrigin } from "@/lib/request-security";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    if (await getSession()) throw new Error("HANDOFF_STAFF_SESSION");
    const form = await boundedPhotoForm(request), image = form.get("image");
    if (!(image instanceof File)) throw new Error("PHOTO_INVALID");
    await captureAdditionalPhotoHandoff(String(form.get("token") ?? ""), { policyHash: String(form.get("policyHash") ?? ""), consent: form.get("consent") === "on", image });
    return Response.json({ data: { captured: true } }, { status: 201, headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
