import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { dlpPrivateHeaders } from "@/lib/dlp-policy";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { visualReportDatasets, visualReportSchema } from "@/lib/visual-report-contract";
import { visualReportTemplates } from "@/lib/visual-report-templates";
import { visualReportScope } from "@/lib/visual-report-security";
import { visualReportErrorResponse } from "@/lib/visual-report-errors";
import { authoriseReportResult, recordInteractiveRun, reportWriteSchema, runVisualReport, saveVisualReport, scheduleVisualReport, visualExportResponse } from "@/lib/visual-report-service";
import { ReportError } from "@/lib/visual-report-engine";
import { reportRequestBody } from "@/lib/report-request-body";

export const dynamic="force-dynamic";
export async function GET() {
  try {
    const actor=await requireSession();
    const datasets=visualReportDatasets.filter(d=>{try{visualReportScope(actor.user.roleAssignments,d,actor.user.id,actor.user.organisationId);return true;}catch{return false;}});
    const saved=await db.savedReport.findMany({where:{organisationId:actor.user.organisationId,archived:false,OR:[{ownerId:actor.user.id},{visibility:"ORGANISATION"}]},take:201,orderBy:{updatedAt:"desc"},select:{id:true,name:true,definition:true,ownerId:true,revision:true,visibility:true,updatedAt:true}});
    const visible=saved.filter(s=>{const parsed=visualReportSchema.safeParse(s.definition);if(!parsed.success)return false;const dataset=datasets.find(d=>d.key===parsed.data.dataset);if(!dataset)return false;try{visualReportScope(actor.user.roleAssignments,dataset,actor.user.id,actor.user.organisationId,parsed.data.facilityId);return true;}catch{return false;}});
    const schedules=await db.reportSchedule.findMany({where:{organisationId:actor.user.organisationId,parameters:{path:["ownerId"],equals:actor.user.id}},take:100,orderBy:{createdAt:"desc"},select:{id:true,name:true,active:true,nextRunAt:true,lastRunAt:true,cronExpression:true}});
    const runs=await db.reportRun.findMany({where:{organisationId:actor.user.organisationId,requestedById:actor.user.id,reportKey:{in:["visual-report","scheduled-visual-report"]}},take:50,orderBy:{createdAt:"desc"},select:{id:true,format:true,status:true,rowCount:true,createdAt:true,completedAt:true,failureCode:true,expiresAt:true,scheduleId:true}});
    const history=await db.reportHistoryImport.findMany({where:{organisationId:actor.user.organisationId,dataset:{in:datasets.map(d=>d.key)}},take:201,orderBy:{createdAt:"desc"},select:{id:true,facilityId:true,dataset:true,name:true,extractedAt:true,rowCount:true}});
    const permittedHistory=history.filter(h=>{const d=datasets.find(d=>d.key===h.dataset)!;try{visualReportScope(actor.user.roleAssignments,d,actor.user.id,actor.user.organisationId,h.facilityId);return true;}catch{return false;}});
    return Response.json({data:{datasets,templates:visualReportTemplates.filter(t=>!t.dataset||datasets.some(d=>d.key===t.dataset)),saved:visible.slice(0,200).map(s=>({...s,editable:s.ownerId===actor.user.id,ownerId:undefined})),schedules,runs,history:permittedHistory.slice(0,200)},meta:{savedMore:saved.length>200,historyMore:history.length>200}},{headers:dlpPrivateHeaders});
  }catch(error){return visualReportErrorResponse(error);}
}
export async function POST(request:Request) {
  try {
    if(!sameOrigin(request))throw new ReportError("FORBIDDEN");
    const actor=await requireSession();
    if(await rateLimit(`report-builder:${actor.user.organisationId}:${actor.user.id}`,60,60000))return Response.json({error:{code:"RATE_LIMIT",message:"Wait a minute before running another report."}},{status:429,headers:dlpPrivateHeaders});
    const body=reportWriteSchema.parse(await reportRequestBody(request,32768));
    if(body.kind==="preview"||body.kind==="export") {
      const result=await runVisualReport(actor,body.query,body.kind==="export");
      const format=body.kind==="export"?body.format:"JSON";
      const headers=await authoriseReportResult(actor,result.query,result.rows,body.kind==="export",format,result.scope);
      await recordInteractiveRun(actor,result.query,result.rows.length,body.kind==="preview"?"PREVIEW":format);
      if(body.kind==="export")return visualExportResponse(result.query,result.rows,format,headers,result.generatedAt,result.dataset.basis);
      return Response.json({data:result.rows,meta:{matchedRows:result.matchedRows,generatedAt:result.generatedAt,basis:result.dataset.basis,grain:result.dataset.grain,query:result.query}},{headers});
    }
    if(body.kind==="save")return Response.json({data:await saveVisualReport(actor,body)},{status:body.id?200:201,headers:dlpPrivateHeaders});
    if(body.kind==="schedule")return Response.json({data:await scheduleVisualReport(actor,body.id,body.cadence)},{status:201,headers:dlpPrivateHeaders});
    if(body.kind==="pause") {
      await db.$transaction(async tx=>{
        const changed=await tx.reportSchedule.updateMany({where:{id:body.id,organisationId:actor.user.organisationId,parameters:{path:["ownerId"],equals:actor.user.id}},data:{active:false}});
        if(changed.count!==1)throw new ReportError("REPORT_NOT_FOUND");
        await tx.auditEvent.create({data:{organisationId:actor.user.organisationId,actorId:actor.user.id,entityType:"ReportSchedule",entityId:body.id,action:"report.schedule.paused"}});
      });return Response.json({data:{paused:true}},{headers:dlpPrivateHeaders});
    }
    await db.$transaction(async tx=>{
      const changed=await tx.savedReport.updateMany({where:{id:body.id,organisationId:actor.user.organisationId,ownerId:actor.user.id,revision:body.revision,archived:false},data:{archived:true,revision:{increment:1}}});
      if(changed.count!==1)throw new ReportError("REPORT_CONFLICT");
      await tx.reportSchedule.updateMany({where:{organisationId:actor.user.organisationId,reportKey:`saved:${body.id}`},data:{active:false}});
      await tx.auditEvent.create({data:{organisationId:actor.user.organisationId,actorId:actor.user.id,entityType:"SavedReport",entityId:body.id,action:"report.definition.archived"}});
    });return Response.json({data:{archived:true}},{headers:dlpPrivateHeaders});
  }catch(error){return visualReportErrorResponse(error);}
}
