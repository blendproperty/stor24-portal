import { createHash } from "node:crypto";
import { requireOwner } from "@/lib/auth-guards";
import { sameOrigin,rateLimit } from "@/lib/request-security";
import { db } from "@/lib/db";
import { requireFacility } from "@/lib/scope";
import { dlpPrivateHeaders,DLP_MAX_BYTES } from "@/lib/dlp-policy";
import { historyImportSchema,prepareReportHistory } from "@/lib/report-history-contract";
import { reportRequestBody } from "@/lib/report-request-body";
import { encryptReportArtifact,visualReportScope } from "@/lib/visual-report-security";
import { visualReportDatasets } from "@/lib/visual-report-contract";
import { visualReportErrorResponse } from "@/lib/visual-report-errors";
import { ReportError } from "@/lib/visual-report-engine";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  try{
    if(!sameOrigin(request))throw new ReportError("FORBIDDEN");const actor=await requireOwner();
    if(await rateLimit(`report-history:${actor.user.organisationId}:${actor.user.id}`,10,60000))return Response.json({error:{code:"RATE_LIMIT",message:"Wait a minute before importing another report."}},{status:429,headers:dlpPrivateHeaders});
    const input=historyImportSchema.parse(await reportRequestBody(request,DLP_MAX_BYTES+32768)),dataset=visualReportDatasets.find(d=>d.key===input.dataset);
    if(!dataset)throw new ReportError("REPORT_DATASET_UNAVAILABLE");
    const scope=visualReportScope(actor.user.roleAssignments,dataset,actor.user.id,actor.user.organisationId,input.facilityId);
    const facility=await requireFacility(scope,input.facilityId),prepared=prepareReportHistory(input,facility.name);
    const sourceSha256=createHash("sha256").update(input.csv).digest("hex");
    const id=createHash("sha256").update(JSON.stringify([actor.user.organisationId,input.facilityId,input.dataset,sourceSha256,Object.fromEntries(Object.entries(input.mapping).sort(([a],[b])=>a.localeCompare(b)))])).digest("hex");
    if(input.kind==="validate")return Response.json({data:{sourceSha256,rowCount:prepared.rows.length,mappedFields:prepared.mappedFields,unmappedFields:prepared.unmappedFields}},{headers:dlpPrivateHeaders});
    const encryptedRows=encryptReportArtifact(JSON.stringify(prepared.rows),`${actor.user.organisationId}:history:${id}`);
    const result=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`report-history:${id}`}, 0))::text`;
      const existing=await tx.reportHistoryImport.findUnique({where:{id}});if(existing)return {id:existing.id,rowCount:existing.rowCount,replayed:true};
      await tx.reportHistoryImport.create({data:{id,organisationId:actor.user.organisationId,facilityId:input.facilityId,dataset:input.dataset,name:input.name,extractedAt:new Date(input.extractedAt),importedById:actor.user.id,approvalReference:input.approvalReference,sourceSha256,rowCount:prepared.rows.length,encryptedRows}});
      await tx.auditEvent.create({data:{organisationId:actor.user.organisationId,facilityId:input.facilityId,actorId:actor.user.id,entityType:"ReportHistoryImport",entityId:id,action:"report.history.imported",after:{dataset:input.dataset,rowCount:prepared.rows.length,sourceSha256}}});return {id,rowCount:prepared.rows.length,replayed:false};
    });return Response.json({data:result},{status:result.replayed?200:201,headers:dlpPrivateHeaders});
  }catch(error){return visualReportErrorResponse(error);}
}
