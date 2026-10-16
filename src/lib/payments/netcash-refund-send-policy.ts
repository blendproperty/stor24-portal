import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import type {NetcashRefundSource} from './netcash-refund-policy';
import {southAfricaDateKey} from '../south-africa-time';

const hash=z.string().regex(/^[a-f\d]{64}$/),id=z.string().trim().min(1).max(160);
/** Trusted deployment assertion of provider authorization; never supplied by
 * the browser and never inferred from the signing-only bank test permission.
 * The current original-refund source is LIVE only. This is an actual refund
 * REQUEST, not a fabricated sandbox payment or a settlement instruction. */
const approvalSchema=z.object({version:z.literal(1),purpose:z.literal('CARD_REFUND_REQUEST_ONLY'),
 organisationId:id,facilityId:id,accountId:id,adjustmentId:id,paymentId:id,
 sourceHash:hash,merchantKey:hash,credentialFingerprint:hash,
 transactionId:z.string().regex(/^[1-9]\d{0,9}$/),amount:z.string().regex(/^(?:0|[1-9]\d{0,5})\.\d{2}$/).refine(value=>Number(value)>0),
 wireFormat:z.enum(['DECIMAL_DOT','DECIMAL_COMMA']),environment:z.literal('live'),
 providerEvidenceReference:z.string().trim().min(3).max(200),approvalRecordedBy:id,
 approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
}).strict().superRefine((v,c)=>{const duration=Date.parse(v.expiresAt)-Date.parse(v.approvedAt);if(duration<=0||duration>86400000)c.addIssue({code:'custom',message:'At most 24 hours required'});});
export type RefundSendApproval=z.infer<typeof approvalSchema>;
export function refundCredentialFingerprint(organisationId:string,connectionId:string,serviceKey:string){
 const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('NETCASH_REFUND_SIGNING_REQUIRED');
 return createHmac('sha256',key).update('netcash-refund-credential:v1:').update(cardSourceHash({organisationId,connectionId,serviceKey})).digest('hex');
}
/** Shared by admission and the last pretransport guard. Hash parsed normalized
 * approval, never documentary whitespace from the original JSON string. */
export function readRefundSendApproval(now=new Date()){
 const raw=process.env.NETCASH_REFUND_REQUEST_APPROVAL;
 if(!raw||raw.length>8192)throw Error('NETCASH_REFUND_SEND_APPROVAL_REQUIRED');
 let value:RefundSendApproval;
 try{value=approvalSchema.parse(JSON.parse(raw));}catch{throw Error('NETCASH_REFUND_SEND_APPROVAL_REQUIRED');}
 if(now<new Date(value.approvedAt)||new Date(value.expiresAt).getTime()-now.getTime()<60000)throw Error('NETCASH_REFUND_SEND_APPROVAL_EXPIRED');
 return value;
}
export function requireRefundSendApproval(source:NetcashRefundSource,credentialFingerprint:string,now=new Date()){
 requireRefundRequestDate(source.lineDate,now);
 const value=readRefundSendApproval(now);
 const expected={organisationId:source.organisationId,facilityId:source.facilityId,accountId:source.accountId,adjustmentId:source.adjustmentId,paymentId:source.paymentId,sourceHash:cardSourceHash(source),merchantKey:source.merchantKey,credentialFingerprint,transactionId:source.transactionId,amount:source.refundAmount};
 for(const key of Object.keys(expected) as (keyof typeof expected)[])if(value[key]!==expected[key])throw Error('NETCASH_REFUND_SEND_APPROVAL_SOURCE_CHANGED');
 return{approval:value,approvalHash:cardSourceHash(value)};
}
/** Provider help limits card requests to six months. Use the original reviewed
 * statement's transaction day; do not replace it with import/posting time.
 * Hold the exact six-month boundary for provider review rather than assuming
 * an undocumented time-of-day/time-zone grace period. Clamp month ends. */
export function requireRefundRequestDate(lineDate:string,now=new Date()){
 const day=z.iso.date().parse(lineDate),today=southAfricaDateKey(now),original=new Date(day+'T12:00:00Z');
 const month=original.getUTCMonth()+6,year=original.getUTCFullYear()+Math.floor(month/12),targetMonth=month%12;
 const endDay=Math.min(original.getUTCDate(),new Date(Date.UTC(year,targetMonth+1,0)).getUTCDate());
 const boundary=new Date(Date.UTC(year,targetMonth,endDay,12)).toISOString().slice(0,10);
 if(day>today||today>=boundary)throw Error('NETCASH_REFUND_PROVIDER_DATE_REVIEW');
}
