import type {Prisma} from '@/generated/prisma/client';
import type {RequestScope} from '@/lib/scope';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {NETCASH_REFUND_ATTEMPT_DOMAIN,NETCASH_REFUND_PRECLAIM_ARCHIVE_DOMAIN,refundAttemptId,readRefundAttempt,sealRefundAttempt,refundAttemptSchema,closeUnclaimedRefundAttempt,renewUnclaimedRefundAttempt,type RefundAttempt} from './netcash-refund-attempt-policy';

type Tx=Prisma.TransactionClient;
export async function validateRefundPreclaimArchives(tx:Tx,value:RefundAttempt){
 const rows=await tx.configurationProfile.findMany({where:{organisationId:value.source.organisationId,domain:NETCASH_REFUND_PRECLAIM_ARCHIVE_DOMAIN,name:{startsWith:value.id+':preclaim:'}},take:11});
 if(rows.length!==value.history.length)throw Error('NETCASH_REFUND_PRECLAIM_HISTORY_REVIEW');
 for(const[index,item]of value.history.entries()){
  const row=rows.find(row=>row.id===item.archiveId);
  if(!row||row.name!==item.archiveId||row.facilityId!==value.source.facilityId||row.status!==item.state)throw Error('NETCASH_REFUND_PRECLAIM_HISTORY_REVIEW');
  const archived=readRefundAttempt(row.config,{id:value.id,organisationId:value.source.organisationId,facilityId:value.source.facilityId});
  if(archived.claim||archived.state!==item.state||archived.cycle!==item.cycle||archived.sourceHash!==value.sourceHash||archived.credentialFingerprint!==value.credentialFingerprint||archived.reservationRevision!==value.reservationRevision||cardSourceHash(archived)!==item.hash||cardSourceHash(archived.history)!==cardSourceHash(value.history.slice(0,index))||cardSourceHash({created:archived.created,review:archived.review,closed:archived.closed})!==cardSourceHash({created:item.created,review:item.review,closed:item.closed}))throw Error('NETCASH_REFUND_PRECLAIM_HISTORY_REVIEW');
 }
}
export async function loadRefundAttempt(tx:Tx,scope:RequestScope,facilityId:string,refundId:string){
 const id=refundAttemptId(refundId),row=await tx.configurationProfile.findUnique({where:{id}});
 if(!row)return null;
 if(row.organisationId!==scope.organisationId||row.facilityId!==facilityId||row.domain!==NETCASH_REFUND_ATTEMPT_DOMAIN||row.name!==id)throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');
 const value=readRefundAttempt(row.config,{id,organisationId:scope.organisationId,facilityId});
 if(row.status!==value.state||value.refundId!==refundId)throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');
 await validateRefundPreclaimArchives(tx,value);
 return value;
}
/** MUST be called in the same native Serializable transaction as current
 * authority/source/approval validation. Never wraps transport or retries.
 * Own account lock matches manual refund payout/cancellation and V1 reserve.
 * Claim and provider-prefix audit either commit together or both roll back. */
