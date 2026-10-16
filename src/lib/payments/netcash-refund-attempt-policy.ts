import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {refundRecordId,refundSourceSchema} from './netcash-refund-policy';
import {encryptIntegrationSecret,decryptIntegrationSecret} from '../integrations/integration-secret-vault';

export const NETCASH_REFUND_ATTEMPT_DOMAIN='NETCASH_PROVIDER_REFUND_ATTEMPT';
const id=z.string().min(1).max(160),hash=z.string().regex(/^[a-f\d]{64}$/),at=z.iso.datetime();
const evidence=z.object({actorId:id,at,reference:z.string().trim().min(3).max(200).regex(/^[^\x00-\x1f\x7f]+$/)}).strict();
const response=z.object({httpStatus:z.number().int().min(100).max(599).nullable(),bodyBase64:z.string().max(85336).regex(/^[A-Za-z\d+/]*={0,2}$/),complete:z.boolean(),capturedBytes:z.number().int().min(0).max(64000),outcome:z.enum(['ACKNOWLEDGED_PENDING_MERCHANT','DUPLICATE_OWNERSHIP_UNKNOWN','REJECTED','UNKNOWN']),providerCode:z.enum(['000','100','200','202','316','330']).nullable(),financialPosting:z.literal(false),retryAvailable:z.literal(false)}).strict().superRefine((v,c)=>{
 const decoded=Buffer.from(v.bodyBase64,'base64');if(decoded.length!==v.capturedBytes||decoded.toString('base64')!==v.bodyBase64)c.addIssue({code:'custom',message:'Original response byte count mismatch'});
 const expected=v.providerCode==='000'?'ACKNOWLEDGED_PENDING_MERCHANT':v.providerCode==='330'?'DUPLICATE_OWNERSHIP_UNKNOWN':['100','202','316'].includes(v.providerCode??'')?'REJECTED':'UNKNOWN';
 if(v.outcome!==expected||(!v.complete&&(v.outcome!=='UNKNOWN'||v.providerCode!==null))||(v.providerCode!==null&&(v.httpStatus===null||v.httpStatus<200||v.httpStatus>=300)))c.addIssue({code:'custom',message:'Response outcome contradicts evidence'});
});
export const refundAttemptSchema=z.object({version:z.literal(1),id,refundId:id,source:refundSourceSchema,sourceHash:hash,reservationRevision:z.number().int().positive(),
 state:z.enum(['PREPARED','REVIEWED','CLAIMED','RESULT_RETAINED']),revision:z.number().int().positive(),created:evidence,review:evidence.nullable(),
 approvalHash:hash,credentialFingerprint:hash,claim:z.object({actorId:id,at,token:z.string().uuid()}).strict().nullable(),
 result:response.nullable(),resultAt:at.nullable(),financialPosting:z.literal(false),retryAvailable:z.literal(false),
}).strict().superRefine((v,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(v.refundId!==refundRecordId(v.source)||v.id!==refundAttemptId(v.refundId)||v.sourceHash!==cardSourceHash(v.source))fail('Original identity mismatch');
 if(v.review?.actorId===v.created.actorId)fail('Independent SEND review required');
 if((v.state!=='PREPARED')!==!!v.review)fail('SEND review state mismatch');
 if(['CLAIMED','RESULT_RETAINED'].includes(v.state)!==!!v.claim)fail('Irreversible claim state mismatch');
 if((v.state==='RESULT_RETAINED')!==!!v.result||(v.state==='RESULT_RETAINED')!==!!v.resultAt)fail('Result state mismatch');
 if(v.claim&&v.claim.actorId!==v.created.actorId)fail('Only original SEND requester may claim');
 const dates=[v.created.at,v.review?.at,v.claim?.at,v.resultAt].filter((x):x is string=>!!x).map(Date.parse);
 if(dates.some((value,index)=>index>0&&value<dates[index-1]))fail('Attempt chronology mismatch');
});
export type RefundAttempt=z.infer<typeof refundAttemptSchema>;
export function refundAttemptId(refundId:string){if(!/^netcash-refund:[a-f\d]{64}$/.test(refundId))throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');return refundId.replace('netcash-refund:','netcash-refund-attempt:');}
function sign(value:unknown){const secret=process.env.AUTH_SECRET;if(!secret||secret.length<32)throw Error('NETCASH_REFUND_SIGNING_REQUIRED');return createHmac('sha256',secret).update('netcash-refund-attempt:v1:').update(cardSourceHash(value)).digest('hex');}
export function sealRefundAttempt(raw:RefundAttempt){const value=refundAttemptSchema.parse(raw);return{version:1,signature:sign(value),payloadEncrypted:encryptIntegrationSecret(JSON.stringify(value))};}
export function readRefundAttempt(raw:unknown,expected:{id:string;organisationId:string;facilityId:string}){
 try{
  const sealed=z.object({version:z.literal(1),signature:hash,payloadEncrypted:z.string().max(180000)}).strict().parse(raw);
  const value=refundAttemptSchema.parse(JSON.parse(decryptIntegrationSecret(sealed.payloadEncrypted)));
  if(value.id!==expected.id||value.source.organisationId!==expected.organisationId||value.source.facilityId!==expected.facilityId||!timingSafeEqual(Buffer.from(sealed.signature,'hex'),Buffer.from(sign(value),'hex')))throw Error();
  return value;
 }catch{throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');}
}
/** A committed claim is an irreversible POSSIBLE provider action even if the
 * process died before fetch or result persistence. It can never prove paid. */
export function projectRefundAttempt(value:RefundAttempt){return{id:value.id,refundId:value.refundId,facilityId:value.source.facilityId,revision:value.revision,state:value.state,created:value.created,review:value.review,claimAt:value.claim?.at??null,claimRetained:!!value.claim,providerOutcome:value.result?.outcome??(value.claim?'CLAIMED_NO_VERIFIED_RESULT':'NOT_CLAIMED'),providerCode:value.result?.providerCode??null,responseComplete:value.result?.complete??null,financialPosting:false as const,retryAvailable:false as const};}
