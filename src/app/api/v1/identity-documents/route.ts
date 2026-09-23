import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { identityError } from "@/lib/identity-document-response";
import { listIdentityDocuments, previewIdentity, reviewIdentity } from "@/lib/identity-document-service";
import { tenantPrivateHeaders as headers } from "@/lib/tenant-portal-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("identity.review"), url = new URL(request.url);
    if (url.searchParams.get("preview") === "true") {
      const bytes = await previewIdentity(scope, url.searchParams.get("id") ?? "", Number(url.searchParams.get("version")), Number(url.searchParams.get("page")));
      return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    return Response.json({ data: await listIdentityDocuments(scope, url.searchParams.get("reservation") || undefined) }, { headers });
  } catch (error) { return identityError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("identity.review");
    const body = await request.json();
    if (typeof body.id !== "string" || !Number.isInteger(body.version) || !["ACCEPT", "REPLACE"].includes(body.decision)) throw new Error("ID_CHANGED");
    await reviewIdentity(scope, body.id, body.version, body.decision, body.reason);
    return Response.json({ data: { reviewed: true } }, { headers });
  } catch (error) { return identityError(error); }
}
