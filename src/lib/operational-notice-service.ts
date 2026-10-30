import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireFacility, facilityWhere, type RequestScope } from "@/lib/scope";
import { currentRoleAccess } from "@/lib/current-role-access";
import { noticeHash, collectionEmailConfigured } from "@/lib/collection-notice-policy";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "@/lib/integrations/integration-secret-vault";
import { emailProvider, escapeEmailHtml, type EmailProvider } from "@/lib/email";
import { privacyHash } from "@/lib/request-security";
import { historyEvidence } from "@/lib/customer-history-message-policy";
import { noticeTemplateSchema, noticeValuesSchema, noticeAudienceSchema, renderOperationalNotice } from "./operational-notice-policy";

type Tx=Prisma.TransactionClient;
const domain="OPERATIONAL_EMAIL_NOTICE";
const prefix=(facility:string)=>`operational:${facility}:`;
const itemSchema=z.object({customerId:z.string(),recipient:z.email(),subject:z.string(),text:z.string()}).strict();
const savedSchema=z.object({version:z.literal(1),revision:z.string().uuid(),templateId:z.string(),values:noticeValuesSchema,customerIds:noticeAudienceSchema,fingerprint:z.string(),payloadEncrypted:z.string(),preparedBy:z.string(),approvedBy:z.string().nullable(),reference:z.string().nullable(),approvedAt:z.string().nullable(),outcomes:z.record(z.string(),z.enum(["NOT_ATTEMPTED","SENDING","ACCEPTED","REVIEW_REQUIRED"]))}).strict();
const inputSchema=z.object({templateId:z.string().min(1).max(100),values:noticeValuesSchema,customerIds:noticeAudienceSchema}).strict();
async function authority(tx:Tx,scope:RequestScope,facilityId:string,send=false,manage=true){
  const facility=await tx.facility.findFirst({where:{AND:[{id:facilityId},facilityWhere(scope)]}});
  const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
  const grants=user?.roleAssignments.filter(a=>a.role.organisationId===scope.organisationId)??[];
  if(!facility||!["operations.view",...(manage?["operations.manage"]:[]),...(send?["billing.documents.send"]:[])].every(p=>currentRoleAccess(grants,p,facilityId).allowed))throw Error("FORBIDDEN");
  return facility;
}
async function template(tx:Tx,scope:RequestScope,facilityId:string,id:string){
  const row=await tx.communicationTemplate.findFirst({where:{id,organisationId:scope.organisationId,key:{startsWith:prefix(facilityId)},channel:"EMAIL"}});
  if(!row)throw Error("NOTICE_NOT_FOUND");return row;
}
async function lock(tx:Tx,scope:RequestScope,facilityId:string,id:string){await tx.$queryRaw`SELECT "id" FROM "ConfigurationProfile" WHERE "id"=${id} AND "organisationId"=${scope.organisationId} AND "facilityId"=${facilityId} AND "domain"=${domain} FOR UPDATE`;}
async function audit(tx:Tx,scope:RequestScope,facilityId:string,action:string,id:string,after:Prisma.InputJsonValue){await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId,actorId:scope.userId,action:`operational.notice.${action}`,entityType:action==="template_saved"?"CommunicationTemplate":"ConfigurationProfile",entityId:id,after}});}
const customerWhere=(scope:RequestScope,facilityId:string)=>({organisationId:scope.organisationId,tenancies:{some:{facilityId,status:{in:["ACTIVE","NOTICE_GIVEN"]}}}} satisfies Prisma.CustomerWhereInput);
const selectCustomer={id:true,firstName:true,lastName:true,companyName:true,email:true,emailVerifiedAt:true,communicationConsent:true} as const;
const customerName=(c:{companyName:string|null;firstName:string|null;lastName:string|null})=>c.companyName||[c.firstName,c.lastName].filter(Boolean).join(" ")||"Customer";
function blockers(c:{email:string|null;emailVerifiedAt:Date|null;communicationConsent:unknown}){
  const consent=c.communicationConsent as {email?:boolean;optedOutAt?:unknown}|null;
  return [...(!c.emailVerifiedAt||!z.email().safeParse(c.email).success?["Verified email required"]:[]),...(consent?.email!==true||consent?.optedOutAt?["Current email consent required"]:[])];
}
async function preview(tx:Tx,scope:RequestScope,facilityId:string,input:unknown){
  const command=inputSchema.parse(input),facility=await authority(tx,scope,facilityId),t=await template(tx,scope,facilityId,command.templateId);
  const latest=await tx.communicationTemplate.findFirst({where:{organisationId:scope.organisationId,key:t.key},orderBy:{version:"desc"}});
  if(!t.active||latest?.id!==t.id)throw Error("NOTICE_CHANGED");
  const customers=await tx.customer.findMany({where:{...customerWhere(scope,facilityId),id:{in:command.customerIds}},select:selectCustomer,orderBy:{id:"asc"}});
  if(customers.length!==command.customerIds.length)throw Error("NOTICE_NOT_FOUND");
  const items=customers.map(c=>({customerId:c.id,recipient:c.email??"",...renderOperationalNotice({name:t.name,subject:t.subject,body:t.body},command.values,customerName(c),facility.name),blockers:blockers(c)}));
  return {templateId:t.id,templateVersion:t.version,items,fingerprint:noticeHash({facilityId,facilityName:facility.name,templateId:t.id,values:command.values,customers,items}),sendConfigured:collectionEmailConfigured()};
}
async function load(tx:Tx,scope:RequestScope,facilityId:string,id:string){
  const row=await tx.configurationProfile.findFirst({where:{id,organisationId:scope.organisationId,facilityId,domain}});if(!row)throw Error("NOTICE_NOT_FOUND");
  const saved=savedSchema.parse(row.config),items=z.array(itemSchema).min(1).max(20).parse(JSON.parse(decryptIntegrationSecret(saved.payloadEncrypted)));
  return {row,saved,items};
}
function view(v:Awaited<ReturnType<typeof load>>){return{id:v.row.id,status:v.row.status,revision:v.saved.revision,templateId:v.saved.templateId,preparedBy:v.saved.preparedBy,approvedBy:v.saved.approvedBy,reference:v.saved.reference,approvedAt:v.saved.approvedAt,items:v.items.map(item=>({...item,status:v.saved.outcomes[item.customerId]})),deliveryVerified:false};}
async function current(tx:Tx,scope:RequestScope,facilityId:string,v:Awaited<ReturnType<typeof load>>){
  const p=await preview(tx,scope,facilityId,{templateId:v.saved.templateId,values:v.saved.values,customerIds:v.saved.customerIds});
  if(p.fingerprint!==v.saved.fingerprint||p.items.some(i=>i.blockers.length))throw Error("NOTICE_CHANGED");
  if(noticeHash(p.items.map(i=>({customerId:i.customerId,recipient:i.recipient,subject:i.subject,text:i.text})))!==noticeHash(v.items))throw Error("NOTICE_CHANGED");return p;
}
export async function operationalNoticeLibrary(scope:RequestScope,facilityId:string,search=""){
  await requireFacility(scope,facilityId);
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId,false,false);
    const [templates,customers,runs]=await Promise.all([
      tx.communicationTemplate.findMany({where:{organisationId:scope.organisationId,key:{startsWith:prefix(facilityId)},channel:"EMAIL"},orderBy:[{createdAt:"desc"},{version:"desc"}],take:200}),
      tx.customer.findMany({where:{...customerWhere(scope,facilityId),...(search?{OR:[{firstName:{contains:search,mode:"insensitive" as const}},{lastName:{contains:search,mode:"insensitive" as const}},{companyName:{contains:search,mode:"insensitive" as const}}]}:{})},select:selectCustomer,orderBy:{id:"asc"},take:51}),
      tx.configurationProfile.findMany({where:{organisationId:scope.organisationId,facilityId,domain},orderBy:{createdAt:"desc"},take:20}),
    ]);
    return {templates:templates.map(t=>({id:t.id,key:t.key,name:t.name,subject:t.subject??"",body:t.body,version:t.version,createdAt:t.createdAt.toISOString()})),customers:customers.slice(0,50).map(c=>({id:c.id,name:customerName(c),email:c.email,blockers:blockers(c)})),moreCustomers:customers.length>50,runs:await Promise.all(runs.map(r=>load(tx,scope,facilityId,r.id).then(view))),sendConfigured:collectionEmailConfigured()};
  },{isolationLevel:"RepeatableRead"});
}
export async function saveOperationalTemplate(scope:RequestScope,facilityId:string,input:unknown){
  const command=z.object({templateId:z.string().min(1).max(100).nullable(),content:noticeTemplateSchema}).strict().parse(input);
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId);await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id"=${facilityId} FOR UPDATE`;
    const previous=command.templateId?await template(tx,scope,facilityId,command.templateId):null;
    if(previous&&(await tx.communicationTemplate.findFirst({where:{organisationId:scope.organisationId,key:previous.key},orderBy:{version:"desc"}}))?.id!==previous.id)throw Error("NOTICE_CHANGED");
    const row=await tx.communicationTemplate.create({data:{organisationId:scope.organisationId,key:previous?.key??prefix(facilityId)+randomUUID(),...command.content,channel:"EMAIL",variables:["customer_name","store_name","notice_date","effective_time","details","contact_details"],version:(previous?.version??0)+1}});
    await audit(tx,scope,facilityId,"template_saved",row.id,{version:row.version,key:row.key});return row;
  },{isolationLevel:"Serializable"});
}
export function previewOperationalNotice(scope:RequestScope,facilityId:string,input:unknown){return db.$transaction(tx=>preview(tx,scope,facilityId,input),{isolationLevel:"RepeatableRead"});}
export async function prepareOperationalNotice(scope:RequestScope,facilityId:string,input:unknown){
  const {fingerprint,...command}=z.object({...inputSchema.shape,fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input);
  return db.$transaction(async tx=>{
    const p=await preview(tx,scope,facilityId,command);if(p.fingerprint!==fingerprint||p.items.some(i=>i.blockers.length))throw Error("NOTICE_CHANGED");
    const items=p.items.map(i=>({customerId:i.customerId,recipient:i.recipient,subject:i.subject,text:i.text})),saved={version:1,revision:randomUUID(),...command,fingerprint,payloadEncrypted:encryptIntegrationSecret(JSON.stringify(items)),preparedBy:scope.userId,approvedBy:null,reference:null,approvedAt:null,outcomes:Object.fromEntries(items.map(i=>[i.customerId,"NOT_ATTEMPTED"]))};
    const id=`operational:${noticeHash([scope.organisationId,facilityId,fingerprint])}`;
    if(await tx.configurationProfile.findUnique({where:{id}}))return view(await load(tx,scope,facilityId,id));
    const row=await tx.configurationProfile.create({data:{id,organisationId:scope.organisationId,facilityId,domain,name:id,config:saved,status:"DRAFT"}});
    await audit(tx,scope,facilityId,"prepared",row.id,{fingerprint,templateId:p.templateId,recipientCount:items.length});return view(await load(tx,scope,facilityId,row.id));
  },{isolationLevel:"Serializable"});
}
export async function reviewOperationalNotice(scope:RequestScope,facilityId:string,input:unknown){
  const command=z.object({id:z.string().min(1).max(100),revision:z.string().uuid(),action:z.enum(["approve","cancel"]),reference:z.string().trim().min(3).max(240)}).strict().parse(input);
  return db.$transaction(async tx=>{
    await authority(tx,scope,facilityId);await lock(tx,scope,facilityId,command.id);const v=await load(tx,scope,facilityId,command.id);
    if(v.saved.revision!==command.revision||!["DRAFT","APPROVED","DISPATCHING"].includes(v.row.status)||Object.values(v.saved.outcomes).includes("SENDING"))throw Error("NOTICE_CHANGED");
    if(command.action==="approve"){
      if(v.row.status!=="DRAFT")throw Error("NOTICE_CHANGED");await current(tx,scope,facilityId,v);
      const t=await template(tx,scope,facilityId,v.saved.templateId),versions=await tx.communicationTemplate.findMany({where:{organisationId:scope.organisationId,key:t.key},select:{id:true}});
      const contributor=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,actorId:scope.userId,action:"operational.notice.template_saved",entityId:{in:versions.map(r=>r.id)}}});
      if(v.saved.preparedBy===scope.userId||contributor)throw Error("NOTICE_SELF_APPROVAL");
    }
    const saved={...v.saved,revision:randomUUID(),...(command.action==="approve"?{approvedBy:scope.userId,reference:command.reference,approvedAt:new Date().toISOString()}:{})},status=command.action==="approve"?"APPROVED":"CANCELLED";
    await tx.configurationProfile.update({where:{id:v.row.id},data:{status,config:saved}});await audit(tx,scope,facilityId,command.action,v.row.id,{status,reference:command.reference});return view(await load(tx,scope,facilityId,v.row.id));
  },{isolationLevel:"Serializable"});
}
export async function sendOperationalNotice(scope:RequestScope,facilityId:string,input:unknown,injectedProvider?:EmailProvider){
  const command=z.object({id:z.string().min(1).max(100),revision:z.string().uuid(),customerId:z.string().min(1).max(100),confirm:z.literal(true)}).strict().parse(input);
  const claim=await db.$transaction(async tx=>{
    await authority(tx,scope,facilityId,true);await lock(tx,scope,facilityId,command.id);const v=await load(tx,scope,facilityId,command.id),item=v.items.find(i=>i.customerId===command.customerId);
    if(!item)throw Error("NOTICE_NOT_FOUND");
    if(v.saved.outcomes[item.customerId]!=="NOT_ATTEMPTED")return {repeated:true as const,v,item};
    if(v.saved.revision!==command.revision||!["APPROVED","DISPATCHING"].includes(v.row.status)||!v.saved.approvedBy||!v.saved.reference||v.saved.approvedBy===v.saved.preparedBy||Object.values(v.saved.outcomes).some(s=>["SENDING","REVIEW_REQUIRED"].includes(s)))throw Error("NOTICE_CHANGED");
    await authority(tx,{...scope,userId:v.saved.approvedBy},facilityId);await current(tx,scope,facilityId,v);if(!injectedProvider&&!collectionEmailConfigured())throw Error("NOTICE_CONFIG");
    const saved={...v.saved,outcomes:{...v.saved.outcomes,[item.customerId]:"SENDING"}};
    await tx.communicationLog.create({data:{organisationId:scope.organisationId,facilityId,customerId:item.customerId,templateId:v.saved.templateId,channel:"EMAIL",direction:"OUTBOUND",messageType:"OPERATIONAL_NOTICE",recipientHash:privacyHash(item.recipient),idempotencyKey:`${v.row.id}:${item.customerId}`,provider:process.env.EMAIL_PROVIDER??"twilio",status:"PENDING",nextRetryAt:null,metadata:{deliveryOutcome:"IN_PROGRESS",historyEvidence:historyEvidence(item)}}});
    await tx.configurationProfile.update({where:{id:v.row.id},data:{config:saved,status:"DISPATCHING"}});await audit(tx,scope,facilityId,"send_claimed",v.row.id,{customerId:item.customerId,confirmed:true});return{repeated:false as const,v,item};
  },{isolationLevel:"Serializable"});
  if(claim.repeated)return{...view(claim.v),repeated:true};
  let accepted=false;
  try{
    await db.$transaction(async tx=>{await authority(tx,scope,facilityId,true);await authority(tx,{...scope,userId:claim.v.saved.approvedBy!},facilityId);await current(tx,scope,facilityId,claim.v);},{isolationLevel:"RepeatableRead"});
    const {item}=claim;await(injectedProvider??emailProvider()).send({to:item.recipient,subject:item.subject,text:item.text,html:`<!doctype html><html lang="en"><body><div style="white-space:pre-wrap">${escapeEmailHtml(item.text)}</div></body></html>`,dlp:{organisationId:scope.organisationId,facilityId,actorId:scope.userId,resourceId:claim.v.row.id,approvedRecipient:item.recipient}});accepted=true;
    await finish("ACCEPTED");
  }catch{try{await finish("REVIEW_REQUIRED")}catch{/* Durable SENDING claim prevents replay. */}}
  async function finish(outcome:"ACCEPTED"|"REVIEW_REQUIRED"){
    await db.$transaction(async tx=>{
      await lock(tx,scope,facilityId,command.id);const v=await load(tx,scope,facilityId,command.id),saved={...v.saved,outcomes:{...v.saved.outcomes,[command.customerId]:outcome}};
      await tx.communicationLog.update({where:{idempotencyKey:`${command.id}:${command.customerId}`},data:{status:outcome==="ACCEPTED"?"SUCCEEDED":"PENDING",...(outcome==="ACCEPTED"?{sentAt:new Date()}:{failureCode:"NOTICE_DELIVERY_REVIEW"}),nextRetryAt:null,metadata:{deliveryOutcome:outcome,providerAcceptanceObserved:accepted,inboxVerified:false,historyEvidence:historyEvidence(claim.item)}}});
      await tx.configurationProfile.update({where:{id:command.id},data:{config:saved,status:Object.values(saved.outcomes).every(s=>s==="ACCEPTED")?"ACCEPTED":outcome==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":"DISPATCHING"}});
      await audit(tx,scope,facilityId,"delivery_outcome",command.id,{customerId:command.customerId,outcome,providerAcceptanceObserved:accepted,inboxVerified:false});
    });
  }
  return{...view(await load(db,scope,facilityId,command.id)),repeated:false};
}
