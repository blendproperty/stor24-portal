import type {Prisma} from '@/generated/prisma/client';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {readDebiCheckRequest,DEBICHECK_REQUEST_DOMAIN} from './netcash-debicheck-request-policy';
import type {DebiCheckAuthenticationOutcome} from './netcash-debicheck-authentication';
import {DEBICHECK_ATTEMPT_DOMAIN,DEBICHECK_STATUS_OBSERVATION_DOMAIN,prepareDebiCheckAttempt,readDebiCheckAttempt,completeDebiCheckAttempt,projectDebiCheckAttempt,prepareDebiCheckStatusObservation,readDebiCheckStatusObservation,type DebiCheckAttemptSource} from './netcash-debicheck-attempt-policy';
import type {parseDebiCheckCurrentStatus} from './netcash-debicheck-soap';

type Client=Prisma.TransactionClient;
/** Internal persistence primitive, NOT dispatch authority. No route, scheduler or
 * provider transport calls it. A future worker must first validate fresh bank-
 * authentication consent (setup-v1 is insufficient), current independent staff
 * authority, exact TT1/RMS=false provider terms and approved test payer evidence,
 * plus current source/merchant. It must commit this claim BEFORE its one network
 * attempt. A claimed/crashed/unknown attempt is never permission to send again.
 * Caller owns a Serializable transaction; no transaction/network retry here. */
export async function retainDebiCheckAttemptClaim(client:Client,source:DebiCheckAttemptSource,now=new Date()){
 const prepared=prepareDebiCheckAttempt(source,now),identity={id:prepared.recordId,organisationId:source.organisationId,facilityId:source.facilityId,accountId:source.accountId};
 const accounts=await client.$queryRaw<{id:string}[]>`SELECT a."id" FROM "Account" a JOIN "Customer" c ON c."id"=a."customerId" JOIN "Tenancy" t ON t."accountId"=a."id" WHERE a."id"=${source.accountId} AND c."organisationId"=${source.organisationId} AND t."facilityId"=${source.facilityId} FOR UPDATE OF a`;
 if(accounts.length!==1)throw Error('DEBICHECK_ATTEMPT_ACCOUNT_REVIEW');
 const existing=await client.configurationProfile.findUnique({where:{id:prepared.recordId}});
 if(existing){
  if(existing.domain!==DEBICHECK_ATTEMPT_DOMAIN||existing.name!==source.requestId||existing.organisationId!==source.organisationId||existing.facilityId!==source.facilityId)throw Error('DEBICHECK_ATTEMPT_INTEGRITY_REVIEW');
  const retained=readDebiCheckAttempt(existing.config,identity);
  if(existing.status!==projectDebiCheckAttempt(retained).status)throw Error('DEBICHECK_ATTEMPT_STATE_REVIEW');
  if(cardSourceHash(retained.source)!==cardSourceHash(prepared.source))throw Error('DEBICHECK_ATTEMPT_SOURCE_CHANGED');
  return{newClaim:false,attempt:projectDebiCheckAttempt(retained)};
 }
 const request=await client.configurationProfile.findFirst({where:{id:source.requestId,organisationId:source.organisationId,facilityId:source.facilityId,domain:DEBICHECK_REQUEST_DOMAIN,status:'REVIEWED'}});
 if(!request)throw Error('DEBICHECK_REVIEWED_REQUEST_REQUIRED');
 const definition=readDebiCheckRequest(request.config,{...identity,id:source.requestId});
 if(definition.signature!==source.requestSignature||definition.sourceHash!==source.sourceHash||definition.merchantHash!==source.merchantHash||definition.templateSourceHash!==source.templateSourceHash||definition.connectionId!==source.connectionId||definition.connectionUpdatedAt!==source.connectionUpdatedAt)throw Error('DEBICHECK_ATTEMPT_SOURCE_CHANGED');
 // A future bank-authentication consent flow must retain its own evidence.
 // An ordinary setup-request consent or staff setup review cannot satisfy this.
 const consent=await client.auditEvent.findFirst({where:{organisationId:source.organisationId,facilityId:source.facilityId,entityType:'ConfigurationProfile',entityId:source.requestId,action:'netcash.debicheck_bank_authentication_consented',actorId:null},orderBy:{occurredAt:'desc'}});
 const consentValue=consent?.after as Record<string,unknown>|null;
 if(!consentValue||consentValue.consentVersion!=='debicheck-bank-authentication-v1'||consentValue.customerId!==definition.customerId||consentValue.requestSignature!==source.requestSignature||consentValue.sourceHash!==source.sourceHash||consentValue.merchantHash!==source.merchantHash||consentValue.consentHash!==source.authenticationConsentHash)throw Error('DEBICHECK_BANK_AUTHENTICATION_CONSENT_REQUIRED');
 const review=await client.auditEvent.findFirst({where:{id:source.independentReviewAuditId,organisationId:source.organisationId,facilityId:source.facilityId,entityType:'ConfigurationProfile',entityId:source.requestId,action:'netcash.debicheck_bank_authentication_reviewed',actorId:{not:null}}});
 const reviewValue=review?.after as Record<string,unknown>|null;
 if(!reviewValue||reviewValue.requestSignature!==source.requestSignature||reviewValue.authenticationConsentHash!==source.authenticationConsentHash||reviewValue.sourceHash!==source.sourceHash||reviewValue.merchantHash!==source.merchantHash)throw Error('DEBICHECK_BANK_AUTHENTICATION_REVIEW_REQUIRED');
 const reviewer=await client.user.findFirst({where:{id:review!.actorId!,organisationId:source.organisationId,active:true},select:{email:true}}),customer=await client.customer.findFirst({where:{id:definition.customerId,organisationId:source.organisationId},select:{email:true}});
 if(!reviewer||!customer?.email||reviewer.email.toLowerCase()===customer.email.toLowerCase()||consent!.occurredAt>review!.occurredAt||review!.occurredAt>now)throw Error('DEBICHECK_BANK_AUTHENTICATION_REVIEW_REQUIRED');
 await client.configurationProfile.create({data:{id:prepared.recordId,organisationId:source.organisationId,facilityId:source.facilityId,domain:DEBICHECK_ATTEMPT_DOMAIN,name:source.requestId,status:'CLAIMED',config:prepared}});
 await client.auditEvent.create({data:{organisationId:source.organisationId,facilityId:source.facilityId,action:'netcash.debicheck_authentication_claim_retained',entityType:'ConfigurationProfile',entityId:prepared.recordId,after:{requestId:source.requestId,sourceHash:source.sourceHash,authenticationConsentHash:source.authenticationConsentHash,claimedAt:prepared.claimedAt,collectionAuthorised:false,financialReceipt:false,retryAllowed:false}}});
 return{newClaim:true,attempt:projectDebiCheckAttempt(prepared)};
}

