import type {Prisma,ConfigurationProfile} from '@/generated/prisma/client';
import {db} from '@/lib/db';
import type {RequestScope} from '@/lib/scope';
import {currentRoleAccess} from '@/lib/current-role-access';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {currentNetcashRefundSource} from './netcash-refund-source';
import {NETCASH_REFUND_DOMAIN,refundRecordId,refundRecordSchema,readRefundRecord,sealRefundRecord,transitionRefundRecord,projectRefundRecord,type NetcashRefundRecord} from './netcash-refund-policy';

type Tx=Prisma.TransactionClient;
const transaction={isolationLevel:'Serializable' as const,timeout:20000};
const permissions={review:'payments.refund_review',reject:'payments.refund_review',withdraw:'payments.refund_prepare',reserve:'payments.refund_reserve','request-release':'payments.refund_reserve','approve-release':'payments.refund_release_review'}as const;
function preparationEnabled(){if(process.env.NETCASH_REFUND_PREPARATION_ENABLED!=='true')throw Error('NETCASH_REFUND_PREPARATION_DISABLED');}
async function authority(tx:Tx,scope:RequestScope,facilityId:string,permission:string){
 if(!scope.unrestrictedFacilities&&!scope.facilityIds.includes(facilityId))throw Error('FORBIDDEN');
 const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{where:{role:{organisationId:scope.organisationId}},include:{role:true}}}});
 if(!user||!currentRoleAccess(user.roleAssignments,'adjustments.view',facilityId).allowed||!currentRoleAccess(user.roleAssignments,permission,facilityId).allowed||!await tx.facility.findFirst({where:{id:facilityId,organisationId:scope.organisationId},select:{id:true}}))throw Error('FORBIDDEN');
}
async function lockAccount(tx:Tx,scope:RequestScope,facilityId:string,accountId:string){
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT a."id" FROM "Account" a JOIN "Customer" c ON c."id"=a."customerId" JOIN "Tenancy" t ON t."accountId"=a."id" WHERE a."id"=${accountId} AND c."organisationId"=${scope.organisationId} AND t."facilityId"=${facilityId} FOR UPDATE OF a`;
 if(rows.length!==1)throw Error('NETCASH_REFUND_NOT_FOUND');
}
function retained(row:ConfigurationProfile,scope:RequestScope,facilityId:string){
 if(row.organisationId!==scope.organisationId||row.facilityId!==facilityId||row.domain!==NETCASH_REFUND_DOMAIN||row.name!==row.id)throw Error('NETCASH_REFUND_NOT_FOUND');
 const value=readRefundRecord(row.config,{id:row.id,organisationId:scope.organisationId,facilityId});
 if(value.state!==row.status)throw Error('NETCASH_REFUND_INTEGRITY_REVIEW');
 return value;
}
async function audit(tx:Tx,scope:RequestScope,value:NetcashRefundRecord,action:string){
 await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:value.source.facilityId,actorId:scope.userId,entityType:'ConfigurationProfile',entityId:value.id,action:'netcash.refund_'+action,after:{state:value.state,revision:value.revision,sourceHash:value.sourceHash,adjustmentId:value.source.adjustmentId,paymentId:value.source.paymentId,reference:action==='prepared'?value.preparationReference:action==='request-release'?value.releaseRequest!.reference:action==='approve-release'?value.releaseReview!.reference:action==='reserve'?value.reservation!.reference:value.review?.reference??null,providerAttempted:false,dispatchAvailable:false,financialPosting:false}}});
}
async function save(tx:Tx,scope:RequestScope,value:NetcashRefundRecord,action:string){
 const row=await tx.configurationProfile.update({where:{id:value.id},data:{status:value.state,config:sealRefundRecord(value)}});
 await audit(tx,scope,value,action);return projectRefundRecord(retained(row,scope,value.source.facilityId));
}
async function reviewedAuthority(tx:Tx,scope:RequestScope,value:NetcashRefundRecord){
 if(!value.review)throw Error('NETCASH_REFUND_INDEPENDENT_REVIEW');
 await authority(tx,{...scope,userId:value.review.actorId},value.source.facilityId,'payments.refund_review');
 const event=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:value.source.facilityId,entityType:'ConfigurationProfile',entityId:value.id,actorId:value.review.actorId,action:'netcash.refund_review'},orderBy:[{occurredAt:'desc'},{id:'desc'}]});
 const proof=event?.after as {sourceHash?:unknown;reference?:unknown}|null;
 if(proof?.sourceHash!==value.sourceHash||proof.reference!==value.review.reference)throw Error('NETCASH_REFUND_INDEPENDENT_REVIEW');
}
export async function previewNetcashRefund(scope:RequestScope,input:{facilityId:string;adjustmentId:string;lineId:string}){
 return db.$transaction(async tx=>{
  await authority(tx,scope,input.facilityId,'payments.refund_prepare');preparationEnabled();
  const source=await currentNetcashRefundSource(tx,scope,input);
  if(source.facilityId!==input.facilityId)throw Error('NETCASH_REFUND_NOT_FOUND');
  return{source,previewHash:cardSourceHash(source),providerAttempted:false as const,dispatchAvailable:false as const,financialPosting:false as const,manualPayoutHeld:false as const};
 },{isolationLevel:'RepeatableRead',timeout:20000});
}
export async function prepareNetcashRefund(scope:RequestScope,input:{facilityId:string;adjustmentId:string;lineId:string;previewHash:string;reference:string;confirmed:boolean}){
 if(input.confirmed!==true)throw Error('NETCASH_REFUND_CONFIRMATION_REQUIRED');
 return db.$transaction(async tx=>{
  await authority(tx,scope,input.facilityId,'payments.refund_prepare');preparationEnabled();
  const adjustment=await tx.financialAdjustment.findFirst({where:{id:input.adjustmentId,organisationId:scope.organisationId,facilityId:input.facilityId},select:{accountId:true}});
  if(!adjustment)throw Error('NETCASH_REFUND_NOT_FOUND');await lockAccount(tx,scope,input.facilityId,adjustment.accountId);
  const source=await currentNetcashRefundSource(tx,scope,input),sourceHash=cardSourceHash(source);
  if(source.facilityId!==input.facilityId||sourceHash!==input.previewHash)throw Error('NETCASH_REFUND_SOURCE_CHANGED');
  const id=refundRecordId(source),existing=await tx.configurationProfile.findUnique({where:{id}});
  if(existing){const value=retained(existing,scope,input.facilityId);if(value.preparedById!==scope.userId||value.sourceHash!==sourceHash||value.preparationReference!==input.reference.trim())throw Error('NETCASH_REFUND_ALREADY_RETAINED');return projectRefundRecord(value);}
  if(await tx.configurationProfile.count({where:{organisationId:scope.organisationId,domain:NETCASH_REFUND_DOMAIN}})>=1000)throw Error('NETCASH_REFUND_HOLD_COVERAGE_REVIEW');
  const value=refundRecordSchema.parse({version:1,id,source,sourceHash,state:'PREPARED',revision:1,createdAt:new Date().toISOString(),preparedById:scope.userId,preparationReference:input.reference,review:null,reservation:null,releaseRequest:null,releaseReview:null,providerAttempted:false,dispatchAvailable:false,dispatchContract:'UNAVAILABLE_V1',financialPosting:false});
  await tx.configurationProfile.create({data:{id,organisationId:scope.organisationId,facilityId:input.facilityId,domain:NETCASH_REFUND_DOMAIN,name:id,status:value.state,config:sealRefundRecord(value)}});await audit(tx,scope,value,'prepared');return projectRefundRecord(value);
 },transaction);
}
export async function actOnNetcashRefund(scope:RequestScope,input:{facilityId:string;id:string;revision:number;action:keyof typeof permissions;reference:string;confirmed:boolean}){
 if(input.confirmed!==true||!Object.hasOwn(permissions,input.action))throw Error('NETCASH_REFUND_CONFIRMATION_REQUIRED');
 return db.$transaction(async tx=>{
  await authority(tx,scope,input.facilityId,permissions[input.action]);
  const row=await tx.configurationProfile.findUnique({where:{id:input.id}});if(!row)throw Error('NETCASH_REFUND_NOT_FOUND');
  let value=retained(row,scope,input.facilityId);await lockAccount(tx,scope,input.facilityId,value.source.accountId);
  // Refresh after acquiring the same lock used by manual payout/cancellation.
  value=retained(await tx.configurationProfile.findUniqueOrThrow({where:{id:row.id}}),scope,input.facilityId);
  if(value.revision!==input.revision)throw Error('NETCASH_REFUND_SOURCE_CHANGED');
  if(['review','reserve'].includes(input.action)){
   preparationEnabled();const current=await currentNetcashRefundSource(tx,scope,{adjustmentId:value.source.adjustmentId,lineId:value.source.lineId});
   if(cardSourceHash(current)!==value.sourceHash)throw Error('NETCASH_REFUND_SOURCE_CHANGED');
  }
  if(input.action==='reserve'){
   if(process.env.NETCASH_REFUND_RESERVATION_ENABLED!=='true')throw Error('NETCASH_REFUND_RESERVATION_DISABLED');
   await reviewedAuthority(tx,scope,value);
  }
  if(input.action==='request-release'||input.action==='approve-release'){
   // This contract has no transport entry point. Never extend this to an
   // attempted/unknown provider outcome: a future dispatch requires a separate
   // durable attempt journal and an interlock/release policy revision.
   if(value.providerAttempted!==false||value.dispatchAvailable!==false||value.dispatchContract!=='UNAVAILABLE_V1')throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
   const reservation=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:input.facilityId,entityType:'ConfigurationProfile',entityId:value.id,action:'netcash.refund_reserve',actorId:value.reservation?.actorId},orderBy:[{occurredAt:'desc'},{id:'desc'}]});
   const reserved=reservation?.after as {sourceHash?:unknown;reference?:unknown;providerAttempted?:unknown;dispatchAvailable?:unknown;financialPosting?:unknown}|null;
   if(!value.reservation||reserved?.sourceHash!==value.sourceHash||reserved.reference!==value.reservation.reference||reserved.providerAttempted!==false||reserved.dispatchAvailable!==false||reserved.financialPosting!==false)throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
   if(input.action==='approve-release'){
    const event=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:input.facilityId,entityType:'ConfigurationProfile',entityId:value.id,action:'netcash.refund_request-release',actorId:value.releaseRequest?.actorId},orderBy:[{occurredAt:'desc'},{id:'desc'}]});
    const requested=event?.after as {sourceHash?:unknown;reference?:unknown;revision?:unknown}|null;
    if(!value.releaseRequest||requested?.sourceHash!==value.sourceHash||requested.reference!==value.releaseRequest.reference||requested.revision!==value.revision)throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
   }

   const adjustment=await tx.financialAdjustment.findFirst({where:{id:value.source.adjustmentId,organisationId:scope.organisationId,facilityId:input.facilityId,accountId:value.source.accountId,kind:'REFUND',status:'APPROVED',postedAt:null,ledgerEntryId:null,documentId:null,payoutReference:null,payoutDate:null}});
   if(!adjustment||await tx.auditEvent.count({where:{organisationId:scope.organisationId,entityType:'ConfigurationProfile',entityId:value.id,action:{startsWith:'netcash.refund_provider_'}}}))throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
  }
  return save(tx,scope,transitionRefundRecord(value,input.action,scope.userId,input.reference),input.action);
 },transaction);
}
export async function netcashRefundHistory(scope:RequestScope,facilityId:string,cursor?:string){
 return db.$transaction(async tx=>{
  await authority(tx,scope,facilityId,'adjustments.view');const where={organisationId:scope.organisationId,facilityId,domain:NETCASH_REFUND_DOMAIN};
  if(cursor&&!await tx.configurationProfile.findFirst({where:{...where,id:cursor},select:{id:true}}))throw Error('NETCASH_REFUND_NOT_FOUND');
  const rows=await tx.configurationProfile.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:21,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  return{rows:rows.slice(0,20).map(row=>projectRefundRecord(retained(row,scope,facilityId))),nextCursor:rows.length>20?rows[19].id:null};
 },{isolationLevel:'RepeatableRead',timeout:20000});
}
