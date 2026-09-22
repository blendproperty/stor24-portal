import { publicApiAuthorized, publicReservationReferenceSchema } from "@/lib/public-booking-contract";
import { boundedIdentityForm } from "@/lib/identity-document-security";
import { identityStatus, submitIdentity, withdrawIdentity } from "@/lib/identity-document-service";
import { identityError } from "@/lib/identity-document-response";
import { tenantPrivateHeaders as headers } from "@/lib/tenant-portal-response";
import { privacyHash, rateLimit } from "@/lib/request-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    if (!publicApiAuthorized(request)) throw new Error("UNAUTHENTICATED");
    const url = new URL(request.url), reference = publicReservationReferenceSchema.parse(url.searchParams.get("reference"));
    const token = request.headers.get("x-stor24-identity-access") ?? "";
    // Authenticate before buffering any sensitive upload.
    const status = await identityStatus(reference, token);
    if (request.method === "GET") return Response.json({ data: status }, { headers });
    if (await rateLimit(`identity-upload:${privacyHash(reference)}`, 12, 15 * 60 * 1000)) return Response.json({ error: { message: "Please wait before trying another upload." } }, { status: 429, headers });
    if (request.method === "DELETE") {
      await withdrawIdentity(reference, token, Number(url.searchParams.get("version")));
    } else {
      if (!status.required || !status.available) throw new Error("ID_POLICY_UNAVAILABLE");
      const form = await boundedIdentityForm(request);
      await submitIdentity(reference, token, { expectedVersion: Number(form.get("expectedVersion")), policyHash: String(form.get("policyHash") ?? ""), acknowledged: form.get("acknowledged") === "true", documentType: String(form.get("documentType") ?? ""), pages: form.getAll("pages") as File[] });
    }
    return Response.json({ data: await identityStatus(reference, token) }, { headers });
  } catch (error) { return identityError(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
