import { z } from "zod";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { dlpPrivateHeaders,DLP_MAX_BYTES } from "@/lib/dlp-policy";
import { sameOrigin,rateLimit } from "@/lib/request-security";
import { ReportError } from "@/lib/visual-report-engine";
import { reportBundle } from "@/lib/report-bundle";
import { visualReportErrorResponse } from "@/lib/visual-report-errors";
import { authoriseReportResult,runVisualReport,visualExportResponse } from "@/lib/visual-report-service";
import { reportRequestBody } from "@/lib/report-request-body";
export const dynamic="force-dynamic";
const schema=z.object({ids:z.array(z.string().min(1).max(100)).min(1).max(5).refine(ids=>new Set(ids).size===ids.length),format:z.enum(["CSV","XLSX","PDF"])}).strict();
export async function POST(request:Request) {
  try {
    if(!sameOrigin(request))throw new ReportError("FORBIDDEN");const actor=await requireSession();
    if(await rateLimit(`report-batch:${actor.user.organisationId}:${actor.user.id}`,10,60000))return Response.json({error:{code:"RATE_LIMIT",message:"Wait a minute before downloading another bundle."}},{status:429,headers:dlpPrivateHeaders});
    const body=schema.parse(await reportRequestBody(request,2048));
    const files:{name:string;bytes:Uint8Array}[]=[],manifest:unknown[]=[];let bytes=0;
    const results:Awaited<ReturnType<typeof runVisualReport>>[]=[];
    for(const [index,id] of body.ids.entries()) {
      const saved=await db.savedReport.findFirst({where:{id,organisationId:actor.user.organisationId,archived:false,OR:[{ownerId:actor.user.id},{visibility:"ORGANISATION"}]}});
      if(!saved)throw new ReportError("REPORT_NOT_FOUND");const result=await runVisualReport(actor,saved.definition,true);
      results.push(result);
      const headers=await authoriseReportResult(actor,result.query,result.rows,true,body.format,result.scope);
      const response=await visualExportResponse(result.query,result.rows,body.format,headers,result.generatedAt,result.dataset.basis);
      const content=new Uint8Array(await response.arrayBuffer());bytes+=content.length;if(bytes>DLP_MAX_BYTES)throw new ReportError("REPORT_LIMIT");
      const filename=`${index+1}-${result.query.name.replace(/[^a-zA-Z0-9-]/g,"-").slice(0,65)}.${body.format.toLowerCase()}`;
      files.push({name:filename,bytes:content});manifest.push({file:filename,generatedAt:result.generatedAt,rows:result.rows.length,basis:result.dataset.basis});
    }
    // No bytes are released unless every member has passed its current authorization and audit.
    files.push({name:"manifest.json",bytes:new TextEncoder().encode(JSON.stringify(manifest,null,2))});const bundle=reportBundle(files);
    if(bundle.length>DLP_MAX_BYTES)throw new ReportError("REPORT_LIMIT");
    for(const result of results)await authoriseReportResult(actor,result.query,result.rows,true,body.format,result.scope);
    await db.auditEvent.create({data:{organisationId:actor.user.organisationId,actorId:actor.user.id,entityType:"ReportBundle",entityId:"visual-report",action:"report.bundle.prepared",after:{reportCount:body.ids.length,format:body.format,bytes:bundle.length}}});
    return new Response(bundle,{headers:{...dlpPrivateHeaders,"content-type":"application/zip","content-disposition":"attachment; filename=stor24-report-bundle.zip"}});
  }catch(error){return visualReportErrorResponse(error);}
}
