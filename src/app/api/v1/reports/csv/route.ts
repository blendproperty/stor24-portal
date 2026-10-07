import { z } from "zod";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { requireFacility, requirePermissionScope } from "@/lib/scope";
import { currentRoleAccess } from "@/lib/current-role-access";
import { sameOrigin } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { guardReportExport } from "@/lib/dlp-export-service";
import { DLP_MAX_BYTES, dlpPrivateHeaders } from "@/lib/dlp-policy";
import { csvCell } from "@/lib/marketing-contract";
const schema = z.object({ kind: z.enum(["marketing", "advertising", "rent-review"]), rows: z.array(z.array(z.union([z.string().max(50000), z.number().finite()])).max(100)).min(1).max(5001), facilityId: z.string().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() });
/** Audits browser-selected workspace CSVs; this does not assert a database provenance for their supplied values. */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403, headers: dlpPrivateHeaders });
    const actor = await requirePermission("reports.export");
    const input = schema.parse(JSON.parse(new TextDecoder().decode(await boundedBody(new Response(request.body), DLP_MAX_BYTES))));
    const scope = await requirePermissionScope(input.kind === "rent-review" ? "reports.financial" : "leads.view");
    if (actor.allowedFacilityIds !== null) { scope.facilityIds = actor.allowedFacilityIds.filter(id => scope.unrestrictedFacilities || scope.facilityIds.includes(id)); scope.unrestrictedFacilities = false; }
    if (!scope.unrestrictedFacilities && !scope.facilityIds.length) throw new Error("FORBIDDEN");
    if (input.facilityId) await requireFacility(scope, input.facilityId);
    if (input.rows[0].some(value => typeof value !== "string")) throw new Error("CSV_INVALID");
    const headers = input.rows[0].map(String);
    if (headers.some(h => !h.trim()) || new Set(headers).size !== headers.length || input.rows.some(row => row.length > headers.length)) throw new Error("CSV_INVALID");
    const rows = input.rows.slice(1).map(row => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? ""])));
    const currentActor = await requirePermission("reports.export");
    const access = currentRoleAccess(currentActor.user.roleAssignments, "data.personal_export");
    const ids = input.facilityId ? [input.facilityId] : scope.facilityIds;
    const personalDataAllowed = access.allowed && (access.allowedFacilityIds === null || ((!!input.facilityId || !scope.unrestrictedFacilities) && ids.every(id => access.allowedFacilityIds!.includes(id))));
    const decision = await guardReportExport({ organisationId: actor.organisationId, actorId: actor.user.id, facilityId: input.facilityId, reportKey: input.kind === "rent-review" ? "rent-review-csv" : `${input.kind}-aggregate`, rows, personalDataAllowed, payloadSource: "browser-selected", format: "CSV", ...(input.from && input.to ? { period: { from: input.from, to: input.to } } : {}) });
    const secured = { ...dlpPrivateHeaders, "x-request-id": decision.requestId, "x-stor24-dlp-policy": decision.policyVersion, "x-stor24-data-classification": decision.classification };
    if (!decision.allowed) return Response.json({ error: { code: decision.reasons.includes("PERSONAL_EXPORT_PERMISSION_REQUIRED") ? "PERSONAL_EXPORT_FORBIDDEN" : "DLP_EXPORT_BLOCKED", requestId: decision.requestId } }, { status: decision.reasons.includes("PERSONAL_EXPORT_PERMISSION_REQUIRED") ? 403 : 422, headers: secured });
    return new Response("\uFEFF" + input.rows.map(row => row.map(csvCell).join(",")).join("\r\n"), { headers: { ...secured, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="stor24-${input.kind}.csv"` } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error && ["CSV_INVALID", "MANDATE_RESPONSE_TOO_LARGE", "MANDATE_RESPONSE_INVALID"].includes(error.message)) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the export data and reduce its size." } }, { status: 422, headers: dlpPrivateHeaders });
    return authErrorResponse(error);
  }
}