export async function persistRefundAttempt(tx:Tx,scope:RequestScope,previous:RefundAttempt|null,raw:RefundAttempt){
 const value=refundAttemptSchema.parse(raw),source=value.source;
 if(source.organisationId!==scope.organisationId||!scope.unrestrictedFacilities&&!scope.facilityIds.includes(source.facilityId))throw Error('FORBIDDEN');
 const locked=await tx.$queryRaw<{id:string}[]>`SELECT a."id" FROM "Account" a JOIN "Customer" c ON c."id"=a."customerId" JOIN "Tenancy" t ON t."accountId"=a."id" WHERE a."id"=${source.accountId} AND c."organisationId"=${scope.organisationId} AND t."facilityId"=${source.facilityId} FOR UPDATE OF a`;
 if(locked.length!==1)throw Error('NETCASH_REFUND_NOT_FOUND');
 const current=await loadRefundAttempt(tx,scope,source.facilityId,value.refundId);
 if((!previous)!==(!current)||previous&&cardSourceHash(previous)!==cardSourceHash(current))throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
 if(!previous){
  if(value.state!=='PREPARED'||value.revision!==1||value.cycle!==1||value.history.length!==0||value.created.actorId!==scope.userId)throw Error('NETCASH_REFUND_ATTEMPT_STATE');
 }else{
  if(value.revision!==previous.revision+1)throw Error('NETCASH_REFUND_ATTEMPT_STATE');
  for(const key of ['id','refundId','sourceHash','reservationRevision','credentialFingerprint']as const)if(previous[key]!==value[key])throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
  const renewing=value.state==='PREPARED'&&['REJECTED','WITHDRAWN'].includes(previous.state),closing=['REJECTED','WITHDRAWN'].includes(value.state);
  if(renewing||closing){
   if(previous.claim||await tx.auditEvent.count({where:{organisationId:scope.organisationId,entityType:'ConfigurationProfile',entityId:value.refundId,action:{startsWith:'netcash.refund_provider_'}}}))throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
   const expected=renewing?renewUnclaimedRefundAttempt(previous,value.approvalHash,scope.userId,value.created.reference,new Date(value.created.at)):closeUnclaimedRefundAttempt(previous,value.state==='WITHDRAWN'?'withdraw-send':'reject-send',scope.userId,value.closed!.reference,new Date(value.closed!.at));
   if(cardSourceHash(expected)!==cardSourceHash(value))throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
   if(renewing){
    if(await tx.configurationProfile.count({where:{organisationId:scope.organisationId,domain:NETCASH_REFUND_PRECLAIM_ARCHIVE_DOMAIN}})>=1000)throw Error('NETCASH_REFUND_PRECLAIM_HISTORY_REVIEW');
    const item=value.history.at(-1)!;
    await tx.configurationProfile.create({data:{id:item.archiveId,organisationId:scope.organisationId,facilityId:source.facilityId,domain:NETCASH_REFUND_PRECLAIM_ARCHIVE_DOMAIN,name:item.archiveId,status:previous.state,config:sealRefundAttempt(previous)}});
   }
  }else{
   const next={PREPARED:'REVIEWED',REVIEWED:'CLAIMED',REJECTED:null,WITHDRAWN:null,CLAIMED:'RESULT_RETAINED',RESULT_RETAINED:null}as const;
   if(next[previous.state]!==value.state||previous.approvalHash!==value.approvalHash||previous.cycle!==value.cycle||cardSourceHash(previous.history)!==cardSourceHash(value.history))throw Error('NETCASH_REFUND_ATTEMPT_STATE');
   if(cardSourceHash(previous.created)!==cardSourceHash(value.created))throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
   if(previous.review&&cardSourceHash(previous.review)!==cardSourceHash(value.review))throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
   if(previous.claim&&cardSourceHash(previous.claim)!==cardSourceHash(value.claim))throw Error('NETCASH_REFUND_ATTEMPT_CHANGED');
   if(value.state==='REVIEWED'&&value.review?.actorId!==scope.userId||value.state==='CLAIMED'&&value.claim?.actorId!==scope.userId)throw Error('FORBIDDEN');
  }
 }
 // An orphan provider audit is never permission to reclaim the original.
 if(value.state==='CLAIMED'&&await tx.auditEvent.count({where:{organisationId:scope.organisationId,entityType:'ConfigurationProfile',entityId:value.refundId,action:{startsWith:'netcash.refund_provider_'}}}))throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
 const data={status:value.state,config:sealRefundAttempt(value)};
 if(previous)await tx.configurationProfile.update({where:{id:value.id},data});
 else await tx.configurationProfile.create({data:{id:value.id,organisationId:scope.organisationId,facilityId:source.facilityId,domain:NETCASH_REFUND_ATTEMPT_DOMAIN,name:value.id,...data}});
 const claimed=value.state==='CLAIMED',result=value.state==='RESULT_RETAINED';
 const action=claimed?'netcash.refund_provider_claimed':result?'netcash.refund_provider_result_retained':value.state==='REVIEWED'?'netcash.refund_send_reviewed':value.state==='WITHDRAWN'?'netcash.refund_send_withdrawn':value.state==='REJECTED'?'netcash.refund_send_rejected':value.cycle>1?'netcash.refund_send_renewed':'netcash.refund_send_prepared';
 await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:source.facilityId,actorId:scope.userId,entityType:'ConfigurationProfile',entityId:claimed||result?value.refundId:value.id,action,after:{attemptId:value.id,refundId:value.refundId,revision:value.revision,cycle:value.cycle,state:value.state,sourceHash:value.sourceHash,approvalHash:value.approvalHash,reference:value.claim?.reference??value.closed?.reference??(value.state==='REVIEWED'?value.review!.reference:value.created.reference),claimRetained:!!value.claim,providerOutcome:value.result?.outcome??null,financialPosting:false,retryAvailable:false}}});
 return value;
}
/** Read-only current truth for V1 overlays and release/interlock guards. An
 * audit without a matching claimed journal is an integrity hold, never zero
 * attempts. Private original response bytes are deliberately not projected. */
export async function refundProviderClaimTruth(tx:Tx,scope:RequestScope,facilityId:string,refundId:string){
 const attempt=await loadRefundAttempt(tx,scope,facilityId,refundId);
 const events=await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,entityType:'ConfigurationProfile',entityId:refundId,action:{startsWith:'netcash.refund_provider_'}},take:4});
 if(events.length>2||(events.length>0)!==!!attempt?.claim)throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');
 if(attempt?.claim){
  const expected=attempt.result?['netcash.refund_provider_claimed','netcash.refund_provider_result_retained']:['netcash.refund_provider_claimed'];
  if(events.length!==expected.length||expected.some(action=>events.filter(event=>event.action===action).length!==1))throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');
  for(const event of events){const after=event.after as {attemptId?:unknown;refundId?:unknown;sourceHash?:unknown;approvalHash?:unknown;claimRetained?:unknown;reference?:unknown;cycle?:unknown;revision?:unknown;state?:unknown;providerOutcome?:unknown;financialPosting?:unknown;retryAvailable?:unknown}|null;
   if(event.facilityId!==facilityId||event.actorId!==attempt.claim.actorId||after?.attemptId!==attempt.id||after.refundId!==refundId||after.sourceHash!==attempt.sourceHash||after.approvalHash!==attempt.approvalHash||after.claimRetained!==true||after.reference!==attempt.claim.reference||after.cycle!==attempt.cycle||after.financialPosting!==false||after.retryAvailable!==false||after.state!==(event.action==='netcash.refund_provider_claimed'?'CLAIMED':'RESULT_RETAINED')||after.revision!==(event.action==='netcash.refund_provider_claimed'&&attempt.result?attempt.revision-1:attempt.revision)||after.providerOutcome!==(event.action==='netcash.refund_provider_claimed'?null:attempt.result?.outcome))throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');}
 }
 return{attempt,claimRetained:!!attempt?.claim};
}
