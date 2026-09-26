import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { buildReportRows } from "@/lib/report-data-service";
import { findPermittedReport, reportParametersSchema, toCsv } from "@/lib/reporting";
import { requirePermissionScope } from "@/lib/scope";

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
    const rows = await buildReportRows(scope, parsed.data);
    if (parsed.data.format === "JSON") {
      return Response.json({ data: rows, meta: { parameters: parsed.data, source: "stor24-production-database" } });
    }
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${definition.key}-${parsed.data.from}-${parsed.data.to}.csv"`,
        "x-stor24-data-classification": "live-operational-data",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FACILITY_FORBIDDEN") return Response.json({ error: { code: "REPORT_FORBIDDEN", message: "You do not have report access to this facility. Please contact your administrator." } }, { status: 403 });
    return authErrorResponse(error);
  }
}