/** Persist only the original single dispatch's outcome. Losing this transaction
 * leaves CLAIMED, never a runnable job. Conflicting second results are held. */
export async function retainDebiCheckAttemptResult(client:Client,identity:{id:string;organisationId:string;facilityId:string;accountId:string},outcome:DebiCheckAuthenticationOutcome,now=new Date()){
 await client.$queryRaw`SELECT "id" FROM "ConfigurationProfile" WHERE "id"=${identity.id} FOR UPDATE`;
 const row=await client.configurationProfile.findUnique({where:{id:identity.id}});
 if(!row||row.domain!==DEBICHECK_ATTEMPT_DOMAIN||row.organisationId!==identity.organisationId||row.facilityId!==identity.facilityId)throw Error('DEBICHECK_ATTEMPT_NOT_FOUND');
 const retained=readDebiCheckAttempt(row.config,identity);
 if(row.status!==projectDebiCheckAttempt(retained).status)throw Error('DEBICHECK_ATTEMPT_STATE_REVIEW');
 const completed=completeDebiCheckAttempt(retained,outcome,now);
 if(completed===retained)return projectDebiCheckAttempt(retained);
 if(row.status!=='CLAIMED')throw Error('DEBICHECK_ATTEMPT_STATE_REVIEW');
 await client.configurationProfile.update({where:{id:identity.id},data:{config:completed,status:outcome.outcome}});
 await client.auditEvent.create({data:{organisationId:identity.organisationId,facilityId:identity.facilityId,action:'netcash.debicheck_authentication_result_retained',entityType:'ConfigurationProfile',entityId:identity.id,after:{requestId:retained.source.requestId,outcome:outcome.outcome,completedAt:completed.completedAt,originalContractAvailable:!!outcome.contractReference,collectionAuthorised:false,financialReceipt:false,retryAllowed:false}}});
 return projectDebiCheckAttempt(completed);
}

/** Journal a read obtained using the original retained contract and merchant.
 * No provider lookup occurs here. The future scoped reconciliation worker owns
 * credential/current-authority checks before lookup; it cannot enter a new NC
 * reference to resolve an attempt that never returned one. */
export async function retainDebiCheckStatusObservation(client:Client,identity:{id:string;organisationId:string;facilityId:string;accountId:string},merchantHash:string,value:ReturnType<typeof parseDebiCheckCurrentStatus>,now=new Date()){
 await client.$queryRaw`SELECT "id" FROM "ConfigurationProfile" WHERE "id"=${identity.id} FOR UPDATE`;
 const row=await client.configurationProfile.findUnique({where:{id:identity.id}});
 if(!row||row.domain!==DEBICHECK_ATTEMPT_DOMAIN||row.organisationId!==identity.organisationId||row.facilityId!==identity.facilityId)throw Error('DEBICHECK_ATTEMPT_NOT_FOUND');
 const attempt=readDebiCheckAttempt(row.config,identity);
 if(row.status!==projectDebiCheckAttempt(attempt).status)throw Error('DEBICHECK_ATTEMPT_STATE_REVIEW');
 const {record,projection}=prepareDebiCheckStatusObservation(attempt,merchantHash,value,now);
 const existing=await client.configurationProfile.findUnique({where:{id:record.recordId}});
 if(existing){if(existing.domain!==DEBICHECK_STATUS_OBSERVATION_DOMAIN||existing.organisationId!==identity.organisationId||existing.facilityId!==identity.facilityId||existing.name!==record.recordId||existing.status!=='OBSERVED')throw Error('DEBICHECK_ATTEMPT_INTEGRITY_REVIEW');readDebiCheckStatusObservation(existing.config,attempt,merchantHash);return{retained:false,id:existing.id};}
 await client.configurationProfile.create({data:{id:record.recordId,organisationId:identity.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_STATUS_OBSERVATION_DOMAIN,name:record.recordId,status:'OBSERVED',config:record}});
 await client.auditEvent.create({data:{organisationId:identity.organisationId,facilityId:identity.facilityId,action:'netcash.debicheck_authentication_status_retained',entityType:'ConfigurationProfile',entityId:identity.id,after:{requestId:attempt.source.requestId,observationId:record.recordId,observationHash:record.observationHash,bankAuthenticationObserved:projection.bankAuthenticationObserved,collectionAuthorised:false,financialReceipt:false,retryAllowed:false}}});
 return{retained:true,...projection};
}
