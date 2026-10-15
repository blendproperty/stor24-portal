import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import { collectionEmailSource } from "@/lib/collections-service";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "@/lib/integrations/integration-secret-vault";
import { emailProvider, type EmailProvider } from "@/lib/email";
import { privacyHash } from "@/lib/request-security";
import { renderCollectionNotice, noticeHash, COLLECTION_NOTICE_VERSION, collectionEmailConfigured } from "@/lib/collection-notice-policy";
import { noticeBatchAccountsSchema, noticeBatchPreparationSchema, noticeBatchApprovalSchema } from "@/lib/collection-notice-batch-policy";
const domain = "COLLECTION_EMAIL_NOTICE";
const idFor = (org: string, account: string, date: string) => `collection-email:${noticeHash([org,account,date])}`;
const storedSchema = z.object({ version:z.literal(1), revision:z.string().uuid(), accountId:z.string(), asOf:z.string(), sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/), payloadHash:z.string().regex(/^[a-f0-9]{64}$/), payloadEncrypted:z.string(), contributors:z.array(z.string()).min(1), approvedBy:z.string().nullable(), approvalReference:z.string().nullable(), approvedAt:z.string().datetime().nullable() }).strict();
const payloadSchema = z.object({recipient:z.email(),subject:z.string(),text:z.string(),html:z.string(),templateVersion:z.literal(COLLECTION_NOTICE_VERSION)}).strict();
async function load(tx:Prisma.TransactionClient,scope:RequestScope,id:string){
  const row=await tx.configurationProfile.findFirst({where:{id,organisationId:scope.organisationId,domain}});if(!row)throw Error("COLLECTION_NOTICE_NOT_FOUND");
  if(!["DRAFT","APPROVED","SENDING","ACCEPTED","REVIEW_REQUIRED","CANCELLED"].includes(row.status))throw Error("COLLECTION_NOTICE_INTEGRITY");
  const saved=storedSchema.parse(row.config),payload=payloadSchema.parse(JSON.parse(decryptIntegrationSecret(saved.payloadEncrypted)));if(noticeHash(payload)!==saved.payloadHash)throw Error("COLLECTION_NOTICE_INTEGRITY");
  if(["APPROVED","SENDING","ACCEPTED","REVIEW_REQUIRED"].includes(row.status)&&(!saved.approvedBy||!saved.approvedAt||!saved.approvalReference||saved.contributors.includes(saved.approvedBy)))throw Error("COLLECTION_NOTICE_INTEGRITY");
  const current=await collectionEmailSource(tx,scope,saved.accountId,southAfricaDateKey(new Date()));
  if(row.facilityId!==current.facilityId)throw Error("COLLECTION_NOTICE_NOT_FOUND");
  return{row,saved,payload,current};
}
function view(value:Awaited<ReturnType<typeof load>>,scope:RequestScope){
  const{row,saved,payload,current}=value;const sourceCurrent=current.fingerprint===saved.sourceFingerprint&&current.asOf===saved.asOf&&!current.blockers.length&&noticeHash(renderCollectionNotice(current))===saved.payloadHash;
  return{id:row.id,accountId:saved.accountId,status:row.status,revision:saved.revision,asOf:saved.asOf,recipient:payload.recipient,subject:payload.subject,text:payload.text,sourceCurrent,blockers:current.blockers,canApprove:row.status==="DRAFT"&&!saved.contributors.includes(scope.userId),approvedAt:saved.approvedAt,approvalReference:saved.approvalReference,sendConfigured:collectionEmailConfigured(),accepted:row.status==="ACCEPTED",deliveryVerified:false};
}
async function previewInTransaction(tx:Prisma.TransactionClient,scope:RequestScope,accountId:string,asOf:string){
  const source=await collectionEmailSource(tx,scope,accountId,asOf);const id=idFor(scope.organisationId,accountId,source.asOf);const exists=await tx.configurationProfile.findUnique({where:{id}});
    return{source,message:source.blockers.length?null:renderCollectionNotice(source),notice:exists?view(await load(tx,scope,id),scope):null,sendConfigured:collectionEmailConfigured()};
}
export async function previewCollectionNotice(scope:RequestScope,accountId:string){
  return db.$transaction(tx=>previewInTransaction(tx,scope,accountId,southAfricaDateKey(new Date())),{isolationLevel:"RepeatableRead"});
}
export async function prepareCollectionNotice(scope:RequestScope,accountId:string,expectedFingerprint:string){
  z.string().regex(/^[a-f0-9]{64}$/).parse(expectedFingerprint);
  return db.$transaction(tx=>prepareInTransaction(tx,scope,accountId,expectedFingerprint,southAfricaDateKey(new Date())),{isolationLevel:"Serializable"});
}
async function prepareInTransaction(tx:Prisma.TransactionClient,scope:RequestScope,accountId:string,expectedFingerprint:string,asOf:string,draftOnly=false){
    const source=await collectionEmailSource(tx,scope,accountId,asOf);if(source.fingerprint!==expectedFingerprint)throw Error("COLLECTION_NOTICE_CHANGED");if(source.blockers.length)throw Error("COLLECTION_NOTICE_HOLD");
    const id=idFor(scope.organisationId,accountId,source.asOf),old=await tx.configurationProfile.findUnique({where:{id}}),payload=renderCollectionNotice(source);
    if(old){if(draftOnly&&old.status!=="DRAFT")throw Error("COLLECTION_NOTICE_IMMUTABLE");const previous=await load(tx,scope,id);if(previous.saved.sourceFingerprint===source.fingerprint&&previous.saved.payloadHash===noticeHash(payload))return view(previous,scope);if(old.status!=="DRAFT")throw Error("COLLECTION_NOTICE_IMMUTABLE");}
    const previous=old?storedSchema.parse(old.config):null;
    const saved={version:1,revision:randomUUID(),accountId,asOf:source.asOf,sourceFingerprint:source.fingerprint,payloadHash:noticeHash(payload),payloadEncrypted:encryptIntegrationSecret(JSON.stringify(payload)),contributors:[...new Set([...(previous?.contributors??[]),scope.userId])],approvedBy:null,approvalReference:null,approvedAt:null};
    const row=old?await tx.configurationProfile.update({where:{id},data:{config:saved,status:"DRAFT"}}):await tx.configurationProfile.create({data:{id,organisationId:scope.organisationId,facilityId:source.facilityId,domain,name:id,config:saved,status:"DRAFT"}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:source.facilityId,actorId:scope.userId,action:"collection.notice.prepared",entityType:"ConfigurationProfile",entityId:row.id,after:{revision:saved.revision,sourceFingerprint:source.fingerprint,payloadHash:saved.payloadHash,templateVersion:COLLECTION_NOTICE_VERSION,status:"DRAFT"}}});
    return view(await load(tx,scope,id),scope);
}
export async function previewCollectionNoticeBatch(scope:RequestScope,input:unknown){
  const ids=noticeBatchAccountsSchema.parse(input).sort(),asOf=southAfricaDateKey(new Date());
  return db.$transaction(async tx=>{
    const items=[];for(const id of ids)items.push(await previewInTransaction(tx,scope,id,asOf));
    if(asOf!==southAfricaDateKey(new Date()))throw Error("COLLECTION_NOTICE_CHANGED");
    return{asOf,items,prepared:false as const,emailSent:false as const};
  },{isolationLevel:"RepeatableRead",timeout:30000});
}
export async function prepareCollectionNoticeBatch(scope:RequestScope,input:unknown){
  const command=noticeBatchPreparationSchema.parse(input),asOf=southAfricaDateKey(new Date());
  return db.$transaction(async tx=>{
    const notices=[];for(const item of command.items.toSorted((a,b)=>a.accountId.localeCompare(b.accountId)))notices.push(await prepareInTransaction(tx,scope,item.accountId,item.fingerprint,asOf,true));
    if(asOf!==southAfricaDateKey(new Date()))throw Error("COLLECTION_NOTICE_CHANGED");
    return{asOf,notices,prepared:true as const,emailSent:false as const};
  },{isolationLevel:"Serializable",timeout:30000});
}
const reviewSchema=z.object({id:z.string().min(1).max(120),revision:z.string().uuid(),action:z.enum(["approve","reopen","cancel"]),reference:z.string().trim().min(3).max(240)}).strict();
export async function reviewCollectionNotice(scope:RequestScope,input:unknown){
  const command=reviewSchema.parse(input);
  return db.$transaction(tx=>reviewInTransaction(tx,scope,command),{isolationLevel:"Serializable"});
}
async function reviewInTransaction(tx:Prisma.TransactionClient,scope:RequestScope,command:z.infer<typeof reviewSchema>,expectedAccountId?:string){
    const value=await load(tx,scope,command.id);if(expectedAccountId&&value.saved.accountId!==expectedAccountId)throw Error("COLLECTION_NOTICE_CHANGED");if(value.saved.revision!==command.revision)throw Error("COLLECTION_NOTICE_CHANGED");const snapshot={...value.saved,revision:randomUUID()};let status=value.row.status;
    if(command.action==="approve"){
      if(status!=="DRAFT")throw Error("COLLECTION_NOTICE_IMMUTABLE");if(value.saved.contributors.includes(scope.userId))throw Error("COLLECTION_NOTICE_SELF_APPROVAL");
      if(value.current.asOf!==value.saved.asOf||value.current.blockers.length||value.current.fingerprint!==value.saved.sourceFingerprint||noticeHash(renderCollectionNotice(value.current))!==value.saved.payloadHash)throw Error("COLLECTION_NOTICE_CHANGED");
      status="APPROVED";snapshot.approvedBy=scope.userId;snapshot.approvedAt=new Date().toISOString();snapshot.approvalReference=command.reference;
    }else{
      if(!["DRAFT","APPROVED"].includes(status))throw Error("COLLECTION_NOTICE_IMMUTABLE");status=command.action==="cancel"?"CANCELLED":"DRAFT";snapshot.approvedBy=snapshot.approvedAt=snapshot.approvalReference=null;
    }
    await tx.configurationProfile.update({where:{id:command.id},data:{status,config:snapshot}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:value.current.facilityId,actorId:scope.userId,action:`collection.notice.${command.action}`,entityType:"ConfigurationProfile",entityId:command.id,after:{revision:snapshot.revision,status,reference:command.reference,payloadHash:snapshot.payloadHash}}});return view(await load(tx,scope,command.id),scope);
}
export async function approveCollectionNoticeBatch(scope:RequestScope,input:unknown){
  const command=noticeBatchApprovalSchema.parse(input),asOf=southAfricaDateKey(new Date());
  return db.$transaction(async tx=>{
    const notices=[];
    for(const item of command.items.toSorted((a,b)=>a.accountId.localeCompare(b.accountId)))notices.push(await reviewInTransaction(tx,scope,{id:item.id,revision:item.revision,action:"approve",reference:command.reference},item.accountId));
    if(asOf!==southAfricaDateKey(new Date()))throw Error("COLLECTION_NOTICE_CHANGED");
    return{asOf,notices,approved:true as const,emailSent:false as const};
  },{isolationLevel:"Serializable",timeout:30000});
}
const sendSchema=z.object({id:z.string().min(1).max(120),revision:z.string().uuid(),confirm:z.literal(true)}).strict();
export async function sendCollectionNotice(scope:RequestScope,input:unknown,injectedProvider?:EmailProvider){
  const command=sendSchema.parse(input);
  const claimed=await db.$transaction(async tx=>{
    const initial=await load(tx,scope,command.id);
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${initial.saved.accountId} FOR UPDATE`;
    const value=await load(tx,scope,command.id);
    // A repeat after acceptance/pending/uncertainty never attempts the provider.
    if(["ACCEPTED","SENDING","REVIEW_REQUIRED"].includes(value.row.status))return{repeated:true as const,value};
    if(!injectedProvider&&!collectionEmailConfigured())throw Error("COLLECTION_NOTICE_CONFIG");
    if(value.saved.revision!==command.revision)throw Error("COLLECTION_NOTICE_CHANGED");if(value.row.status!=="APPROVED")throw Error("COLLECTION_NOTICE_IMMUTABLE");
    if(value.current.blockers.length||value.current.fingerprint!==value.saved.sourceFingerprint||noticeHash(renderCollectionNotice(value.current))!==value.saved.payloadHash)throw Error("COLLECTION_NOTICE_CHANGED");
    await tx.communicationLog.create({data:{organisationId:scope.organisationId,facilityId:value.current.facilityId,customerId:value.current.customerId,channel:"EMAIL",direction:"OUTBOUND",messageType:"COLLECTION_REMINDER",recipientHash:privacyHash(value.payload.recipient),idempotencyKey:command.id,provider:process.env.EMAIL_PROVIDER??"twilio",status:"PENDING",attempts:1,nextRetryAt:null,metadata:{payloadHash:value.saved.payloadHash,sourceFingerprint:value.saved.sourceFingerprint,deliveryOutcome:"IN_PROGRESS"}}});
    await tx.configurationProfile.update({where:{id:command.id},data:{status:"SENDING"}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:value.current.facilityId,actorId:scope.userId,action:"collection.notice.send_claimed",entityType:"ConfigurationProfile",entityId:command.id,after:{payloadHash:value.saved.payloadHash,status:"SENDING",confirmed:true,templateVersion:COLLECTION_NOTICE_VERSION}}});return{repeated:false as const,value};
  },{isolationLevel:"Serializable"});
  if(claimed.repeated)return{...view(claimed.value,scope),repeated:true};
  let accepted=false;
  try{const value=claimed.value;await(injectedProvider??emailProvider()).send({to:value.payload.recipient,subject:value.payload.subject,text:value.payload.text,html:value.payload.html,dlp:{organisationId:scope.organisationId,facilityId:value.current.facilityId,actorId:scope.userId,resourceId:command.id,approvedRecipient:value.payload.recipient}});accepted=true;
    await db.$transaction(async tx=>{await tx.communicationLog.update({where:{idempotencyKey:command.id},data:{status:"SUCCEEDED",sentAt:new Date(),metadata:{payloadHash:value.saved.payloadHash,deliveryOutcome:"PROVIDER_ACCEPTED",inboxVerified:false}}});await tx.configurationProfile.update({where:{id:command.id},data:{status:"ACCEPTED"}});await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:value.current.facilityId,actorId:scope.userId,action:"collection.notice.provider_accepted",entityType:"ConfigurationProfile",entityId:command.id,after:{payloadHash:value.saved.payloadHash,inboxVerified:false}}});});
  }catch{
    // Even a known rejection is held: no blind replay after an ambiguous send.
    try{await db.$transaction(async tx=>{await tx.communicationLog.update({where:{idempotencyKey:command.id},data:{status:"PENDING",failedAt:null,failureCode:"NOTICE_DELIVERY_REVIEW",nextRetryAt:null,metadata:{payloadHash:claimed.value.saved.payloadHash,deliveryOutcome:accepted?"ACCEPTED_PERSISTENCE_UNCERTAIN":"REQUIRES_REVIEW"}}});await tx.configurationProfile.update({where:{id:command.id},data:{status:"REVIEW_REQUIRED"}});await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:claimed.value.current.facilityId,actorId:scope.userId,action:"collection.notice.delivery_review",entityType:"ConfigurationProfile",entityId:command.id,after:{providerAcceptanceObserved:accepted,retryAllowed:false}}});});}catch{/* Existing SENDING claim remains a durable stop. */}
  }
  return{...view(await load(db,scope,command.id),scope),repeated:false};
}
