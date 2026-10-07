import { currentRoleAccess } from "@/lib/current-role-access";
import { reportExcel, reportPdf } from "@/lib/report-documents";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { buildReportRows } from "@/lib/report-data-service";
import { findPermittedReport, isCurrentSnapshotReport, reportParametersSchema, toCsv } from "@/lib/reporting";
import { requirePermissionScope } from "@/lib/scope";
import { guardReportExport } from "@/lib/dlp-export-service";
import { dlpPrivateHeaders } from "@/lib/dlp-policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requirePermission("reports.export");

    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = reportParametersSchema.safeParse(query);
    if (!parsed.success) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the report parameters.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
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
    const isSnapshot = isCurrentSnapshotReport(definition.key);
    const rows = await buildReportRows(scope, parsed.data);
    const personalAccess = currentRoleAccess(session.user.roleAssignments, "data.personal_export");
    const personalFacilityIds = parsed.data.facilityId ? [parsed.data.facilityId] : scope.facilityIds;
    const personalDataAllowed = personalAccess.allowed && (personalAccess.allowedFacilityIds === null ||
      ((!!parsed.data.facilityId || !scope.unrestrictedFacilities) && personalFacilityIds.every(id => personalAccess.allowedFacilityIds!.includes(id))));
    const decision = await guardReportExport({ organisationId: session.organisationId, actorId: session.user.id, reportKey: definition.key, facilityId: parsed.data.facilityId, rows, personalDataAllowed, format: parsed.data.format, period: { from: parsed.data.from, to: parsed.data.to } });
    const headers = { ...dlpPrivateHeaders, "x-stor24-data-classification": decision.classification, "x-stor24-dlp-policy": decision.policyVersion, "x-request-id": decision.requestId };
    if (decision.reasons.includes("PERSONAL_EXPORT_PERMISSION_REQUIRED")) return Response.json({ error: { code: "PERSONAL_EXPORT_FORBIDDEN", message: "This report contains personal data. Only a Super Admin (Organisation owner) or an administrator they explicitly authorise may export it.", requestId: decision.requestId } }, { status: 403, headers });
    if (!decision.allowed) return Response.json({ error: { code: "DLP_EXPORT_BLOCKED", message: "Data protection blocked this export. Contact your administrator with the request reference.", requestId: decision.requestId } }, { status: 422, headers });
    if (parsed.data.format === "JSON") {
      return Response.json({ data: rows, meta: { parameters: parsed.data, currentSnapshot: isSnapshot, source: "stor24-production-database", classification: decision.classification, policyVersion: decision.policyVersion, requestId: decision.requestId } }, { headers });
    }
    if (parsed.data.format === "XLSX" || parsed.data.format === "PDF") {
      const excel = parsed.data.format === "XLSX";
      const period = isSnapshot ? "Current snapshot" : `${parsed.data.from} to ${parsed.data.to} SAST`;
      const bytes = excel ? await reportExcel(definition.name, definition.key, rows, period) : await reportPdf(definition.name, definition.key, rows, period);
      return new Response(Buffer.from(bytes), { headers: { ...headers, "content-type": excel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", "content-disposition": `attachment; filename="${definition.key}.${excel ? "xlsx" : "pdf"}"` } });
    }
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${definition.key}-${isSnapshot ? "current" : `${parsed.data.from}-${parsed.data.to}`}.csv"`,
        ...headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "COLLECTION_DATE") return Response.json({ error: { code: "VALIDATION_ERROR", message: "Choose an ageing date on or before today in South Africa." } }, { status: 422 });
    if (error instanceof Error && error.message === "COLLECTION_LIMIT") return Response.json({ error: { code: "REPORT_LIMIT", message: "This ageing report exceeds the account limit. Select a smaller facility scope." } }, { status: 422 });
    if (error instanceof Error && error.message === "FACILITY_FORBIDDEN") return Response.json({ error: { code: "REPORT_FORBIDDEN", message: "You do not have report access to this facility. Please contact your administrator." } }, { status: 403 });
    return authErrorResponse(error);
  }
}
