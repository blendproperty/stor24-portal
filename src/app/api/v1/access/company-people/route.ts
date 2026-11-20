import { addCompanyFacePerson } from "@/lib/company-face-people";
import { rateLimit, sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request) || Number(request.headers.get("content-length") ?? 0) > 1024) throw Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage");
    if (await rateLimit(`company-face-person:${scope.organisationId}:${scope.userId}`, 5, 60_000)) throw Error("RATE_LIMITED");
    const raw = await request.text();
    if (raw.length > 1024) throw Error("COMPANY_PERSON_INVALID");
    const input = JSON.parse(raw);
    if (!input || typeof input.companyId !== "string" || typeof input.firstName !== "string" || typeof input.lastName !== "string") throw Error("COMPANY_PERSON_INVALID");
    const data = await addCompanyFacePerson(scope, input);
    return Response.json({ data }, { headers: tenantPrivateHeaders });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code === "RATE_LIMITED" ? 429 : code === "COMPANY_PERSON_INVALID" || error instanceof SyntaxError ? 422 : 503;
    return Response.json({ error: status === 422 ? "Choose a company, enter the authorised person's first and last name, and confirm company authorisation." : status === 429 ? "Please wait a minute before adding another person." : status === 401 ? "Please sign in again." : status === 403 ? "You do not have access to this action." : "The person could not be added. Please try again." }, { status, headers: tenantPrivateHeaders });
  }
}
