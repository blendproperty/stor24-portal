import { randomUUID,createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";
import { guardReportExport } from "@/lib/dlp-export-service";
import { dlpPrivateHeaders, DLP_MAX_BYTES } from "@/lib/dlp-policy";
import { reportExcel, reportPdf } from "@/lib/report-documents";
import { toCsv } from "@/lib/reporting";
import { reportFieldLabel, visualReportDatasets, visualReportSchema, type VisualReportQuery, type VisualReportRow } from "@/lib/visual-report-contract";
import { visualReportSource } from "@/lib/visual-report-data";
import { evaluateVisualReport, nextReportRun, ReportError } from "@/lib/visual-report-engine";
import { personalReportAccess, visualReportScope } from "@/lib/visual-report-security";
import type { Prisma } from "@/generated/prisma/client";
import type { RequestScope } from "@/lib/scope";

export const visualFormatSchema=z.enum(["CSV","XLSX","PDF","JSON"]);
type Actor=Awaited<ReturnType<typeof requireSession>>;
export const reportWriteSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("preview"),query:visualReportSchema}).strict(),
  z.object({kind:z.literal("export"),query:visualReportSchema,format:visualFormatSchema}).strict(),
  z.object({kind:z.literal("save"),query:visualReportSchema,visibility:z.enum(["PRIVATE","ORGANISATION"]).default("PRIVATE"),requestKey:z.uuid().optional(),id:z.string().max(100).optional(),revision:z.number().int().positive().optional()}).strict(),
  z.object({kind:z.literal("archive"),id:z.string().min(1).max(100),revision:z.number().int().positive()}).strict(),
  z.object({kind:z.literal("schedule"),id:z.string().min(1).max(100),cadence:z.enum(["daily","weekly","monthly"])}).strict(),
  z.object({kind:z.literal("pause"),id:z.string().min(1).max(100)}).strict(),
]);
export function reportDataset(query:VisualReportQuery) { return visualReportDatasets.find(d=>d.key===query.dataset)!; }
export function personalResultColumns(query:VisualReportQuery) {
  const fields=reportDataset(query).fields;
  return (query.metrics.length?query.groupBy:query.columns).filter(key=>fields.find(f=>f.key===key)?.personal);
}
export async function runVisualReport(actor:Actor,input:unknown,exporting=false) {
  const query=visualReportSchema.parse(input),dataset=reportDataset(query);
  const scope=visualReportScope(actor.user.roleAssignments,dataset,actor.user.id,actor.user.organisationId,query.facilityId,exporting);
  const result=evaluateVisualReport(query,await visualReportSource(scope,query));
  if(Buffer.byteLength(JSON.stringify(result.rows),"utf8")>DLP_MAX_BYTES)throw new ReportError("REPORT_LIMIT");
  const imported=query.historyImportId?await db.reportHistoryImport.findFirst({where:{id:query.historyImportId,organisationId:actor.user.organisationId},select:{name:true,extractedAt:true,sourceSha256:true}}):null;
  const reportDatasetInfo=imported?{...result.dataset,basis:`Imported SiteLink history: ${imported.name}; extracted ${imported.extractedAt.toISOString()}. Missing fields remain unrecorded. This is separate from current STOR24 records.`,grain:result.dataset.grain}:result.dataset;
  return {...result,dataset:reportDatasetInfo,scope,generatedAt:new Date().toISOString()};
}
export async function authoriseReportResult(actor:Actor,query:VisualReportQuery,rows:VisualReportRow[],exporting:boolean,format:string,readScope:RequestScope) {
  // Resolve assignments again immediately before release to respect grants/revocations.
  const current=await requireSession();
  if(current.user.id!==actor.user.id || current.user.organisationId!==actor.user.organisationId)throw new ReportError("FORBIDDEN");
  const scope=visualReportScope(current.user.roleAssignments,reportDataset(query),current.user.id,current.user.organisationId,query.facilityId,exporting);
  if(!scope.unrestrictedFacilities && (readScope.unrestrictedFacilities && !query.facilityId || !readScope.unrestrictedFacilities && readScope.facilityIds.some(id=>!scope.facilityIds.includes(id))))throw new ReportError("FORBIDDEN");
  const decision=await guardReportExport({organisationId:current.user.organisationId,actorId:current.user.id,reportKey:"visual-report",facilityId:query.facilityId,channel:exporting?"report-download":"report-preview",personalDataAllowed:personalReportAccess(current.user.roleAssignments,scope,query.facilityId),personalColumnKeys:personalResultColumns(query),rows,format,period:{from:query.from,to:query.to}});
  if(!decision.allowed)throw new ReportError(decision.reasons.includes("PERSONAL_EXPORT_PERMISSION_REQUIRED")?"PERSONAL_EXPORT_FORBIDDEN":"DLP_EXPORT_BLOCKED");
  return {...dlpPrivateHeaders,"x-stor24-data-classification":decision.classification,"x-stor24-dlp-policy":decision.policyVersion,"x-request-id":decision.requestId};
}
export async function visualExportResponse(query:VisualReportQuery,rows:VisualReportRow[],format:z.infer<typeof visualFormatSchema>,headers:Record<string,string>,generatedAt:string,basis?:string) {
  const dataset=reportDataset(query),keys=query.metrics.length?[...query.groupBy,...query.metrics.map(m=>`${m.operation}_${m.field}`)]:query.columns;
  const labelled=rows.map(row=>Object.fromEntries(keys.map(key=>[reportFieldLabel(dataset,key),row[key]??null])));
  const period=`${query.dateField||query.intervalMode?`${query.from} to ${query.to} SAST${query.intervalMode?` (${query.intervalMode})`:""}`:query.historyImportId?"Imported history snapshot":`Current snapshot ${generatedAt}`} | ${basis??dataset.basis}`;
  if(format==="JSON")return Response.json({data:rows,meta:{query,generatedAt,basis:basis??dataset.basis,grain:dataset.grain,columns:keys.map(key=>({key,label:reportFieldLabel(dataset,key)}))}},{headers});
  const safeName=query.name.replace(/[^a-zA-Z0-9-]/g,"-").replace(/-+/g,"-").slice(0,70)||"report";
  const exportHeaders={...headers,"content-disposition":`attachment; filename="stor24-${safeName}.${format.toLowerCase()}"`};
  if(format==="CSV") {
    // Keep the selected headers even when there are no records.
    const csv=labelled.length?toCsv(labelled):toCsv([Object.fromEntries(keys.map(k=>[reportFieldLabel(dataset,k),null]))]).split("\r\n")[0];
    return new Response(csv,{headers:{...exportHeaders,"content-type":"text/csv; charset=utf-8"}});
  }
  const bytes=format==="XLSX"?await reportExcel(query.name,"visual-report",labelled,period):await reportPdf(query.name,"visual-report",labelled,period);
  return new Response(Buffer.from(bytes),{headers:{...exportHeaders,"content-type":format==="XLSX"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/pdf"}});
}
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function saveVisualReport(actor:Actor,body:Extract<z.infer<typeof reportWriteSchema>,{kind:"save"}>) {
  const scope=visualReportScope(actor.user.roleAssignments,reportDataset(body.query),actor.user.id,actor.user.organisationId,body.query.facilityId);
  if(body.visibility==="ORGANISATION" && !currentRoleAccess(actor.user.roleAssignments).owner)throw new ReportError("REPORT_SHARING_FORBIDDEN");
  return db.$transaction(async tx=>{
    if(body.id) {
      if(!body.revision)throw new ReportError("REPORT_CONFLICT");
      const updated=await tx.savedReport.updateMany({where:{id:body.id,organisationId:scope.organisationId,ownerId:actor.user.id,archived:false,revision:body.revision},data:{name:body.query.name,definition:json(body.query),visibility:body.visibility,revision:{increment:1}}});
      if(updated.count!==1)throw new ReportError("REPORT_CONFLICT");
      await tx.auditEvent.create({data:{organisationId:scope.organisationId,actorId:actor.user.id,facilityId:body.query.facilityId,entityType:"SavedReport",entityId:body.id,action:"report.definition.updated",after:{dataset:body.query.dataset,revision:body.revision+1,visibility:body.visibility}}});
      return tx.savedReport.findUniqueOrThrow({where:{id:body.id}});
    }
    if(!body.requestKey)throw new ReportError("REPORT_CONFLICT");
    const id=createHash("sha256").update(`${scope.organisationId}:${actor.user.id}:${body.requestKey}`).digest("hex");
    // Serialize retries and per-owner limits without weakening transaction isolation.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`saved-report:${scope.organisationId}:${actor.user.id}`}, 0))::text`;
    const existing=await tx.savedReport.findUnique({where:{id}});
    if(existing){if(existing.archived||existing.visibility!==body.visibility||JSON.stringify(visualReportSchema.parse(existing.definition))!==JSON.stringify(body.query))throw new ReportError("REPORT_CONFLICT");return existing;}
    if(await tx.savedReport.count({where:{organisationId:scope.organisationId,ownerId:actor.user.id,archived:false}})>=100)throw new ReportError("REPORT_SAVED_LIMIT");
    const created=await tx.savedReport.create({data:{id,organisationId:scope.organisationId,ownerId:actor.user.id,name:body.query.name,definition:json(body.query),visibility:body.visibility}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,actorId:actor.user.id,facilityId:body.query.facilityId,entityType:"SavedReport",entityId:created.id,action:"report.definition.created",after:{dataset:body.query.dataset,visibility:body.visibility}}});
    return created;
  });
}
export async function scheduleVisualReport(actor:Actor,id:string,cadence:"daily"|"weekly"|"monthly") {
  const saved=await db.savedReport.findFirst({where:{id,organisationId:actor.user.organisationId,ownerId:actor.user.id,archived:false}});
  if(!saved)throw new ReportError("REPORT_NOT_FOUND");
  const query=visualReportSchema.parse(saved.definition),dataset=reportDataset(query);
  visualReportScope(actor.user.roleAssignments,dataset,actor.user.id,actor.user.organisationId,query.facilityId,true);
  if(!currentRoleAccess(actor.user.roleAssignments,"reports.schedule",query.facilityId).allowed)throw new ReportError("FORBIDDEN");
  if(!/^[a-f0-9]{64}$/i.test(process.env.REPORT_CRON_SECRET_SHA256??"") || (process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim().length??0)<32)throw new ReportError("REPORT_SCHEDULER_UNAVAILABLE");
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule-report:${saved.id}`}, 0))::text`;
    const existing=await tx.reportSchedule.count({where:{organisationId:actor.user.organisationId,reportKey:`saved:${id}`,active:true}});
    if(existing)throw new ReportError("REPORT_SCHEDULE_EXISTS");
    const schedule=await tx.reportSchedule.create({data:{organisationId:actor.user.organisationId,facilityId:query.facilityId,name:saved.name,reportKey:`saved:${id}`,parameters:json({version:1,ownerId:actor.user.id,savedId:id,cadence,query}),format:"JSON",cronExpression:cadence==="daily"?"0 8 * * *":cadence==="weekly"?"0 8 * * 1":"0 8 1 * *",timezone:"Africa/Johannesburg",recipients:[],permission:dataset.permission,active:true,nextRunAt:nextReportRun(cadence,new Date())}});
    await tx.auditEvent.create({data:{organisationId:actor.user.organisationId,actorId:actor.user.id,facilityId:query.facilityId,entityType:"ReportSchedule",entityId:schedule.id,action:"report.schedule.created",after:{cadence,destination:"private-report-inbox"}}});
    return schedule;
  });
}
export async function recordInteractiveRun(actor:Actor,query:VisualReportQuery,rowCount:number,format:string) {
  await db.reportRun.create({data:{id:randomUUID(),organisationId:actor.user.organisationId,facilityId:query.facilityId,requestedById:actor.user.id,reportKey:"visual-report",parameters:json({dataset:query.dataset,from:query.from,to:query.to}),format,status:"SUCCEEDED",rowCount,startedAt:new Date(),completedAt:new Date()}});
}
