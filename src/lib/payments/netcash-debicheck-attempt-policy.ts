import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {encryptIntegrationSecret,decryptIntegrationSecret} from '../integrations/integration-secret-vault';
import type {DebiCheckAuthenticationOutcome} from './netcash-debicheck-authentication';
import type {parseDebiCheckCurrentStatus} from './netcash-debicheck-soap';

export const DEBICHECK_ATTEMPT_DOMAIN='NETCASH_DEBICHECK_ATTEMPT';
export const DEBICHECK_STATUS_OBSERVATION_DOMAIN='NETCASH_DEBICHECK_STATUS_OBSERVATION';
const id=z.string().min(1).max(160),hash=z.string().regex(/^[a-f\d]{64}$/);
export const debiCheckAttemptSourceSchema=z.object({
 organisationId:id,facilityId:id,accountId:id,requestId:z.string().regex(/^debicheck-request:[a-f\d-]{36}$/),
 requestSignature:hash,sourceHash:hash,merchantHash:hash,connectionId:id,connectionUpdatedAt:z.iso.datetime(),
 templateSourceHash:hash,authenticationConsentHash:hash,independentReviewAuditId:id,
}).strict();
export type DebiCheckAttemptSource=z.infer<typeof debiCheckAttemptSourceSchema>;
const outcomeSchema=z.object({
 outcome:z.enum(['BANK_AUTHENTICATED','BANK_REJECTED','REQUEST_REJECTED','OUTCOME_UNKNOWN']),
 contractReference:z.string().regex(/^NC\d{12}$/).nullable(),providerCode:z.string().regex(/^\d{3}$/).nullable(),
 requestSubmitted:z.boolean().nullable(),bankAuthenticationObserved:z.boolean(),
 collectionAuthorised:z.literal(false),financialReceipt:z.literal(false),retryAllowed:z.literal(false),
}).strict().superRefine((value,ctx)=>{
 const accepted=value.outcome==='BANK_AUTHENTICATED',bankOutcome=accepted||value.outcome==='BANK_REJECTED';
 if(value.requestSubmitted!==(value.providerCode==='000'?true:value.outcome==='REQUEST_REJECTED'?false:null)||value.bankAuthenticationObserved!==accepted||(bankOutcome&&(!value.contractReference||value.providerCode!=='000'||value.requestSubmitted!==true))||
  (value.outcome==='REQUEST_REJECTED'&&(value.contractReference!==null||value.requestSubmitted!==false||!['100','203','325'].includes(value.providerCode??''))))
  ctx.addIssue({code:'custom',message:'Contradictory authentication evidence'});
});
const schema=z.object({version:z.literal(1),recordId:id,source:debiCheckAttemptSourceSchema,claimedAt:z.iso.datetime(),
 initialResultEncrypted:z.string().min(1).max(6000).nullable(),completedAt:z.iso.datetime().nullable(),signature:hash,
}).strict();
export type DebiCheckAttempt=z.infer<typeof schema>;
const attemptId=(requestId:string)=>'debicheck-attempt:'+requestId.replace('debicheck-request:','');
function signature(value:unknown){const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('DEBICHECK_SIGNING_REQUIRED');return createHmac('sha256',key).update('netcash-debicheck-attempt:v1:'+cardSourceHash(value)).digest('hex');}
function seal(value:Omit<DebiCheckAttempt,'signature'>){return schema.parse({...value,signature:signature(value)});}
export function prepareDebiCheckAttempt(source:DebiCheckAttemptSource,now:Date){
 const parsed=debiCheckAttemptSourceSchema.parse(source);
 return seal({version:1,recordId:attemptId(parsed.requestId),source:parsed,claimedAt:now.toISOString(),initialResultEncrypted:null,completedAt:null});
}
export function readDebiCheckAttempt(value:unknown,identity:{id:string;organisationId:string;facilityId:string;accountId:string}){
 const parsed=schema.parse(value),{signature:stored,...plain}=parsed;
 if(parsed.recordId!==identity.id||parsed.recordId!==attemptId(parsed.source.requestId)||parsed.source.organisationId!==identity.organisationId||parsed.source.facilityId!==identity.facilityId||parsed.source.accountId!==identity.accountId||
  !timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(signature(plain),'hex'))||(parsed.initialResultEncrypted===null)!==(parsed.completedAt===null)||
  (parsed.completedAt!==null&&new Date(parsed.completedAt)<new Date(parsed.claimedAt)))throw Error('DEBICHECK_ATTEMPT_INTEGRITY_REVIEW');
 return parsed;
}
export function debiCheckAttemptInitialResult(attempt:DebiCheckAttempt){
 return attempt.initialResultEncrypted===null?null:outcomeSchema.parse(JSON.parse(decryptIntegrationSecret(attempt.initialResultEncrypted)));
}
export function completeDebiCheckAttempt(attempt:DebiCheckAttempt,value:DebiCheckAuthenticationOutcome,now:Date){
 const parsed=outcomeSchema.parse(value),prior=debiCheckAttemptInitialResult(attempt);
 if(prior){if(cardSourceHash(prior)!==cardSourceHash(parsed))throw Error('DEBICHECK_ATTEMPT_RESULT_CONFLICT');return attempt;}
 if(now<new Date(attempt.claimedAt))throw Error('DEBICHECK_ATTEMPT_TIME_REVIEW');
 const {version,recordId,source,claimedAt}=attempt;
 return seal({version,recordId,source,claimedAt,initialResultEncrypted:encryptIntegrationSecret(JSON.stringify(parsed)),completedAt:now.toISOString()});
}
export function projectDebiCheckAttempt(attempt:DebiCheckAttempt){
 const initial=debiCheckAttemptInitialResult(attempt);
 return{id:attempt.recordId,requestId:attempt.source.requestId,claimedAt:attempt.claimedAt,completedAt:attempt.completedAt,
  status:initial?.outcome??'CLAIMED',bankAuthenticationObserved:initial?.bankAuthenticationObserved??false,
  originalContractAvailable:!!initial?.contractReference,reconciliationRequired:!initial||initial.outcome==='OUTCOME_UNKNOWN',
  retryAllowed:false as const,collectionAuthorised:false as const,financialReceipt:false as const};
}

