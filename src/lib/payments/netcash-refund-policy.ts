import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {decryptIntegrationSecret,encryptIntegrationSecret} from '../integrations/integration-secret-vault';

export const NETCASH_REFUND_DOMAIN='NETCASH_PROVIDER_REFUND';
const id=z.string().min(1).max(160).regex(/^[^\x00-\x1f\x7f]+$/),hash=z.string().regex(/^[a-f\d]{64}$/),at=z.iso.datetime();
const money=z.string().regex(/^(?:0|[1-9]\d{0,5})\.\d{2}$/).refine(value=>Number(value)>0);
const reference=z.string().trim().min(3).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
/** Preserve the original string; do not round, truncate, or infer the numeric
 * refund identifier from a merchant reference, amount, callback or card token. */
export function refundTransactionId(value:string){
 if(!/^[1-9]\d{0,9}$/.test(value)||BigInt(value)>2147483647n)throw Error('NETCASH_REFUND_TRANSACTION_REVIEW');
 return value;
}
export const refundSourceSchema=z.object({
 organisationId:id,facilityId:id,accountId:id,customerId:id,adjustmentId:id,adjustmentFingerprint:hash,
 adjustmentRequestedById:id,adjustmentReviewedById:id,adjustmentReviewedAt:at,
 paymentId:id,sourceEntryId:id,paymentAmount:money,refundAmount:money,
 merchantKey:hash,connectionId:id,connectionUpdatedAt:at,
 statementId:id,statementSha256:hash,statementRevision:z.number().int().min(1),statementApprovedById:id,statementApprovalAuditId:id,
 lineId:id,transactionId:z.string().refine(value=>{try{return refundTransactionId(value)===value}catch{return false}}),lineDate:z.iso.date(),lineCode:z.literal('PNC'),lineResolutionHash:hash,
}).strict().superRefine((value,ctx)=>{
 if(value.adjustmentRequestedById===value.adjustmentReviewedById)ctx.addIssue({code:'custom',message:'Independent original refund approval required'});
 if(Number(value.refundAmount)>Number(value.paymentAmount))ctx.addIssue({code:'custom',message:'Refund exceeds original payment'});
});
export type NetcashRefundSource=z.infer<typeof refundSourceSchema>;
export const refundStateSchema=z.enum(['PREPARED','REVIEWED','REJECTED','WITHDRAWN','RESERVED','RELEASE_REQUESTED','RELEASED']);
export type NetcashRefundState=z.infer<typeof refundStateSchema>;
const review=z.object({actorId:id,at,reference}).strict();
export const refundRecordSchema=z.object({version:z.literal(1),id,source:refundSourceSchema,sourceHash:hash,state:refundStateSchema,revision:z.number().int().min(1),createdAt:at,preparedById:id,preparationReference:reference,
 review:review.nullable(),reservation:review.nullable(),releaseRequest:review.nullable(),releaseReview:review.nullable(),
 providerAttempted:z.literal(false),dispatchAvailable:z.literal(false),dispatchContract:z.literal('UNAVAILABLE_V1'),financialPosting:z.literal(false),
}).strict().superRefine((value,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(value.id!==refundRecordId(value.source)||value.sourceHash!==cardSourceHash(value.source))fail('Source identity mismatch');
 if(value.review&&value.review.actorId===value.preparedById)fail('Independent preparation review required');
 const reviewed=['REJECTED','REVIEWED','RESERVED','RELEASE_REQUESTED','RELEASED'].includes(value.state);
 if(reviewed&&!value.review)fail('Review missing');
 if(value.state==='PREPARED'&&value.review)fail('Unexpected review');
 const held=['RESERVED','RELEASE_REQUESTED','RELEASED'].includes(value.state);
 if(held&&!value.reservation)fail('Reservation missing');
 if(!held&&value.reservation)fail('Unexpected reservation');
 if(['RELEASE_REQUESTED','RELEASED'].includes(value.state)!==!!value.releaseRequest)fail('Release request mismatch');
 if((value.state==='RELEASED')!==!!value.releaseReview)fail('Release review mismatch');
 if(value.releaseReview&&value.releaseRequest&&value.releaseReview.actorId===value.releaseRequest.actorId)fail('Independent release review required');
 const dates=[value.createdAt,...[value.review,value.reservation,value.releaseRequest,value.releaseReview].flatMap(item=>item?[item.at]:[])].map(Date.parse);
 if(dates.some((date,index)=>index>0&&date<dates[index-1]))fail('Evidence chronology mismatch');
});
export type NetcashRefundRecord=z.infer<typeof refundRecordSchema>;
export function refundRecordId(source:Pick<NetcashRefundSource,'organisationId'|'merchantKey'|'transactionId'>){
 return 'netcash-refund:'+cardSourceHash({organisationId:source.organisationId,merchantKey:source.merchantKey,transactionId:refundTransactionId(source.transactionId)});
}
function signingKey(){const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('NETCASH_REFUND_SIGNING_REQUIRED');return key;}
function signature(value:unknown){return createHmac('sha256',signingKey()).update('netcash-refund-reservation:v1:').update(cardSourceHash(value)).digest('hex');}
export function sealRefundRecord(raw:NetcashRefundRecord){const value=refundRecordSchema.parse(raw);return{version:1,signature:signature(value),payloadEncrypted:encryptIntegrationSecret(JSON.stringify(value))};}
export function readRefundRecord(raw:unknown,expected:{id:string;organisationId:string;facilityId:string}){
 try{
  const sealed=z.object({version:z.literal(1),signature:hash,payloadEncrypted:z.string().max(40000)}).strict().parse(raw);
  const value=refundRecordSchema.parse(JSON.parse(decryptIntegrationSecret(sealed.payloadEncrypted)));
  if(!timingSafeEqual(Buffer.from(sealed.signature,'hex'),Buffer.from(signature(value),'hex'))||value.id!==expected.id||value.source.organisationId!==expected.organisationId||value.source.facilityId!==expected.facilityId)throw Error();
  return value;
 }catch{throw Error('NETCASH_REFUND_INTEGRITY_REVIEW')}
}
export function refundHoldsManualPayout(value:NetcashRefundRecord){return value.state==='RESERVED'||value.state==='RELEASE_REQUESTED';}
export function projectRefundRecord(value:NetcashRefundRecord){
 return{id:value.id,facilityId:value.source.facilityId,accountId:value.source.accountId,adjustmentId:value.source.adjustmentId,paymentId:value.source.paymentId,amount:value.source.refundAmount,state:value.state,revision:value.revision,createdAt:value.createdAt,preparedById:value.preparedById,review:value.review,reservation:value.reservation,releaseRequest:value.releaseRequest,releaseReview:value.releaseReview,manualPayoutHeld:refundHoldsManualPayout(value),providerAttempted:false as const,dispatchAvailable:false as const,financialPosting:false as const,retryAvailable:false as const};
}

