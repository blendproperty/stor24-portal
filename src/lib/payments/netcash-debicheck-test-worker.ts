import {db} from '@/lib/db';
import type {Prisma} from '@/generated/prisma/client';
import type {RequestScope} from '@/lib/scope';
import {currentRoleAccess} from '@/lib/current-role-access';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {DEBICHECK_BANK_CONSENT_DOMAIN,bankAuthenticationConsentHash} from './netcash-debicheck-bank-consent-policy';
import {readStoredBankConsent} from './netcash-debicheck-bank-consent-record';
import {currentBankConsentSource} from './netcash-debicheck-bank-consent-source';
import {requireNativeBankConsent} from './netcash-debicheck-bank-authority';
import {DEBICHECK_REQUEST_DOMAIN,readDebiCheckRequest,privateDebiCheckTerms} from './netcash-debicheck-request-policy';
import {DEBICHECK_ATTEMPT_DOMAIN,readDebiCheckAttempt,projectDebiCheckAttempt,debiCheckAttemptInitialResult,type DebiCheckAttemptSource} from './netcash-debicheck-attempt-policy';
import {retainDebiCheckAttemptClaim,retainDebiCheckAttemptResult,retainDebiCheckStatusObservation} from './netcash-debicheck-attempt-journal';
import {submitDebiCheckAuthenticationOnce} from './netcash-debicheck-authentication';
import {getNetcashConnection} from './netcash-client';
import {buildDebiCheckAuthenticationEnvelope,readDebiCheckCurrentStatus} from './netcash-debicheck-soap';
import {merchantIdentity} from './netcash-statement';

type Tx=Prisma.TransactionClient;
const options={isolationLevel:'Serializable' as const,timeout:20000};
function actionResult(claim:{newClaim:boolean;attempt:ReturnType<typeof projectDebiCheckAttempt>},providerActionAttempted:boolean,originalResultRetained:boolean,localGuardHeld=false,attempt:ReturnType<typeof projectDebiCheckAttempt>|null=claim.attempt){
 return{newClaim:claim.newClaim,attemptId:claim.attempt.id,attempt,providerActionAttempted,originalResultRetained,localGuardHeld,historyRequired:!originalResultRetained||attempt?.reconciliationRequired!==false,retryAllowed:false as const,collectionAuthorised:false as const,financialReceipt:false as const};
}