/** A status read is separate evidence; it must not rewrite the original dispatch
 * response, authorise a resend, sign a mandate, or post a collection/receipt. */
export function prepareDebiCheckStatusObservation(attempt:DebiCheckAttempt,merchantHash:string,value:ReturnType<typeof parseDebiCheckCurrentStatus>,now:Date){
 const original=debiCheckAttemptInitialResult(attempt);
 if(!original?.contractReference||attempt.source.merchantHash!==merchantHash)throw Error('DEBICHECK_RECONCILIATION_SOURCE_REVIEW');
 const stamp=z.string().regex(/^\d{8}$/).refine(value=>{const d=new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T12:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10).replaceAll('-','')===value;});
 const text=z.string().max(300).regex(/^[^\x00-\x1f\x7f]*$/);
 const observation=z.object({contractReference:z.string().regex(/^NC\d{12}$/),status:text.min(1),updatedAt:stamp.nullable(),cancelledAt:stamp.nullable(),cancellationReason:text.nullable(),bankAuthenticationObserved:z.boolean(),collectionAuthorised:z.literal(false),financialReceipt:z.literal(false)}).strict().parse(value);
 if(observation.contractReference!==original.contractReference||observation.bankAuthenticationObserved!==(observation.status==='Accepted'&&observation.cancelledAt===null&&observation.cancellationReason===null)||!attempt.completedAt||now<new Date(attempt.completedAt))throw Error('DEBICHECK_RECONCILIATION_SOURCE_REVIEW');
 const observationHash=cardSourceHash(observation),plain={version:1 as const,recordId:attempt.recordId+':status:'+observationHash,attemptId:attempt.recordId,requestId:attempt.source.requestId,merchantHash,sourceHash:attempt.source.sourceHash,observedAt:now.toISOString(),observationHash,encryptedObservation:encryptIntegrationSecret(JSON.stringify(observation))};
 return{record:{...plain,signature:signature(plain)},projection:{id:plain.recordId,attemptId:attempt.recordId,observedAt:plain.observedAt,bankAuthenticationObserved:observation.bankAuthenticationObserved,retryAllowed:false as const,collectionAuthorised:false as const,financialReceipt:false as const}};
}
export function readDebiCheckStatusObservation(value:unknown,attempt:DebiCheckAttempt,merchantHash:string){
 const parsed=z.object({version:z.literal(1),recordId:z.string().min(1).max(250),attemptId:id,requestId:id,merchantHash:hash,sourceHash:hash,observedAt:z.iso.datetime(),observationHash:hash,encryptedObservation:z.string().min(1).max(6000),signature:hash}).strict().parse(value);
 const {signature:stored,...plain}=parsed;
 if(!timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(signature(plain),'hex')))throw Error('DEBICHECK_ATTEMPT_INTEGRITY_REVIEW');
 const {record,projection}=prepareDebiCheckStatusObservation(attempt,merchantHash,JSON.parse(decryptIntegrationSecret(parsed.encryptedObservation)),new Date(parsed.observedAt));
 for(const key of ['recordId','attemptId','requestId','merchantHash','sourceHash','observationHash'] as const)if(parsed[key]!==record[key])throw Error('DEBICHECK_ATTEMPT_INTEGRITY_REVIEW');
 return projection;
}
