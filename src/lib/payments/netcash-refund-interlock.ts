import type {Prisma} from '@/generated/prisma/client';
import {NETCASH_REFUND_DOMAIN,readRefundRecord,refundHoldsManualPayout} from './netcash-refund-policy';
import {NETCASH_REFUND_ATTEMPT_DOMAIN,readRefundAttempt} from './netcash-refund-attempt-policy';
/** Both manual payout/cancel and native reservation must hold the same Account
 * row lock before calling this. No flag bypass: retained holds survive disable.
 * Bound the scan and fail closed on incomplete or malformed retained coverage. */
export async function assertNoNetcashRefundHold(tx:Prisma.TransactionClient,organisationId:string,accountId:string,paymentId:string|null){
 const rows=await tx.configurationProfile.findMany({where:{organisationId,domain:NETCASH_REFUND_DOMAIN},take:1001,orderBy:{id:'asc'}});
 if(rows.length>1000)throw Error('NETCASH_REFUND_HOLD_COVERAGE_REVIEW');
 for(const row of rows){
  if(!row.facilityId||row.name!==row.id)throw Error('NETCASH_REFUND_INTEGRITY_REVIEW');
  const value=readRefundRecord(row.config,{id:row.id,organisationId,facilityId:row.facilityId});
  if(row.status!==value.state)throw Error('NETCASH_REFUND_INTEGRITY_REVIEW');
  if((value.source.accountId===accountId||value.source.paymentId===paymentId)&&refundHoldsManualPayout(value))throw Error('NETCASH_REFUND_RESERVED');
 }
 const attempts=await tx.configurationProfile.findMany({where:{organisationId,domain:NETCASH_REFUND_ATTEMPT_DOMAIN},take:1001,orderBy:{id:'asc'}});
 if(attempts.length>1000)throw Error('NETCASH_REFUND_HOLD_COVERAGE_REVIEW');
 const claimedRefunds:string[]=[];
 for(const row of attempts){
  if(!row.facilityId||row.name!==row.id)throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');
  const value=readRefundAttempt(row.config,{id:row.id,organisationId,facilityId:row.facilityId});
  if(row.status!==value.state)throw Error('NETCASH_REFUND_ATTEMPT_INTEGRITY');
  if(value.claim){claimedRefunds.push(value.refundId);if(value.source.accountId===accountId||value.source.paymentId===paymentId)throw Error('NETCASH_REFUND_RESERVED');}
 }
 // A provider-prefix audit without a valid claimed journal is an integrity
 // hold, including a deleted V1 record or orphan legacy/unknown audit. Never
 // infer zero attempts from a missing journal. Bound profiles, fail closed.
 if(await tx.auditEvent.findFirst({where:{organisationId,entityType:'ConfigurationProfile',action:{startsWith:'netcash.refund_provider_'},...(claimedRefunds.length?{entityId:{notIn:claimedRefunds}}:{})},select:{id:true}}))throw Error('NETCASH_REFUND_PROVIDER_OUTCOME_REVIEW');
}
