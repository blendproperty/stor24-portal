import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { sameOrigin } from "@/lib/request-security";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { listAdditionalAccessPeople, nominateAdditionalAccessPerson, removeAdditionalAccessPerson } from "@/lib/additional-access-people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    return Response.json({ data: await listAdditionalAccessPeople(session, new URL(request.url).searchParams.get("reservationId") ?? "") }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const session = await requireTenantSession();
    if (await tenantRateLimit(`additional-access:${session.organisationId}:${session.email.toLowerCase()}`, 5, 60_000)) throw new Error("PHOTO_RATE_LIMITED");
    if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new Error("PERSON_INVALID");
    if (!request.body) throw new Error("PERSON_INVALID");
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new Error("PERSON_INVALID"); }
      chunks.push(next.value);
    }
    let data: unknown;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("PERSON_INVALID"); }
    if (!data || typeof data !== "object" || !("reservationId" in data) || !("name" in data) || typeof data.reservationId !== "string" || typeof data.name !== "string") throw new Error("PERSON_INVALID");
    return Response.json({ data: await nominateAdditionalAccessPerson(session, data.reservationId, data.name) }, { status: 201, headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const session = await requireTenantSession(), url = new URL(request.url);
    await removeAdditionalAccessPerson(session, url.searchParams.get("reservationId") ?? "", url.searchParams.get("id") ?? "");
    return Response.json({ data: { removed: true } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}