const flags=()=>{if(process.env.NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED!=='true')throw Error('DEBICHECK_TEST_SUBMISSION_DISABLED')};
async function actor(tx:Tx,scope:RequestScope,facilityId:string,permission:string){
 if(!scope.unrestrictedFacilities&&!scope.facilityIds.includes(facilityId))throw Error('FORBIDDEN');
 const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{where:{role:{organisationId:scope.organisationId}},include:{role:true}}}});
 if(!user||!currentRoleAccess(user.roleAssignments,'payments.view',facilityId).allowed||!currentRoleAccess(user.roleAssignments,permission,facilityId).allowed||!await tx.facility.findFirst({where:{id:facilityId,organisationId:scope.organisationId},select:{id:true}}))throw Error('FORBIDDEN');
 return user;
}
async function lockAccount(tx:Tx,scope:RequestScope,input:{facilityId:string;accountId:string}){
 await actor(tx,scope,input.facilityId,'payments.bank_auth_submit');
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT a."id" FROM "Account" a JOIN "Customer" c ON c."id"=a."customerId" JOIN "Tenancy" t ON t."accountId"=a."id" WHERE a."id"=${input.accountId} AND c."organisationId"=${scope.organisationId} AND t."facilityId"=${input.facilityId} FOR UPDATE OF a`;
 if(rows.length!==1)throw Error('DEBICHECK_ATTEMPT_ACCOUNT_REVIEW');
}
async function preparation(tx:Tx,scope:RequestScope,input:{facilityId:string;accountId:string;consentId:string}){
 const row=await tx.configurationProfile.findFirst({where:{id:input.consentId,organisationId:scope.organisationId,domain:DEBICHECK_BANK_CONSENT_DOMAIN}});
 if(!row?.facilityId||row.facilityId!==input.facilityId||row.name!==row.id)throw Error('DEBICHECK_BANK_AUTHENTICATION_CONSENT_REQUIRED');
 await actor(tx,scope,row.facilityId,'payments.bank_auth_submit');
 const account=await tx.account.findFirst({where:{id:input.accountId,customer:{organisationId:scope.organisationId,emailVerifiedAt:{not:null}},tenancy:{facilityId:row.facilityId}},select:{customer:{select:{id:true,email:true}},tenancy:{select:{id:true,customerId:true}}}});
 if(!account?.customer.email||!account.tenancy||account.tenancy.customerId!==account.customer.id)throw Error('DEBICHECK_ATTEMPT_ACCOUNT_REVIEW');
 const value=readStoredBankConsent(row.config,{id:row.id,organisationId:scope.organisationId,facilityId:row.facilityId,accountId:input.accountId,customerId:account.customer.id});
 if(value.source.tenancyId!==account.tenancy.id)throw Error('DEBICHECK_ATTEMPT_ACCOUNT_REVIEW');
 const review=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:row.facilityId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_bank_consent_reviewed',actorId:{not:null}},orderBy:[{occurredAt:'desc'},{id:'desc'}]});
 if(!review)throw Error('DEBICHECK_BANK_AUTHENTICATION_REVIEW_REQUIRED');
 const source:DebiCheckAttemptSource={organisationId:scope.organisationId,facilityId:row.facilityId,accountId:input.accountId,requestId:value.source.requestId,requestSignature:value.source.requestSignature,sourceHash:value.source.sourceHash,merchantHash:value.source.merchantHash,connectionId:value.source.connectionId,connectionUpdatedAt:value.source.connectionUpdatedAt,templateSourceHash:value.source.templateSourceHash,authenticationConsentHash:bankAuthenticationConsentHash(value),independentReviewAuditId:review.id};
 return{value,source,owner:{organisationId:scope.organisationId,facilityId:row.facilityId,customerId:account.customer.id,email:account.customer.email}};
}
async function dispatchSource(tx:Tx,scope:RequestScope,input:{facilityId:string;accountId:string;consentId:string},now:Date){
 flags();const context=await preparation(tx,scope,input),{source,value,owner}=context;
 const current=await currentBankConsentSource(tx,scope,owner,{accountId:input.accountId,requestId:source.requestId},now);
 if(cardSourceHash(current)!==cardSourceHash(value.source))throw Error('DEBICHECK_BANK_CONSENT_SOURCE_CHANGED');
 const request=await tx.configurationProfile.findFirst({where:{id:source.requestId,organisationId:scope.organisationId,facilityId:source.facilityId,domain:DEBICHECK_REQUEST_DOMAIN,status:'REVIEWED'}});
 if(!request)throw Error('DEBICHECK_REVIEWED_REQUEST_REQUIRED');
 const definition=readDebiCheckRequest(request.config,{id:request.id,organisationId:scope.organisationId,facilityId:source.facilityId,accountId:input.accountId});
 await requireNativeBankConsent(tx,source,definition,now);
 const c=await getNetcashConnection(scope.organisationId,source.facilityId,true,tx),stored=await tx.integrationConnection.findUniqueOrThrow({where:{id:c.id}});
 if(c.id!==source.connectionId||c.updatedAt.toISOString()!==source.connectionUpdatedAt||c.config.environment!=='sandbox'||(stored.config as {environment?:unknown}).environment!=='test'||!['CONNECTED','HEALTHY'].includes(c.status)||!c.config.debitOrderServiceKey||!c.config.merchantAccount||merchantIdentity(scope.organisationId,'sandbox',c.config.merchantAccount)!==source.merchantHash)throw Error('DEBICHECK_CONFIGURATION_CHANGED');
 const terms=privateDebiCheckTerms(definition),key=c.config.debitOrderServiceKey;
 buildDebiCheckAuthenticationEnvelope(key,terms);
 return{...context,key,terms};
}
/** Explicit test operation only. No scheduler scans/reclaims CLAIMED records.
 * Exactly one committed new claim may reach the transport once. Returning an
 * existing claim, a guard failure, crash, timeout or failed result save never
 * creates another physical provider attempt. No network is inside a DB tx. */
export async function submitReviewedDebiCheckTest(scope:RequestScope,input:{facilityId:string;accountId:string;consentId:string;confirmed:boolean},request:typeof fetch=fetch,clock:()=>Date=()=>new Date()){
 if(input.confirmed!==true)throw Error('DEBICHECK_TEST_SUBMISSION_CONFIRMATION_REQUIRED');
 const claim=await db.$transaction(async tx=>{
  await lockAccount(tx,scope,input);
  const p=await preparation(tx,scope,input),id='debicheck-attempt:'+p.source.requestId.replace('debicheck-request:','');
  const row=await tx.configurationProfile.findUnique({where:{id}});
  if(row){
   if(row.domain!==DEBICHECK_ATTEMPT_DOMAIN||row.name!==p.source.requestId||row.organisationId!==scope.organisationId||row.facilityId!==p.source.facilityId)throw Error('DEBICHECK_ATTEMPT_INTEGRITY_REVIEW');
   const retained=readDebiCheckAttempt(row.config,{id,organisationId:scope.organisationId,facilityId:p.source.facilityId,accountId:input.accountId});
   if(cardSourceHash(retained.source)!==cardSourceHash(p.source)||row.status!==projectDebiCheckAttempt(retained).status)throw Error('DEBICHECK_ATTEMPT_SOURCE_CHANGED');
   return{newClaim:false,attempt:projectDebiCheckAttempt(retained)};
  }
  const context=await dispatchSource(tx,scope,input,clock());
  return retainDebiCheckAttemptClaim(tx,context.source,clock());
 },options);
 if(!claim.newClaim)return actionResult(claim,false,claim.attempt.completedAt!==null);
 let context:Awaited<ReturnType<typeof dispatchSource>>;
 try{
  context=await db.$transaction(async tx=>{
   await lockAccount(tx,scope,input);
   const current=await dispatchSource(tx,scope,input,clock()),row=await tx.configurationProfile.findUniqueOrThrow({where:{id:claim.attempt.id}}),retained=readDebiCheckAttempt(row.config,{id:row.id,organisationId:scope.organisationId,facilityId:current.source.facilityId,accountId:input.accountId});
   if(row.status!=='CLAIMED'||retained.initialResultEncrypted!==null||cardSourceHash(retained.source)!==cardSourceHash(current.source))throw Error('DEBICHECK_ATTEMPT_SOURCE_CHANGED');
   return current;
  },options);
 }catch{return actionResult(claim,false,false,true)}
 // Final synchronous checks immediately before entering the one-shot transport.
 try{flags();const now=clock(),approval=JSON.parse(process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL??'null');if(now>=new Date(context.value.expiresAt)||now<new Date(context.value.consentedAt!)||cardSourceHash(approval)!==context.value.source.providerApprovalHash||!approval||Date.parse(approval.expiresAt)-now.getTime()<600000)throw Error()}catch{return actionResult(claim,false,false,true)}
 let outboundCalls=0;
 const once:typeof fetch=(...args)=>{if(++outboundCalls!==1)throw Error('DEBICHECK_SECOND_TRANSPORT_FORBIDDEN');return request(...args)};
 const outcome=await submitDebiCheckAuthenticationOnce(context.key,context.terms,once);
 try{
  const attempt=await db.$transaction(tx=>retainDebiCheckAttemptResult(tx,{id:claim.attempt.id,organisationId:scope.organisationId,facilityId:context.source.facilityId,accountId:input.accountId},outcome,clock()),options);
  return actionResult(claim,outboundCalls===1,true,false,attempt);
 }catch{
  // Commit uncertainty is held. Do not repeat result persistence or dispatch.
  return actionResult(claim,outboundCalls===1,false,false,null);
 }
}

/** Read only at the provider, then append separate evidence. The original
 * response/contract is immutable. Missing returned contracts cannot be invented. */
export async function reconcileDebiCheckTest(scope:RequestScope,input:{facilityId:string;accountId:string;attemptId:string;confirmed:boolean},request:typeof fetch=fetch,clock:()=>Date=()=>new Date()){
 if(input.confirmed!==true)throw Error('DEBICHECK_STATUS_CONFIRMATION_REQUIRED');
 if(process.env.NETCASH_DEBICHECK_STATUS_LOOKUP_ENABLED!=='true')throw Error('DEBICHECK_STATUS_LOOKUP_DISABLED');
 const context=await db.$transaction(async tx=>{
  const row=await tx.configurationProfile.findFirst({where:{id:input.attemptId,organisationId:scope.organisationId,domain:DEBICHECK_ATTEMPT_DOMAIN}});
  if(!row?.facilityId||row.facilityId!==input.facilityId)throw Error('DEBICHECK_ATTEMPT_NOT_FOUND');await actor(tx,scope,row.facilityId,'payments.bank_auth_status');
  const attempt=readDebiCheckAttempt(row.config,{id:row.id,organisationId:scope.organisationId,facilityId:row.facilityId,accountId:input.accountId});
  if(row.status!==projectDebiCheckAttempt(attempt).status||row.name!==attempt.source.requestId)throw Error('DEBICHECK_ATTEMPT_INTEGRITY_REVIEW');
  const originalRequest=await tx.configurationProfile.findFirst({where:{id:attempt.source.requestId,organisationId:scope.organisationId,facilityId:row.facilityId,domain:DEBICHECK_REQUEST_DOMAIN}});
  if(!originalRequest)throw Error('DEBICHECK_REVIEWED_REQUEST_REQUIRED');
  const definition=readDebiCheckRequest(originalRequest.config,{id:originalRequest.id,organisationId:scope.organisationId,facilityId:row.facilityId,accountId:input.accountId});
  if(definition.signature!==attempt.source.requestSignature||definition.sourceHash!==attempt.source.sourceHash||definition.merchantHash!==attempt.source.merchantHash||definition.templateSourceHash!==attempt.source.templateSourceHash||definition.connectionId!==attempt.source.connectionId||definition.connectionUpdatedAt!==attempt.source.connectionUpdatedAt||!await tx.account.findFirst({where:{id:input.accountId,customerId:definition.customerId,customer:{organisationId:scope.organisationId},tenancy:{id:definition.tenancyId,customerId:definition.customerId,facilityId:row.facilityId}},select:{id:true}}))throw Error('DEBICHECK_ATTEMPT_SOURCE_CHANGED');
  const original=debiCheckAttemptInitialResult(attempt);if(!original?.contractReference)throw Error('DEBICHECK_ORIGINAL_CONTRACT_REQUIRED');
  const c=await getNetcashConnection(scope.organisationId,row.facilityId,true,tx),stored=await tx.integrationConnection.findUniqueOrThrow({where:{id:c.id}});
  if(c.id!==attempt.source.connectionId||c.updatedAt.toISOString()!==attempt.source.connectionUpdatedAt||c.config.environment!=='sandbox'||(stored.config as {environment?:unknown}).environment!=='test'||!['CONNECTED','HEALTHY'].includes(c.status)||!c.config.merchantAccount||!c.config.debitOrderServiceKey||merchantIdentity(scope.organisationId,'sandbox',c.config.merchantAccount)!==attempt.source.merchantHash)throw Error('DEBICHECK_CONFIGURATION_CHANGED');
  return{key:c.config.debitOrderServiceKey,reference:original.contractReference,merchantHash:attempt.source.merchantHash,facilityId:row.facilityId};
 },{isolationLevel:'RepeatableRead',timeout:20000});
 if(process.env.NETCASH_DEBICHECK_STATUS_LOOKUP_ENABLED!=='true')throw Error('DEBICHECK_STATUS_LOOKUP_DISABLED');
 const value=await readDebiCheckCurrentStatus(context.key,context.reference,request);
 return db.$transaction(async tx=>{
  await actor(tx,scope,context.facilityId,'payments.bank_auth_status');
  return retainDebiCheckStatusObservation(tx,{id:input.attemptId,organisationId:scope.organisationId,facilityId:context.facilityId,accountId:input.accountId},context.merchantHash,value,clock());
 },options);
}
