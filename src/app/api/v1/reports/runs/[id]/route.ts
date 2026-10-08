import { z } from "zod";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { visualReportSchema } from "@/lib/visual-report-contract";
import { ReportError } from "@/lib/visual-report-engine";
import { decryptReportArtifact } from "@/lib/visual-report-security";
import { visualReportErrorResponse } from "@/lib/visual-report-errors";
import { authoriseReportResult, visualExportResponse,visualFormatSchema } from "@/lib/visual-report-service";
export const dynamic="force-dynamic";
const artifactSchema=z.object({version:z.literal(1),query:visualReportSchema,generatedAt:z.iso.datetime(),basis:z.string().max(3000),rows:z.array(z.record(z.string(),z.union([z.string(),z.number().finite(),z.boolean(),z.null()]))).max(5000),scope:z.object({userId:z.string(),organisationId:z.string(),facilityIds:z.array(z.string()),unrestrictedFacilities:z.boolean()})});
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const actor=await requireSession(),{id}=await context.params;
    const format=visualFormatSchema.parse(new URL(request.url).searchParams.get("format")??"XLSX");
    const run=await db.reportRun.findFirst({where:{id,organisationId:actor.user.organisationId,requestedById:actor.user.id,reportKey:"scheduled-visual-report",status:"SUCCEEDED"}});
    if(!run)throw new ReportError("REPORT_NOT_FOUND");
    if(!run.encryptedResult||!run.expiresAt||run.expiresAt<=new Date())throw new ReportError("REPORT_EXPIRED");
    const artifact=artifactSchema.parse(JSON.parse(decryptReportArtifact(run.encryptedResult,`${actor.user.organisationId}:${actor.user.id}:${id}`)));
    const headers=await authoriseReportResult(actor,artifact.query,artifact.rows,true,format,artifact.scope);
    return visualExportResponse(artifact.query,artifact.rows,format,headers,artifact.generatedAt,artifact.basis);
  }catch(error){return visualReportErrorResponse(error);}
}