/** Internal transition policy. Current facility/finance authority and unchanged
 * original source must also be rederived inside the service account lock. */
export function transitionRefundRecord(raw:NetcashRefundRecord,action:'review'|'reject'|'withdraw'|'reserve'|'request-release'|'approve-release',actorId:string,evidenceReference:string,now=new Date()){
 const value=refundRecordSchema.parse(raw),evidence=review.parse({actorId,reference:evidenceReference,at:now.toISOString()});
 let next:NetcashRefundRecord;
 if(action==='review'||action==='reject'){
  if(value.state!=='PREPARED')throw Error('NETCASH_REFUND_STATE');
  if(actorId===value.preparedById)throw Error('NETCASH_REFUND_INDEPENDENT_REVIEW');
  next={...value,state:action==='review'?'REVIEWED':'REJECTED',review:evidence};
 }else if(action==='withdraw'){
  if(!['PREPARED','REVIEWED'].includes(value.state))throw Error('NETCASH_REFUND_STATE');
  if(actorId!==value.preparedById)throw Error('FORBIDDEN');
  next={...value,state:'WITHDRAWN'};
 }else if(action==='reserve'){
  if(value.state!=='REVIEWED')throw Error('NETCASH_REFUND_STATE');
  if(actorId===value.preparedById)throw Error('NETCASH_REFUND_INDEPENDENT_REVIEW');
  next={...value,state:'RESERVED',reservation:evidence};
 }else if(action==='request-release'){
  if(value.state!=='RESERVED')throw Error('NETCASH_REFUND_STATE');
  next={...value,state:'RELEASE_REQUESTED',releaseRequest:evidence};
 }else{
  if(value.state!=='RELEASE_REQUESTED')throw Error('NETCASH_REFUND_STATE');
  if(actorId===value.releaseRequest?.actorId)throw Error('NETCASH_REFUND_INDEPENDENT_REVIEW');
  next={...value,state:'RELEASED',releaseReview:evidence};
 }
 return refundRecordSchema.parse({...next,revision:value.revision+1});
}
