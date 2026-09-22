import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { boundedPhotoForm } from "@/lib/facial-photo-security";
import { submitTenantPhoto, tenantPhotoStatus, withdrawTenantPhoto } from "@/lib/facial-photo-service";
import { facialPhotoError } from "@/lib/facial-photo-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    return Response.json({ data: await tenantPhotoStatus(session, new URL(request.url).searchParams.get("reservationId") ?? "") }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const session = await requireTenantSession();
    if (await tenantRateLimit(`face-upload:${session.organisationId}:${session.email.toLowerCase()}`, 5, 60_000)) throw new Error("PHOTO_RATE_LIMITED");
    const form = await boundedPhotoForm(request), image = form.get("image");
    if (!(image instanceof File)) throw new Error("PHOTO_INVALID");
    const data = await submitTenantPhoto(session, { reservationId: String(form.get("reservationId") ?? ""), policyHash: String(form.get("policyHash") ?? ""), consent: form.get("consent") === "on", expectedVersion: Number(form.get("version")), image });
    return Response.json({ data }, { status: 201, headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const session = await requireTenantSession();
    const url = new URL(request.url);
    await withdrawTenantPhoto(session, url.searchParams.get("reservationId") ?? "", Number(url.searchParams.get("version")));
    return Response.json({ data: { withdrawn: true } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
