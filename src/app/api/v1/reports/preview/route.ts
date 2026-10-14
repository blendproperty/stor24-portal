import { authErrorResponse, requireSession } from "@/lib/auth-guards";
import { buildReportRows } from "@/lib/report-data-service";
import { findPermittedReport, isCurrentSnapshotReport, reportParametersSchema } from "@/lib/reporting";
import { requirePermissionScope } from "@/lib/scope";
import { guardReportExport } from "@/lib/dlp-export-service";
import { dlpPrivateHeaders } from "@/lib/dlp-policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireSession();

    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = reportParametersSchema.safeParse({ ...query, format: "JSON" });
    if (!parsed.success) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the report parameters.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    }

    const definition = findPermittedReport(session.permissions, parsed.data.reportKey);
    if (!definition) {
      return Response.json({ error: { code: "REPORT_FORBIDDEN", message: "This report is not available to your role." } }, { status: 403 });
    }

    const scope = await requirePermissionScope(definition.permission);
    const isSnapshot = isCurrentSnapshotReport(definition.key);
    const rows = await buildReportRows(scope, parsed.data);
    const decision = await guardReportExport({ organisationId: scope.organisationId, actorId: session.user.id, reportKey: definition.key, channel:"report-preview", facilityId: parsed.data.facilityId, rows });
    const headers = { ...dlpPrivateHeaders, "x-stor24-data-classification": decision.classification, "x-stor24-dlp-policy": decision.policyVersion, "x-request-id": decision.requestId };
    if (!decision.allowed) return Response.json({ error: { code: "DLP_EXPORT_BLOCKED", message: "Data protection blocked this export. Contact your administrator with the request reference.", requestId: decision.requestId } }, { status: 422, headers });
    return Response.json({ data: rows, meta: { currentSnapshot: isSnapshot, source: "stor24-production-database" } }, { headers });
  } catch (error) {
    if(error instanceof Error&&error.message.startsWith("POSTED_REPORT_"))return Response.json({error:{code:error.message,message:"Choose a valid date range of at most sixty months and a smaller store scope, or review duplicate/invalid posting evidence."}},{status:422,headers:dlpPrivateHeaders});
    if (error instanceof Error && /^RECURRING_/.test(error.message)) return Response.json({ error: { code: error.message, message: error.message === "RECURRING_PERIOD_INVALID" ? "Choose one complete month from this month through the next twelve months. This is a current-plan projection." : "The recurring-charge source needs review or a smaller facility scope." } }, { status: 422, headers: dlpPrivateHeaders }); return authErrorResponse(error); }
}
