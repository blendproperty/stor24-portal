import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentRoleAccess } from "@/lib/current-role-access";
import { guardReportExport } from "@/lib/dlp-export-service";
import { visualReportSchema } from "@/lib/visual-report-contract";
import { visualReportSource } from "@/lib/visual-report-data";
import { evaluateVisualReport, nextReportRun, reportPeriod, ReportError } from "@/lib/visual-report-engine";
import { encryptReportArtifact, personalReportAccess, visualReportScope } from "@/lib/visual-report-security";
import { personalResultColumns, reportDataset } from "@/lib/visual-report-service";
import type { Prisma } from "@/generated/prisma/client";

const scheduleParameters=z.object({version:z.literal(1),ownerId:z.string(),savedId:z.string(),cadence:z.enum(["daily","weekly","monthly"]),query:visualReportSchema}).strict();
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
/** Generates snapshots into a private inbox. No email recipient or provider calls. */
export async function runScheduledReports(now=new Date()) {
  const hours=Number(process.env.REPORT_RETENTION_HOURS??24);
  if(!Number.isInteger(hours)||hours<1||hours>168)throw new ReportError("REPORT_STORAGE_UNAVAILABLE");
  // Erase artifact bodies after expiry; run metadata stays available for audit.
  await db.reportRun.updateMany({where:{expiresAt:{lte:now},encryptedResult:{not:null}},data:{encryptedResult:null}});
  await db.reportRun.updateMany({where:{reportKey:"scheduled-visual-report",status:"RUNNING",startedAt:{lt:new Date(now.getTime()-30*60000)}},data:{status:"FAILED",failureCode:"WORKER_INTERRUPTED",completedAt:now}});
  const due=await db.reportSchedule.findMany({where:{active:true,reportKey:{startsWith:"saved:"},nextRunAt:{lte:now}},orderBy:{nextRunAt:"asc"},take:10});
  let completed=0,failed=0;
  for(const schedule of due) {
    const parsed=scheduleParameters.safeParse(schedule.parameters);
    if(!parsed.success){await db.reportSchedule.update({where:{id:schedule.id},data:{active:false}});failed++;continue;}
    const parameters=parsed.data,id=randomUUID();
    // Compare-and-swap the due timestamp and create the run in one transaction.
    // Concurrent workers cannot generate the same scheduled slot twice.
    const claimed=await db.$transaction(async tx=>{
      const changed=await tx.reportSchedule.updateMany({where:{id:schedule.id,active:true,nextRunAt:schedule.nextRunAt},data:{nextRunAt:nextReportRun(parameters.cadence,now),lastRunAt:now}});
      if(!changed.count)return false;
      await tx.reportRun.create({data:{id,organisationId:schedule.organisationId,facilityId:schedule.facilityId,scheduleId:schedule.id,requestedById:parameters.ownerId,reportKey:"scheduled-visual-report",parameters:json({dataset:parameters.query.dataset,cadence:parameters.cadence}),format:"JSON",status:"RUNNING",startedAt:now}});return true;
    });
    if(!claimed)continue;
    try {
      const saved=await db.savedReport.findFirst({where:{id:parameters.savedId,organisationId:schedule.organisationId,ownerId:parameters.ownerId,archived:false}});
      if(!saved)throw new ReportError("REPORT_NOT_FOUND");
      // A schedule is pinned to the definition at creation, including its filters.
      const query=visualReportSchema.parse({...parameters.query,...reportPeriod(parameters.cadence,now)}),dataset=reportDataset(query);
      const actor=await db.user.findFirst({where:{id:parameters.ownerId,organisationId:schedule.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
      if(!actor||!currentRoleAccess(actor.roleAssignments,"reports.schedule",query.facilityId).allowed)throw new ReportError("FORBIDDEN");
      const scope=visualReportScope(actor.roleAssignments,dataset,actor.id,actor.organisationId,query.facilityId,true);
      const result=evaluateVisualReport(query,await visualReportSource(scope,query));
      const latest=await db.user.findFirst({where:{id:actor.id,organisationId:actor.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
      if(!latest||!currentRoleAccess(latest.roleAssignments,"reports.schedule",query.facilityId).allowed)throw new ReportError("FORBIDDEN");
      const latestScope=visualReportScope(latest.roleAssignments,dataset,latest.id,latest.organisationId,query.facilityId,true);
      if(!latestScope.unrestrictedFacilities && (scope.unrestrictedFacilities&&!query.facilityId || !scope.unrestrictedFacilities&&scope.facilityIds.some(f=>!latestScope.facilityIds.includes(f))))throw new ReportError("FORBIDDEN");
      const decision=await guardReportExport({organisationId:actor.organisationId,actorId:actor.id,reportKey:"visual-report",facilityId:query.facilityId,rows:result.rows,personalColumnKeys:personalResultColumns(query),personalDataAllowed:personalReportAccess(latest.roleAssignments,latestScope,query.facilityId),format:"JSON",period:{from:query.from,to:query.to}});
      if(!decision.allowed)throw new ReportError(decision.reasons.includes("PERSONAL_EXPORT_PERMISSION_REQUIRED")?"PERSONAL_EXPORT_FORBIDDEN":"DLP_EXPORT_BLOCKED");
      const generatedAt=new Date().toISOString();
      const imported=query.historyImportId?await db.reportHistoryImport.findFirst({where:{id:query.historyImportId,organisationId:actor.organisationId},select:{name:true,extractedAt:true}}):null;
      const basis=imported?`Imported SiteLink history: ${imported.name}; extracted ${imported.extractedAt.toISOString()}. Separate from current STOR24 records.`:dataset.basis;
      const encryptedResult=encryptReportArtifact(JSON.stringify({version:1,query,rows:result.rows,scope,generatedAt,basis}),`${actor.organisationId}:${actor.id}:${id}`);
      // Archive/pause/revocation between generation and commit cannot publish a stale run.
      await db.$transaction(async tx=>{
        const active=await tx.reportSchedule.findFirst({where:{id:schedule.id,active:true}});
        const stillSaved=await tx.savedReport.findFirst({where:{id:parameters.savedId,organisationId:schedule.organisationId,ownerId:parameters.ownerId,archived:false}});
        const finalActor=await tx.user.findFirst({where:{id:actor.id,organisationId:actor.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
        if(!active||!stillSaved||!finalActor||!currentRoleAccess(finalActor.roleAssignments,"reports.schedule",query.facilityId).allowed)throw new ReportError("FORBIDDEN");
        const finalScope=visualReportScope(finalActor.roleAssignments,dataset,finalActor.id,finalActor.organisationId,query.facilityId,true);
        if(!finalScope.unrestrictedFacilities&&(scope.unrestrictedFacilities&&!query.facilityId||!scope.unrestrictedFacilities&&scope.facilityIds.some(f=>!finalScope.facilityIds.includes(f))))throw new ReportError("FORBIDDEN");
        if(personalResultColumns(query).length&&!personalReportAccess(finalActor.roleAssignments,finalScope,query.facilityId))throw new ReportError("PERSONAL_EXPORT_FORBIDDEN");
        await tx.reportRun.update({where:{id},data:{status:"SUCCEEDED",rowCount:result.rows.length,encryptedResult,expiresAt:new Date(now.getTime()+hours*3600000),completedAt:new Date(),parameters:json({dataset:query.dataset,from:query.from,to:query.to,cadence:parameters.cadence})}});
        await tx.auditEvent.create({data:{organisationId:actor.organisationId,actorId:actor.id,facilityId:query.facilityId,entityType:"ReportRun",entityId:id,action:"report.schedule.completed",after:{rowCount:result.rows.length,retentionHours:hours}}});
      });completed++;
    }catch(error){
      const code=error instanceof ReportError?error.message:"REPORT_GENERATION_FAILED";
      await db.reportRun.update({where:{id},data:{status:"FAILED",failureCode:code,completedAt:new Date()}});failed++;
    }
  }
  return {completed,failed,checked:due.length};
}
