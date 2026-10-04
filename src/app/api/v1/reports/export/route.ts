import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { buildReportRows } from "@/lib/report-data-service";
import { findPermittedReport, isCurrentSnapshotReport, reportParametersSchema, toCsv } from "@/lib/reporting";
import { requireFacility, requirePermissionScope } from "@/lib/scope";
import { guardReportExport } from "@/lib/dlp-export-service";
import { dlpPrivateHeaders } from "@/lib/dlp-policy";
import { rateLimit } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requirePermission("reports.export");

    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = reportParametersSchema.safeParse(query);
    if (!parsed.success) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "Choose valid report parameters and a period of up to 366 days for period reports.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    }

    const definition = findPermittedReport(session.permissions, parsed.data.reportKey);
    if (!definition) {
      return Response.json({ error: { code: "REPORT_FORBIDDEN", message: "This report is not available to your role." } }, { status: 403 });
    }

    const scope = await requirePermissionScope(definition.permission);
    // Export is a separate facility-scoped capability; neither grant may widen the other.
    if (session.allowedFacilityIds !== null) {
      scope.facilityIds = [...new Set(session.allowedFacilityIds)].filter(id => scope.unrestrictedFacilities || scope.facilityIds.includes(id));
      scope.unrestrictedFacilities = false;
    }
    if (!scope.unrestrictedFacilities && scope.facilityIds.length === 0) throw new Error("FORBIDDEN");
    // Complete access checks before admission; forbidden requests never consume export capacity.
    if (parsed.data.facilityId) await requireFacility(scope, parsed.data.facilityId);
    // Bound expensive reads before materialising data; the existing release/DLP guard remains separate.
    if (await rateLimit(`report-work:${session.organisationId}:${session.user.id}`, 10, 60_000)) {
      return Response.json({ error: { code: "REPORT_BUSY", message: "Too many report requests. Wait one minute and try again. Your selections are retained." } }, { status: 422, headers: { "Retry-After": "60" } });
    }
    const isSnapshot = isCurrentSnapshotReport(definition.key);
    const rows = await buildReportRows(scope, parsed.data);
    const decision = await guardReportExport({ organisationId: session.organisationId, actorId: session.user.id, reportKey: definition.key, facilityId: parsed.data.facilityId, rows });
    const headers = { ...dlpPrivateHeaders, "x-stor24-data-classification": decision.classification, "x-stor24-dlp-policy": decision.policyVersion, "x-request-id": decision.requestId };
    if (!decision.allowed) return Response.json({ error: { code: "DLP_EXPORT_BLOCKED", message: "Data protection blocked this export. Contact your administrator with the request reference.", requestId: decision.requestId } }, { status: 422, headers });
    if (parsed.data.format === "JSON") {
      return Response.json({ data: rows, meta: { parameters: parsed.data, currentSnapshot: isSnapshot, source: "stor24-production-database", classification: decision.classification, policyVersion: decision.policyVersion, requestId: decision.requestId } }, { headers });
    }
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${definition.key}-${isSnapshot ? "current" : `${parsed.data.from}-${parsed.data.to}`}.csv"`,
        ...headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "REPORT_LIMIT") return Response.json({ error: { code: "REPORT_LIMIT", message: "This report exceeds its safe workload limit (10,000 records, or 2,000 history records per ageing account). Select a smaller scope or ask finance for a complete export. No partial export was created." } }, { status: 422 });
    if (error instanceof Error && error.message === "REPORT_PERIOD_LIMIT") return Response.json({ error: { code: "REPORT_LIMIT", message: "Choose valid parameters and a period of up to 366 days for period reports." } }, { status: 422 });
    if (error instanceof Error && error.message === "COLLECTION_DATE") return Response.json({ error: { code: "VALIDATION_ERROR", message: "Choose an ageing date on or before today in South Africa." } }, { status: 422 });
    if (error instanceof Error && error.message === "COLLECTION_LIMIT") return Response.json({ error: { code: "REPORT_LIMIT", message: "This ageing report exceeds the account limit. Select a smaller facility scope." } }, { status: 422 });
    if (error instanceof Error && error.message === "FACILITY_FORBIDDEN") return Response.json({ error: { code: "REPORT_FORBIDDEN", message: "You do not have report access to this facility. Please contact your administrator." } }, { status: 403 });
    return authErrorResponse(error);
  }
}
