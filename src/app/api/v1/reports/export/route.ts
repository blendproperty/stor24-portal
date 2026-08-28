import { requirePermission } from "@/lib/auth-guards";
import { buildReportRows } from "@/lib/report-data-service";
import { findPermittedReport, reportParametersSchema, toCsv } from "@/lib/reporting";
import { requirePermissionScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  const rows = await buildReportRows(await requirePermissionScope(definition.permission), parsed.data);
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
}
