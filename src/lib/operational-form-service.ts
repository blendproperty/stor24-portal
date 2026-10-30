import {randomUUID} from "node:crypto";
import {z} from "zod";
import {Prisma} from "@/generated/prisma/client";
import {db} from "@/lib/db";
import {facilityWhere,type RequestScope} from "@/lib/scope";
import {currentRoleAccess} from "@/lib/current-role-access";
import {encryptIntegrationSecret,decryptIntegrationSecret} from "@/lib/integrations/integration-secret-vault";
import {noticeHash} from "@/lib/collection-notice-policy";
import {southAfricaDateKey} from "@/lib/south-africa-time";
import {maintenanceReportSchema,visitorEntrySchema,formText,sastInstant,acknowledgementText} from "./operational-form-policy";
type Tx=Prisma.TransactionClient;
const maintenanceDomain="MAINTENANCE_REPORT",visitorDomain="VISITOR_REGISTER";
const reportStored=z.object({version:z.literal(1),revision:z.string().uuid(),payloadEncrypted:z.string(),followup:z.object({taskId:z.string(),expiresOn:z.iso.date(),dueAt:z.iso.datetime()}).nullable()}).strict();
const visitorStored=z.object({version:z.literal(1),revision:z.string().uuid(),kind:z.enum(["VISITOR","CLIENT_ATTENDANCE"]),businessDate:z.iso.date(),payloadEncrypted:z.string()}).strict();
const visitorPayload=visitorEntrySchema.extend({unitLabel:z.string().nullable(),entryAt:z.iso.datetime(),recordedAt:z.iso.datetime(),recordedById:z.string(),acknowledgement:z.literal(acknowledgementText),checkout:z.object({at:z.iso.datetime(),signatureName:z.string(),recordedAt:z.iso.datetime(),recordedById:z.string()}).nullable(),voided:z.object({reason:z.string(),at:z.iso.datetime(),actorId:z.string()}).nullable()}).strict();
async function authority(tx:Tx,scope:RequestScope,facilityId:string,manage=false){
  const facility=await tx.facility.findFirst({where:{AND:[{id:facilityId,active:true},facilityWhere(scope)]}});
  const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
  const roles=user?.roleAssignments.filter(a=>a.role.organisationId===scope.organisationId)??[];
  if(!facility||!["operations.view",...(manage?["operations.manage"]:[])].every(p=>currentRoleAccess(roles,p,facilityId).allowed))throw Error("FORBIDDEN");return facility;
}
async function audit(tx:Tx,scope:RequestScope,facilityId:string,action:string,id:string,after:Prisma.InputJsonValue){await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId,actorId:scope.userId,action:`operational.form.${action}`,entityType:"ConfigurationProfile",entityId:id,after}});}
const profileWhere=(scope:RequestScope,facilityId:string,domain:string)=>({organisationId:scope.organisationId,facilityId,domain});
async function report(tx:Tx,scope:RequestScope,facilityId:string,id:string,includeHistory=false){
  const record=await tx.maintenanceRequest.findFirst({where:{id,organisationId:scope.organisationId,facilityId},include:{unit:{select:{number:true}}}});if(!record)throw Error("FORM_NOT_FOUND");
  const profile=await tx.configurationProfile.findFirst({where:{...profileWhere(scope,facilityId,maintenanceDomain),name:id}}),saved=profile?reportStored.parse(profile.config):null;
  const form=saved?maintenanceReportSchema.parse(JSON.parse(decryptIntegrationSecret(saved.payloadEncrypted))):null;
  const events=profile&&includeHistory?await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,facilityId,entityId:profile.id,action:"operational.form.maintenance_saved"},include:{actor:{select:{name:true}}},orderBy:{occurredAt:"desc"},take:20}):[];
  const history=events.map(event=>{const after=event.after as {payloadEncrypted?:unknown;revision?:unknown}|null;return{at:event.occurredAt.toISOString(),actor:event.actor?.name??"Former staff",revision:typeof after?.revision==="string"?after.revision:null,form:typeof after?.payloadEncrypted==="string"?maintenanceReportSchema.parse(JSON.parse(decryptIntegrationSecret(after.payloadEncrypted))):null}});
  return {record,profile,saved,form,history};
}
const reportView=(v:Awaited<ReturnType<typeof report>>)=>({id:v.record.id,title:v.record.title,status:v.record.status,priority:v.record.priority,description:v.record.description??"",unit:v.record.unit?.number??null,updatedAt:v.record.updatedAt.toISOString(),createdAt:v.record.createdAt.toISOString(),revision:v.saved?.revision??null,form:v.form,followup:v.saved?.followup??null,history:v.history});
export async function maintenanceRegister(scope:RequestScope,facilityId:string,cursor="",search="",maintenanceId=""){
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId);const where={organisationId:scope.organisationId,facilityId,...(maintenanceId?{id:maintenanceId}:{}),...(search?{title:{contains:search,mode:"insensitive" as const}}:{})};
    const anchor=cursor?await tx.maintenanceRequest.findFirst({where:{...where,id:cursor}}):null;if(cursor&&!anchor)throw Error("FORM_NOT_FOUND");
    const rows=await tx.maintenanceRequest.findMany({where:{...where,...(anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{})},orderBy:[{createdAt:"desc"},{id:"desc"}],take:51});
    return {rows:await Promise.all(rows.slice(0,50).map(r=>report(tx,scope,facilityId,r.id,!!maintenanceId).then(reportView))),nextCursor:rows.length>50?rows[49].id:null};
  },{isolationLevel:"RepeatableRead"});
}
const reportCommand=z.object({id:z.cuid(),expectedUpdatedAt:z.iso.datetime(),revision:z.string().uuid().nullable(),title:formText(160).min(2),description:formText(4000),priority:z.enum(["LOW","NORMAL","HIGH","URGENT"]),form:maintenanceReportSchema}).strict();
export async function saveMaintenanceReport(scope:RequestScope,facilityId:string,input:unknown){
  const c=reportCommand.parse(input),today=southAfricaDateKey(new Date());if([c.form.discoveredOn,c.form.reportedOn,c.form.resolvedOn].some(d=>d&&d>today))throw Error("FORM_FUTURE");
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId,true);const v=await report(tx,scope,facilityId,c.id);
    if(v.record.updatedAt.toISOString()!==c.expectedUpdatedAt||(v.saved?.revision??null)!==c.revision)throw Error("FORM_CHANGED");
    if(v.record.status==="COMPLETED"&&v.form?.resolvedOn&&v.form.outcome&&(!c.form.resolvedOn||!c.form.outcome))throw Error("FORM_COMPLETION_REQUIRED");
    await tx.maintenanceRequest.update({where:{id:c.id},data:{title:c.title,description:c.description,priority:c.priority}});
    const saved={version:1,revision:randomUUID(),payloadEncrypted:encryptIntegrationSecret(JSON.stringify(c.form)),followup:v.saved?.followup??null};
    const data={...profileWhere(scope,facilityId,maintenanceDomain),name:c.id,status:"RECORDED",config:saved};
    const row=v.profile?await tx.configurationProfile.update({where:{id:v.profile.id},data}):await tx.configurationProfile.create({data});
    await audit(tx,scope,facilityId,"maintenance_saved",row.id,{maintenanceId:c.id,revision:saved.revision,contentHash:noticeHash(c.form),payloadEncrypted:saved.payloadEncrypted,quoteDecision:c.form.quoteDecision,certificateExpiresOn:c.form.certificateExpiresOn});return reportView(await report(tx,scope,facilityId,c.id,true));
  },{isolationLevel:"Serializable"});
}
/** Existing legacy tickets remain usable; structured reports require their recorded resolution before completion. */
export async function requireMaintenanceResolution(tx:Tx,organisationId:string,facilityId:string,id:string,status:string){
  if(status!=="COMPLETED")return;
  const row=await tx.configurationProfile.findFirst({where:{organisationId,facilityId,domain:maintenanceDomain,name:id}});if(!row)return;
  const saved=reportStored.parse(row.config),form=maintenanceReportSchema.parse(JSON.parse(decryptIntegrationSecret(saved.payloadEncrypted)));
  if(!form.resolvedOn||!form.outcome)throw Error("FORM_COMPLETION_REQUIRED");
}
export async function certificateFollowup(scope:RequestScope,facilityId:string,input:unknown){
  const c=z.object({id:z.cuid(),revision:z.string().uuid(),dueAt:z.iso.datetime(),confirm:z.literal(true)}).strict().parse(input);
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId,true);const v=await report(tx,scope,facilityId,c.id);
    if(!v.saved||!v.form?.certificateExpiresOn||!v.form.certificateDescription||!v.form.certificateReference)throw Error("FORM_CHANGED");
    if(v.saved.followup?.expiresOn===v.form.certificateExpiresOn){if(v.saved.followup.dueAt!==c.dueAt)throw Error("FORM_FOLLOWUP_CHANGED");return {taskId:v.saved.followup.taskId,repeated:true};}
    if(v.saved.revision!==c.revision)throw Error("FORM_CHANGED");
    if(v.saved.followup){const old=await tx.task.findFirst({where:{id:v.saved.followup.taskId,organisationId:scope.organisationId,facilityId}});if(old&&!["COMPLETED","CANCELLED"].includes(old.status))throw Error("FORM_FOLLOWUP_CHANGED");}
    const task=await tx.task.create({data:{organisationId:scope.organisationId,facilityId,createdById:scope.userId,title:`Review certificate: ${v.form.certificateDescription}`.slice(0,160),description:`Review retained evidence in /operations/forms?maintenanceId=${c.id}. Task completion does not certify compliance or approve expenditure.`,priority:"NORMAL",purpose:"GENERAL",dueAt:new Date(c.dueAt),requestKey:`maintenance-certificate:${noticeHash([scope.organisationId,c.id,v.form.certificateExpiresOn])}`}});
    await tx.configurationProfile.update({where:{id:v.profile!.id},data:{config:{...v.saved,revision:randomUUID(),followup:{taskId:task.id,expiresOn:v.form.certificateExpiresOn,dueAt:new Date(c.dueAt).toISOString()}}}});
    await audit(tx,scope,facilityId,"certificate_followup",v.profile!.id,{maintenanceId:c.id,taskId:task.id,dueAt:c.dueAt,expiresOn:v.form.certificateExpiresOn});return {taskId:task.id,repeated:false};
  },{isolationLevel:"Serializable"});
}
async function visit(tx:Tx,scope:RequestScope,facilityId:string,id:string){const row=await tx.configurationProfile.findFirst({where:{id,...profileWhere(scope,facilityId,visitorDomain)}});if(!row)throw Error("FORM_NOT_FOUND");const saved=visitorStored.parse(row.config),payload=visitorPayload.parse(JSON.parse(decryptIntegrationSecret(saved.payloadEncrypted)));return {row,saved,payload};}
const visitorView=(v:Awaited<ReturnType<typeof visit>>)=>({id:v.row.id,status:v.row.status,revision:v.saved.revision,...v.payload});
export async function visitorRegister(scope:RequestScope,facilityId:string,date:string,kind:"VISITOR"|"CLIENT_ATTENDANCE",cursor=""){
  z.iso.date().parse(date);return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId);const where={...profileWhere(scope,facilityId,visitorDomain),AND:[{config:{path:["businessDate"],equals:date}},{config:{path:["kind"],equals:kind}}]};
    const anchor=cursor?await tx.configurationProfile.findFirst({where:{...where,id:cursor}}):null;if(cursor&&!anchor)throw Error("FORM_NOT_FOUND");
    const rows=await tx.configurationProfile.findMany({where:{...where,...(anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{})},orderBy:[{createdAt:"desc"},{id:"desc"}],take:51});
    return {rows:await Promise.all(rows.slice(0,50).map(r=>visit(tx,scope,facilityId,r.id).then(visitorView))),nextCursor:rows.length>50?rows[49].id:null};
  },{isolationLevel:"RepeatableRead"});
}
export async function recordVisitor(scope:RequestScope,facilityId:string,input:unknown){
  const c=z.object({requestKey:z.string().uuid(),entry:visitorEntrySchema}).strict().parse(input),entryAt=sastInstant(c.entry.businessDate,c.entry.timeIn);if(entryAt>new Date())throw Error("FORM_FUTURE");
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId,true);const id=`visit:${noticeHash([scope.organisationId,facilityId,c.requestKey])}`;
    const existing=await tx.configurationProfile.findUnique({where:{id}});if(existing){const v=await visit(tx,scope,facilityId,id);const original=Object.fromEntries(Object.keys(c.entry).map(key=>[key,v.payload[key as keyof typeof v.payload]]));if(noticeHash(original)!==noticeHash(c.entry))throw Error("FORM_CHANGED");return visitorView(v);}
    const unit=c.entry.unitId?await tx.unit.findFirst({where:{id:c.entry.unitId,facilityId,facility:{organisationId:scope.organisationId}}}):null;if(c.entry.unitId&&!unit)throw Error("FORM_NOT_FOUND");
    const payload={...c.entry,unitLabel:unit?.number??null,entryAt:entryAt.toISOString(),recordedAt:new Date().toISOString(),recordedById:scope.userId,acknowledgement:acknowledgementText,checkout:null,voided:null},saved={version:1,revision:randomUUID(),kind:c.entry.kind,businessDate:c.entry.businessDate,payloadEncrypted:encryptIntegrationSecret(JSON.stringify(payload))};
    await tx.configurationProfile.create({data:{id,...profileWhere(scope,facilityId,visitorDomain),name:id,status:c.entry.kind==="VISITOR"?"RECORDED":"OPEN",config:saved}});await audit(tx,scope,facilityId,"visitor_recorded",id,{revision:saved.revision,kind:c.entry.kind,businessDate:c.entry.businessDate,contentHash:noticeHash(payload),signatureMethod:"ASSISTED_TYPED_ACKNOWLEDGEMENT"});return visitorView(await visit(tx,scope,facilityId,id));
  },{isolationLevel:"Serializable"});
}
export async function updateVisitor(scope:RequestScope,facilityId:string,input:unknown){
  const c=z.discriminatedUnion("action",[
    z.object({action:z.literal("checkout"),id:z.string().min(1).max(100),revision:z.string().uuid(),date:z.iso.date(),time:z.string(),signatureName:formText(160).min(2).refine(v=>!/[\r\n]/.test(v)),clientConfirmed:z.literal(true)}).strict(),
    z.object({action:z.literal("void"),id:z.string().min(1).max(100),revision:z.string().uuid(),reason:formText(500).min(3)}).strict(),
  ]).parse(input);
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId,true);const v=await visit(tx,scope,facilityId,c.id);if(v.saved.revision!==c.revision||v.row.status==="VOIDED")throw Error("FORM_CHANGED");let status="VOIDED",payload=v.payload;
    if(c.action==="checkout"){
      const at=sastInstant(c.date,c.time);if(v.saved.kind!=="CLIENT_ATTENDANCE"||v.row.status!=="OPEN"||at<new Date(payload.entryAt)||at>new Date())throw Error("FORM_TIME");
      payload={...payload,checkout:{at:at.toISOString(),signatureName:c.signatureName,recordedAt:new Date().toISOString(),recordedById:scope.userId}};status="CLOSED";
    }else payload={...payload,voided:{reason:c.reason,at:new Date().toISOString(),actorId:scope.userId}};
    const revision=randomUUID(),changed=await tx.configurationProfile.updateMany({where:{id:c.id,...profileWhere(scope,facilityId,visitorDomain),config:{path:["revision"],equals:c.revision}},data:{status,config:{...v.saved,revision,payloadEncrypted:encryptIntegrationSecret(JSON.stringify(payload))}}});if(changed.count!==1)throw Error("FORM_CHANGED");
    await audit(tx,scope,facilityId,`visitor_${c.action}`,c.id,{revision,status,contentHash:noticeHash(payload)});return visitorView(await visit(tx,scope,facilityId,c.id));
  },{isolationLevel:"Serializable"});
}
