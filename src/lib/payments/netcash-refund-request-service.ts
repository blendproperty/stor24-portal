import {randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {db} from '@/lib/db';
import type {RequestScope} from '@/lib/scope';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {decryptNetcashConfig} from './netcash-client';
import {currentNetcashRefundSource} from './netcash-refund-source';
import {refundAuthority,lockRefundAccount,retainedRefund,refundReviewedAuthority} from './netcash-refund-service';
import {loadRefundAttempt,persistRefundAttempt,refundProviderClaimTruth} from './netcash-refund-attempt-journal';
import {NETCASH_REFUND_ATTEMPT_DOMAIN,refundAttemptId,refundAttemptSchema,projectRefundAttempt,type RefundAttempt} from './netcash-refund-attempt-policy';
import {requireRefundSendApproval,refundCredentialFingerprint} from './netcash-refund-send-policy';
import {assertRefundTransportInput,transportRefundRequest,type RefundResponseCapture} from './netcash-refund-transport';

type Tx=Prisma.TransactionClient;
type Selection={facilityId:string;refundId:string;reservationRevision:number};
type Action=Selection&{attemptRevision:number;reference:string;confirmed:boolean};
const transaction={isolationLevel:'Serializable' as const,timeout:20000};
function enabled(){if(process.env.NETCASH_REFUND_REQUEST_ENABLED!=='true')throw Error('NETCASH_REFUND_REQUEST_DISABLED');}
async function context(tx:Tx,scope:RequestScope,input:Selection,permission:string,now:Date){
 await refundAuthority(tx,scope,input.facilityId,permission);enabled();
 let row=await tx.configurationProfile.findUnique({where:{id:input.refundId}});if(!row)throw Error('NETCASH_REFUND_NOT_FOUND');
 let refund=retainedRefund(row,scope,input.facilityId);await lockRefundAccount(tx,scope,input.facilityId,refund.source.accountId);
 row=await tx.configurationProfile.findUniqueOrThrow({where:{id:input.refundId}});refund=retainedRefund(row,scope,input.facilityId);
 if(refund.state!=='RESERVED'||refund.revision!==input.reservationRevision)throw Error('NETCASH_REFUND_SEND_RESERVATION_CHANGED');
 await refundReviewedAuthority(tx,scope,refund);
 const reservation=await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,facilityId:input.facilityId,entityType:'ConfigurationProfile',entityId:refund.id,action:'netcash.refund_reserve',actorId:refund.reservation?.actorId},take:2});
 const reserved=reservation[0]?.after as {sourceHash?:unknown;reference?:unknown;providerAttempted?:unknown;financialPosting?:unknown}|null;
 if(reservation.length!==1||reserved?.sourceHash!==refund.sourceHash||reserved.reference!==refund.reservation?.reference||reserved.providerAttempted!==false||reserved.financialPosting!==false)throw Error('NETCASH_REFUND_SEND_RESERVATION_CHANGED');
 const source=await currentNetcashRefundSource(tx,scope,{adjustmentId:refund.source.adjustmentId,lineId:refund.source.lineId});
 if(cardSourceHash(source)!==refund.sourceHash)throw Error('NETCASH_REFUND_SOURCE_CHANGED');
 const connection=await tx.integrationConnection.findUnique({where:{id:source.connectionId}});
 if(!connection||connection.organisationId!==scope.organisationId||connection.updatedAt.toISOString()!==source.connectionUpdatedAt)throw Error('NETCASH_REFUND_MERCHANT_REVIEW');
 const config=decryptNetcashConfig(connection.config);
 if(config.environment!=='live'||config.transactionProcessingEnabled!==true||!config.payNowServiceKey)throw Error('NETCASH_REFUND_SEND_CONFIGURATION_REQUIRED');
 const credentialFingerprint=refundCredentialFingerprint(scope.organisationId,connection.id,config.payNowServiceKey);
 const permissionProof=requireRefundSendApproval(source,credentialFingerprint,now);
 const wireInput={transactionId:source.transactionId,amount:source.refundAmount,wireFormat:permissionProof.approval.wireFormat};
 assertRefundTransportInput(config.payNowServiceKey,wireInput);
 return{refund,source,credentialFingerprint,...permissionProof,serviceKey:config.payNowServiceKey,wireInput};
}
function sameSource(value:RefundAttempt,current:Awaited<ReturnType<typeof context>>){
 if(value.sourceHash!==current.refund.sourceHash||value.reservationRevision!==current.refund.revision||value.approvalHash!==current.approvalHash||value.credentialFingerprint!==current.credentialFingerprint)throw Error('NETCASH_REFUND_SEND_SOURCE_CHANGED');
}
async function purposeAudit(tx:Tx,scope:RequestScope,value:RefundAttempt,action:'prepared'|'reviewed'){
 const evidence=action==='reviewed'?value.review:value.created;if(!evidence)throw Error('NETCASH_REFUND_SEND_REVIEW_REQUIRED');
 const rows=await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,facilityId:value.source.facilityId,entityType:'ConfigurationProfile',entityId:value.id,actorId:evidence.actorId,action:'netcash.refund_send_'+action},take:2});
 const proof=rows[0]?.after as {attemptId?:unknown;refundId?:unknown;sourceHash?:unknown;approvalHash?:unknown;reference?:unknown}|null;
 if(rows.length!==1||proof?.attemptId!==value.id||proof.refundId!==value.refundId||proof.sourceHash!==value.sourceHash||proof.approvalHash!==value.approvalHash||proof.reference!==evidence.reference)throw Error('NETCASH_REFUND_SEND_REVIEW_REQUIRED');
}
async function currentSendReview(tx:Tx,scope:RequestScope,value:RefundAttempt){
 if(!value.review||value.review.actorId===value.created.actorId)throw Error('NETCASH_REFUND_SEND_REVIEW_REQUIRED');
 await refundAuthority(tx,{...scope,userId:value.created.actorId},value.source.facilityId,'payments.refund_send');
 await refundAuthority(tx,{...scope,userId:value.review.actorId},value.source.facilityId,'payments.refund_send_review');
 await purposeAudit(tx,scope,value,'prepared');await purposeAudit(tx,scope,value,'reviewed');
}
export async function prepareRefundSend(scope:RequestScope,input:Selection&{reference:string;confirmed:boolean},clock=()=>new Date()){
 if(input.confirmed!==true)throw Error('NETCASH_REFUND_CONFIRMATION_REQUIRED');
 return db.$transaction(async tx=>{
  const now=clock(),current=await context(tx,scope,input,'payments.refund_send',now);
  const truth=await refundProviderClaimTruth(tx,scope,input.facilityId,input.refundId);
  if(truth.claimRetained)throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
  if(truth.attempt){sameSource(truth.attempt,current);if(truth.attempt.created.actorId!==scope.userId||truth.attempt.created.reference!==input.reference.trim())throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');return projectRefundAttempt(truth.attempt);}
  if(await tx.configurationProfile.count({where:{organisationId:scope.organisationId,domain:NETCASH_REFUND_ATTEMPT_DOMAIN}})>=1000)throw Error('NETCASH_REFUND_HOLD_COVERAGE_REVIEW');
  const value=refundAttemptSchema.parse({version:1,id:refundAttemptId(input.refundId),refundId:input.refundId,source:current.source,sourceHash:current.refund.sourceHash,reservationRevision:input.reservationRevision,state:'PREPARED',revision:1,created:{actorId:scope.userId,at:now.toISOString(),reference:input.reference},review:null,approvalHash:current.approvalHash,credentialFingerprint:current.credentialFingerprint,claim:null,result:null,resultAt:null,financialPosting:false,retryAvailable:false});
  return projectRefundAttempt(await persistRefundAttempt(tx,scope,null,value));
 },transaction);
}
export async function reviewRefundSend(scope:RequestScope,input:Action,clock=()=>new Date()){
 if(input.confirmed!==true)throw Error('NETCASH_REFUND_CONFIRMATION_REQUIRED');
 return db.$transaction(async tx=>{
  const now=clock(),current=await context(tx,scope,input,'payments.refund_send_review',now),value=await loadRefundAttempt(tx,scope,input.facilityId,input.refundId);
  if(!value||value.state!=='PREPARED'||value.revision!==input.attemptRevision||value.created.actorId===scope.userId)throw Error('NETCASH_REFUND_SEND_REVIEW_REQUIRED');
  sameSource(value,current);await purposeAudit(tx,scope,value,'prepared');await refundAuthority(tx,{...scope,userId:value.created.actorId},input.facilityId,'payments.refund_send');
  return projectRefundAttempt(await persistRefundAttempt(tx,scope,value,refundAttemptSchema.parse({...value,state:'REVIEWED',revision:value.revision+1,review:{actorId:scope.userId,at:now.toISOString(),reference:input.reference}})));
 },transaction);
}
export async function sendRefundRequest(scope:RequestScope,input:Action,request:typeof fetch=fetch,clock=()=>new Date()){
 if(input.confirmed!==true)throw Error('NETCASH_REFUND_CONFIRMATION_REQUIRED');
 // There is deliberately no retry wrapper around any transaction or fetch.
 const claim=await db.$transaction(async tx=>{
  const now=clock(),current=await context(tx,scope,input,'payments.refund_send',now),value=await loadRefundAttempt(tx,scope,input.facilityId,input.refundId);
  if(!value||value.state!=='REVIEWED'||value.revision!==input.attemptRevision||value.created.actorId!==scope.userId)throw Error('NETCASH_REFUND_SEND_REVIEW_REQUIRED');
  sameSource(value,current);await currentSendReview(tx,scope,value);
  return persistRefundAttempt(tx,scope,value,refundAttemptSchema.parse({...value,state:'CLAIMED',revision:value.revision+1,claim:{actorId:scope.userId,at:now.toISOString(),token:randomUUID()}}));
 },transaction);
 // A crash or revoked/changed source here retains the committed claim forever.
 // Re-read current source, actor, reviewer, credential and purpose audit before
 // one physical transport. No provider action occurs inside a DB transaction.
 let fresh:Awaited<ReturnType<typeof context>>;
 try{
  fresh=await db.$transaction(async tx=>{
   const current=await context(tx,scope,input,'payments.refund_send',clock()),truth=await refundProviderClaimTruth(tx,scope,input.facilityId,input.refundId);
   if(!truth.attempt||truth.attempt.state!=='CLAIMED'||truth.attempt.claim?.token!==claim.claim!.token)throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
   sameSource(truth.attempt,current);await currentSendReview(tx,scope,truth.attempt);return current;
  },transaction);
  const guardTime=clock();enabled();if(requireRefundSendApproval(fresh.source,fresh.credentialFingerprint,guardTime).approvalHash!==claim.approvalHash)throw Error('NETCASH_REFUND_SEND_SOURCE_CHANGED');
 }catch{return{...projectRefundAttempt(claim),resultRetained:false,lastGuardPassed:false};}
 let result:RefundResponseCapture;
 try{result=await transportRefundRequest(fresh.serviceKey,fresh.wireInput,request);}catch{result={httpStatus:null,bodyBase64:'',complete:false,capturedBytes:0,outcome:'UNKNOWN',providerCode:null,financialPosting:false,retryAvailable:false};}
 try{
  // Bookkeeping of this already-claimed outcome must survive later revocation
  // or source changes. It authorizes no new fetch, financial posting or retry.
  const saved=await db.$transaction(async tx=>{
   const current=await loadRefundAttempt(tx,scope,input.facilityId,input.refundId);
   if(!current||current.state!=='CLAIMED'||current.claim?.token!==claim.claim!.token)throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
   return persistRefundAttempt(tx,scope,current,refundAttemptSchema.parse({...current,state:'RESULT_RETAINED',revision:current.revision+1,result,resultAt:clock().toISOString()}));
  },transaction);
  return{...projectRefundAttempt(saved),resultRetained:true,lastGuardPassed:true};
 }catch{return{...projectRefundAttempt(claim),resultRetained:false,lastGuardPassed:true};}
}
export async function refundSendHistory(scope:RequestScope,facilityId:string,refundId:string){
 return db.$transaction(async tx=>{await refundAuthority(tx,scope,facilityId,'adjustments.view');const row=await tx.configurationProfile.findUnique({where:{id:refundId}});if(!row)throw Error('NETCASH_REFUND_NOT_FOUND');retainedRefund(row,scope,facilityId);const truth=await refundProviderClaimTruth(tx,scope,facilityId,refundId);return{attempt:truth.attempt?projectRefundAttempt(truth.attempt):null,claimRetained:truth.claimRetained,financialPosting:false as const};},{isolationLevel:'RepeatableRead',timeout:20000});
}
