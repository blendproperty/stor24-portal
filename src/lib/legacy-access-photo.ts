import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { tenantCustomerScope } from "@/lib/tenant-portal-security";
import { resolvedPhotoPolicy } from "@/lib/facial-photo-control";
import { decryptPhoto, encryptPhoto, normaliseFacialPhoto } from "@/lib/facial-photo-security";
import { integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import { legacyPaymentEvidence } from "@/lib/legacy-payment-evidence";
import { legacySignedArtifactHash } from "@/lib/legacy-handover";

type Database = Prisma.TransactionClient;
type CustomerSession = {organisationId:string;email:string;customerIds:string[]};
const summary = {id:true,tenancyId:true,version:true,status:true,consentAt:true,expiresAt:true,reviewedAt:true,activationRequestedAt:true,erasedAt:true} as const;
const binding = (id:string, version:number) => `tenancy:${id}:legacy-photo:${version}`;
async function lock(tx:Database,id:string) { await tx.$queryRaw`SELECT "id" FROM "Tenancy" WHERE "id" = ${id} FOR UPDATE`; }
async function customerTenancy(database:Database, session:CustomerSession, id:string) {
  const tenancy=await database.tenancy.findFirst({where:{id,facility:{organisationId:session.organisationId},customer:tenantCustomerScope(session)},include:{documents:true,account:{select:{customerId:true}}}});
  if(!tenancy || tenancy.account.customerId!==tenancy.customerId) throw Error("TENANT_NOT_FOUND");
  return tenancy;
}
function eligible(tenancy:Pick<Awaited<ReturnType<typeof customerTenancy>>,"status"|"documents">) {
  return ["DRAFT","ACTIVE","NOTICE_GIVEN"].includes(tenancy.status) && tenancy.documents.filter(d=>d.type==="LEASE_AGREEMENT" && d.status==="SIGNED" && d.signedAt && d.provider==="BLENDSIGN" && d.externalId).length===1;
}
async function policyForCollection(database:Database,organisationId:string) {
  const policy=await resolvedPhotoPolicy(database,organisationId);
  if(!policy?.enabled || !integrationEncryptionConfigured()) throw Error("PHOTO_POLICY_PENDING");
  const worker=await database.facialPhotoMaintenance.findUnique({where:{id:"expiry"}});
  if(!worker || worker.completedAt.getTime()<Date.now()-90*60*1000)throw Error("PHOTO_MAINTENANCE_REQUIRED");
  return policy;
}
export async function legacyPhotoStatus(session:CustomerSession,id:string) {
  const tenancy=await customerTenancy(db,session,id), policy=await resolvedPhotoPolicy(db,session.organisationId);
  let available=false; try {await policyForCollection(db,session.organisationId);available=eligible(tenancy) && (await legacyPaymentEvidence(db,tenancy.accountId)).ready;} catch { /* Status remains readable when collection is paused. */ }
  const photo=await db.legacyAccessPhoto.findUnique({where:{tenancyId:id},select:summary});
  return {available,policy:policy?{version:policy.version,hash:policy.hash,notice:policy.notice,consentLabel:policy.consentLabel,retentionHours:policy.retentionHours,alternativeContact:policy.alternativeContact}:null,photo:photo && photo.expiresAt && photo.expiresAt<=new Date()?{...photo,status:"EXPIRED"}:photo};
}
export async function submitLegacyPhoto(session:CustomerSession,input:{tenancyId:string;policyHash:string;consent:boolean;expectedVersion:number;image:File}) {
  const tenancy=await customerTenancy(db,session,input.tenancyId);
  if(!eligible(tenancy) || !(await legacyPaymentEvidence(db,tenancy.accountId)).ready)throw Error("PHOTO_BOOKING_NOT_READY");
  const policy=await policyForCollection(db,session.organisationId);
  if(!input.consent || input.policyHash!==policy.hash)throw Error("PHOTO_CONSENT_REQUIRED");
  const signed=tenancy.documents.find(d=>d.type==="LEASE_AGREEMENT" && d.status==="SIGNED" && d.signedAt && d.provider==="BLENDSIGN" && d.externalId)!;
  await legacySignedArtifactHash(signed.externalId!);
  const image=await normaliseFacialPhoto(input.image);
  try { return await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${session.organisationId} FOR UPDATE`;
    await lock(tx,input.tenancyId);
    const currentTenancy=await customerTenancy(tx,session,input.tenancyId), currentPolicy=await policyForCollection(tx,session.organisationId);
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${currentTenancy.accountId} FOR UPDATE`;
    if(!eligible(currentTenancy) || !currentTenancy.documents.some(d=>d.id===signed.id && d.status==="SIGNED" && d.externalId===signed.externalId) || !(await legacyPaymentEvidence(tx,currentTenancy.accountId)).ready)throw Error("PHOTO_BOOKING_NOT_READY");
    if(currentPolicy.hash!==input.policyHash)throw Error("PHOTO_CONSENT_REQUIRED");
    const old=await tx.legacyAccessPhoto.findUnique({where:{tenancyId:input.tenancyId}});
    if((old?.version??0)!==input.expectedVersion)throw Error("PHOTO_CHANGED");
    const version=(old?.version??0)+1,now=new Date();
    const values={version,status:"WAITING_REVIEW",encryptedImage:encryptPhoto(image,binding(input.tenancyId,version)),imageSha256:createHash("sha256").update(image).digest("hex"),policyVersion:currentPolicy.version,policyHash:currentPolicy.hash,consentNotice:JSON.stringify({notice:currentPolicy.notice,consentLabel:currentPolicy.consentLabel,alternativeContact:currentPolicy.alternativeContact,retentionHours:currentPolicy.retentionHours,approvalReference:currentPolicy.approvalReference}),consentAt:now,expiresAt:currentPolicy.retentionHours===null?null:new Date(now.getTime()+currentPolicy.retentionHours*3600000),reviewedAt:null,reviewedById:null,activationRequestedAt:null,erasedAt:null};
    const photo=await tx.legacyAccessPhoto.upsert({where:{tenancyId:input.tenancyId},create:{tenancyId:input.tenancyId,...values},update:values,select:summary});
    await tx.auditEvent.create({data:{organisationId:session.organisationId,facilityId:currentTenancy.facilityId,action:"legacy_photo.customer_submitted",entityType:"LegacyAccessPhoto",entityId:photo.id,after:{customerId:currentTenancy.customerId,tenancyId:input.tenancyId,version,policyHash:currentPolicy.hash,policyVersion:currentPolicy.version,consentAt:now.toISOString(),expiresAt:values.expiresAt?.toISOString()??null}}});
    return photo;
  }); } finally {image.fill(0);}
}
export async function withdrawLegacyPhoto(session:CustomerSession,id:string,version:number) {
  await db.$transaction(async tx=>{await lock(tx,id);const tenancy=await customerTenancy(tx,session,id);const photo=await tx.legacyAccessPhoto.findUnique({where:{tenancyId:id}});
    if(!photo||photo.version!==version)throw Error("PHOTO_CHANGED");if(photo.status==="WITHDRAWN")return;
    await tx.legacyAccessPhoto.update({where:{id:photo.id},data:{status:"WITHDRAWN",encryptedImage:null,erasedAt:new Date(),reviewedAt:null,reviewedById:null,activationRequestedAt:null}});
    await tx.auditEvent.create({data:{organisationId:session.organisationId,facilityId:tenancy.facilityId,action:"legacy_photo.consent_withdrawn",entityType:"LegacyAccessPhoto",entityId:photo.id,after:{version}}});
  });
}
/** Assisted capture is for a customer physically present with their original ID. */
export async function submitAssistedLegacyPhoto(scope:RequestScope,input:{tenancyId:string;policyHash:string;customerConsent:boolean;identityChecked:boolean;expectedVersion:number;image:File}) {
  const find=async (database:Database)=>{
    const tenancy=await database.tenancy.findFirst({where:{id:input.tenancyId,facility:facilityWhere(scope),customer:{organisationId:scope.organisationId}},include:{documents:true,account:{select:{customerId:true}}}});
    if(!tenancy || tenancy.customerId!==tenancy.account.customerId)throw Error("NOT_FOUND");return tenancy;
  };
  if(!input.customerConsent||!input.identityChecked)throw Error("PHOTO_CONSENT_REQUIRED");
  const tenancy=await find(db),policy=await policyForCollection(db,scope.organisationId);
  if(policy.hash!==input.policyHash)throw Error("PHOTO_CONSENT_REQUIRED");
  if(!eligible(tenancy)||!(await legacyPaymentEvidence(db,tenancy.accountId)).ready)throw Error("PHOTO_BOOKING_NOT_READY");
  const signed=tenancy.documents.find(d=>d.type==="LEASE_AGREEMENT"&&d.status==="SIGNED"&&d.signedAt&&d.provider==="BLENDSIGN"&&d.externalId)!;
  await legacySignedArtifactHash(signed.externalId!);
  const image=await normaliseFacialPhoto(input.image);
  try{return await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${scope.organisationId} FOR UPDATE`;
    await lock(tx,input.tenancyId);const current=await find(tx),currentPolicy=await policyForCollection(tx,scope.organisationId);
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${current.accountId} FOR UPDATE`;
    if(currentPolicy.hash!==input.policyHash)throw Error("PHOTO_CONSENT_REQUIRED");
    if(!eligible(current)||!current.documents.some(d=>d.id===signed.id&&d.status==="SIGNED"&&d.externalId===signed.externalId)||!(await legacyPaymentEvidence(tx,current.accountId)).ready)throw Error("PHOTO_BOOKING_NOT_READY");
    const old=await tx.legacyAccessPhoto.findUnique({where:{tenancyId:input.tenancyId}});if((old?.version??0)!==input.expectedVersion)throw Error("PHOTO_CHANGED");
    const version=(old?.version??0)+1,now=new Date();
    const values={version,status:"WAITING_REVIEW",encryptedImage:encryptPhoto(image,binding(input.tenancyId,version)),imageSha256:createHash("sha256").update(image).digest("hex"),policyVersion:currentPolicy.version,policyHash:currentPolicy.hash,consentNotice:JSON.stringify({notice:currentPolicy.notice,consentLabel:currentPolicy.consentLabel,alternativeContact:currentPolicy.alternativeContact,retentionHours:currentPolicy.retentionHours,approvalReference:currentPolicy.approvalReference}),consentAt:now,expiresAt:currentPolicy.retentionHours===null?null:new Date(now.getTime()+currentPolicy.retentionHours*3600000),reviewedAt:null,reviewedById:null,activationRequestedAt:null,erasedAt:null};
    const photo=await tx.legacyAccessPhoto.upsert({where:{tenancyId:input.tenancyId},create:{tenancyId:input.tenancyId,...values},update:values,select:summary});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:current.facilityId,actorId:scope.userId,action:"legacy_photo.assisted_customer_submitted",entityType:"LegacyAccessPhoto",entityId:photo.id,after:{customerId:current.customerId,tenancyId:input.tenancyId,version,policyHash:currentPolicy.hash,policyVersion:currentPolicy.version,identityCheckedInPerson:true,customerConsentInPerson:true,consentAt:now.toISOString(),expiresAt:values.expiresAt?.toISOString()??null}}});return photo;
  });}finally{image.fill(0);}
}
export async function withdrawAssistedLegacyPhoto(scope:RequestScope,tenancyId:string,version:number,identityChecked:boolean) {
  if(!identityChecked)throw Error("PHOTO_IDENTITY_REQUIRED");
  await db.$transaction(async tx=>{await lock(tx,tenancyId);const photo=await tx.legacyAccessPhoto.findFirst({where:{tenancyId,tenancy:{facility:facilityWhere(scope),customer:{organisationId:scope.organisationId}}},include:{tenancy:{select:{facilityId:true,customerId:true}}}});
    if(!photo)throw Error("NOT_FOUND");if(photo.version!==version)throw Error("PHOTO_CHANGED");if(photo.status==="WITHDRAWN")return;
    await tx.legacyAccessPhoto.update({where:{id:photo.id},data:{status:"WITHDRAWN",encryptedImage:null,erasedAt:new Date(),reviewedAt:null,reviewedById:null,activationRequestedAt:null}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:photo.tenancy.facilityId,actorId:scope.userId,action:"legacy_photo.assisted_consent_withdrawn",entityType:"LegacyAccessPhoto",entityId:photo.id,after:{version,customerId:photo.tenancy.customerId,identityCheckedInPerson:true}}});
  });
}
async function staffPhoto(tx:Database,scope:RequestScope,id:string) {
  const photo=await tx.legacyAccessPhoto.findFirst({where:{id,tenancy:{facility:facilityWhere(scope),customer:{organisationId:scope.organisationId}}},include:{tenancy:{include:{documents:true}}}});
  if(!photo)throw Error("NOT_FOUND");return photo;
}
export async function previewLegacyPhoto(scope:RequestScope,id:string,version:number) {
  return db.$transaction(async tx=>{const first=await staffPhoto(tx,scope,id);await lock(tx,first.tenancyId);const photo=await staffPhoto(tx,scope,id);
    if(photo.version!==version||photo.status!=="WAITING_REVIEW"||!photo.encryptedImage||(photo.expiresAt&&photo.expiresAt<=new Date())||!eligible(photo.tenancy)||(await resolvedPhotoPolicy(tx,scope.organisationId))?.hash!==photo.policyHash)throw Error("PHOTO_CHANGED");
    const bytes=decryptPhoto(photo.encryptedImage,binding(photo.tenancyId,version));
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:photo.tenancy.facilityId,actorId:scope.userId,action:"legacy_photo.previewed",entityType:"LegacyAccessPhoto",entityId:id,after:{version}}});return bytes;
  });
}
export async function reviewLegacyPhoto(scope:RequestScope,id:string,version:number,decision:"APPROVE"|"REJECT") {
  await db.$transaction(async tx=>{const first=await staffPhoto(tx,scope,id);await lock(tx,first.tenancyId);const photo=await staffPhoto(tx,scope,id);
    if(photo.version!==version||photo.status!=="WAITING_REVIEW"||!photo.encryptedImage||(photo.expiresAt&&photo.expiresAt<=new Date())||!eligible(photo.tenancy)||(await resolvedPhotoPolicy(tx,scope.organisationId))?.hash!==photo.policyHash)throw Error("PHOTO_CHANGED");
    if(decision==="APPROVE" && !await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:photo.tenancy.facilityId,actorId:scope.userId,entityType:"LegacyAccessPhoto",entityId:id,action:"legacy_photo.previewed",after:{path:["version"],equals:version}}}))throw Error("PHOTO_PREVIEW_REQUIRED");
    const handover=decision==="APPROVE" ? await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:photo.tenancy.facilityId,entityType:"Tenancy",entityId:photo.tenancyId,action:"tenancy.key_handover_confirmed"}}) : null;
    await tx.legacyAccessPhoto.update({where:{id},data:{status:decision==="APPROVE"?(handover?"PENDING_PROVIDER":"APPROVED"):"REJECTED",reviewedById:scope.userId,reviewedAt:new Date(),activationRequestedAt:handover?new Date():null,...(decision==="REJECT"?{encryptedImage:null,erasedAt:new Date()}:{})}});
    await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:photo.tenancy.facilityId,actorId:scope.userId,action:decision==="APPROVE"?"legacy_photo.approved":"legacy_photo.rejected",entityType:"LegacyAccessPhoto",entityId:id,after:{version}}});
  });
}
export async function expireLegacyPhotos() {
  const where:Prisma.LegacyAccessPhotoWhereInput={encryptedImage:{not:null},OR:[{expiresAt:{lte:new Date()}},{tenancy:{status:{in:["CLOSED","CANCELLED"]}}},{tenancy:{reservation:{status:{in:["CANCELLED","EXPIRED"]}}}}]};
  const candidates=await db.legacyAccessPhoto.findMany({where,select:{id:true,tenancyId:true},take:100});
  for(const candidate of candidates)await db.$transaction(async tx=>{await lock(tx,candidate.tenancyId);const photo=await tx.legacyAccessPhoto.findFirst({where:{...where,id:candidate.id},include:{tenancy:{include:{facility:{select:{organisationId:true}}}}}});if(!photo)return;
    await tx.legacyAccessPhoto.update({where:{id:photo.id},data:{encryptedImage:null,status:"EXPIRED",erasedAt:new Date(),reviewedAt:null,reviewedById:null,activationRequestedAt:null}});
    await tx.auditEvent.create({data:{organisationId:photo.tenancy.facility.organisationId,facilityId:photo.tenancy.facilityId,action:"legacy_photo.erased",entityType:"LegacyAccessPhoto",entityId:photo.id,after:{version:photo.version}}});
  });
  if(await db.legacyAccessPhoto.count({where}))throw Error("PHOTO_EXPIRY_MORE_DUE");
}
