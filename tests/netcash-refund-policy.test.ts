import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {cardSourceHash} from '../src/lib/payments/card-autopay-enrollment-policy';
import {refundTransactionId,refundSourceSchema,refundRecordId,refundRecordSchema,sealRefundRecord,readRefundRecord,refundHoldsManualPayout,projectRefundRecord,transitionRefundRecord,type NetcashRefundRecord} from '../src/lib/payments/netcash-refund-policy';

test('refund preparation policy preserves a bounded original transaction and zero-dispatch held history',async t=>{
 const before={auth:process.env.AUTH_SECRET,vault:process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY};process.env.AUTH_SECRET=randomBytes(32).toString('hex');process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
 const source=refundSourceSchema.parse({organisationId:'synthetic-org',facilityId:'synthetic-facility',accountId:'synthetic-account',customerId:'synthetic-customer',adjustmentId:'synthetic-adjustment',adjustmentFingerprint:'1'.repeat(64),adjustmentRequestedById:'synthetic-requester',adjustmentReviewedById:'synthetic-original-reviewer',adjustmentReviewedAt:'2026-10-16T04:00:00Z',paymentId:'synthetic-payment',sourceEntryId:'synthetic-entry',paymentAmount:'950.00',refundAmount:'100.00',merchantKey:'2'.repeat(64),connectionId:'synthetic-connection',connectionUpdatedAt:'2026-10-15T04:00:00Z',statementId:'synthetic-statement',statementSha256:'3'.repeat(64),statementRevision:2,statementApprovedById:'synthetic-statement-reviewer',statementApprovalAuditId:'synthetic-approval-audit',lineId:'synthetic-line',transactionId:'2147483647',lineDate:'2026-10-15',lineCode:'PNC',lineResolutionHash:'4'.repeat(64)});
 const evidence=(actorId:string,at='2026-10-16T05:00:01Z')=>({actorId,at,reference:'Synthetic evidence only'});
 const prepared:NetcashRefundRecord={version:1,id:refundRecordId(source),source,sourceHash:cardSourceHash(source),state:'PREPARED',revision:1,createdAt:'2026-10-16T05:00:00Z',preparedById:'synthetic-preparer',preparationReference:'Synthetic isolated preparation',review:null,reservation:null,releaseRequest:null,releaseReview:null,providerAttempted:false,dispatchAvailable:false,dispatchContract:'UNAVAILABLE_V1',financialPosting:false};
 const expected={id:prepared.id,organisationId:source.organisationId,facilityId:source.facilityId};
 try{
  await t.test('exact positive int32 strings survive while overflow, aliases and rounding are rejected',()=>{
   for(const value of ['1','100','2147483647'])assert.equal(refundTransactionId(value),value);
   for(const value of ['0','01','-1','+1','1.0','1e3',' 1','2147483648','9007199254740993','123456789012345678901234567890','PNC-1'])assert.throws(()=>refundTransactionId(value),/TRANSACTION_REVIEW/);
   assert.equal(refundRecordId({...source,facilityId:'another-store'} as typeof source),prepared.id);assert.notEqual(refundRecordId({...source,merchantKey:'5'.repeat(64)}),prepared.id);
  });
  await t.test('preparation and independent review create no manual payout hold',()=>{
   for(const value of [prepared,{...prepared,state:'REVIEWED',review:evidence('synthetic-reviewer')}]){const parsed=refundRecordSchema.parse(value);assert.equal(refundHoldsManualPayout(parsed),false);assert.equal(projectRefundRecord(parsed).providerAttempted,false);assert.equal(projectRefundRecord(parsed).dispatchAvailable,false)}
  });
  await t.test('only an explicit reservation holds and independently reviewed release preserves terminal history',()=>{
   const held=refundRecordSchema.parse({...prepared,state:'RESERVED',revision:3,review:evidence('synthetic-reviewer'),reservation:evidence('synthetic-reserver','2026-10-16T05:00:02Z')});assert.equal(refundHoldsManualPayout(held),true);
   const requested=refundRecordSchema.parse({...held,state:'RELEASE_REQUESTED',releaseRequest:evidence('synthetic-release-requester','2026-10-16T05:00:03Z')});assert.equal(refundHoldsManualPayout(requested),true);
   const released=refundRecordSchema.parse({...requested,state:'RELEASED',releaseReview:evidence('synthetic-release-reviewer','2026-10-16T05:00:04Z')});assert.equal(refundHoldsManualPayout(released),false);assert.equal(projectRefundRecord(released).retryAvailable,false);assert.equal(projectRefundRecord(released).financialPosting,false);
   assert.throws(()=>refundRecordSchema.parse({...requested,state:'RELEASED',releaseReview:evidence('synthetic-release-requester','2026-10-16T05:00:04Z')}));
  });
  await t.test('missing independent evidence, contradictory stages and earlier timestamps fail closed',()=>{
   for(const value of [{...prepared,state:'RESERVED'},{...prepared,state:'REVIEWED',review:evidence(prepared.preparedById)},{...prepared,review:evidence('synthetic-reviewer')},{...prepared,state:'RELEASED',review:evidence('synthetic-reviewer')},{...prepared,state:'REVIEWED',review:evidence('synthetic-reviewer','2026-10-16T04:00:00Z')},{...prepared,providerAttempted:true},{...prepared,dispatchAvailable:true},{...prepared,financialPosting:true}])assert.throws(()=>refundRecordSchema.parse(value));
  });
  await t.test('actual transition policy cannot reserve a draft, self-review or reopen released/withdrawn originals',()=>{
   const step=(value:NetcashRefundRecord,action:Parameters<typeof transitionRefundRecord>[1],actor='synthetic-reviewer',seconds=1)=>transitionRefundRecord(value,action,actor,'Synthetic approval only',new Date(Date.parse(value.createdAt)+seconds*1000));
   assert.throws(()=>step(prepared,'reserve'),/STATE/);assert.throws(()=>step(prepared,'review',prepared.preparedById),/INDEPENDENT/);
   const reviewed=step(prepared,'review'),held=step(reviewed,'reserve','synthetic-reviewer',2);assert.equal(held.state,'RESERVED');assert.equal(held.revision,3);
   assert.throws(()=>step(held,'withdraw',prepared.preparedById),/STATE/);
   const requested=step(held,'request-release','synthetic-release-requester',3);assert.throws(()=>step(requested,'approve-release','synthetic-release-requester',4),/INDEPENDENT/);
   const released=step(requested,'approve-release','synthetic-release-reviewer',4);assert.equal(released.state,'RELEASED');assert.equal(released.revision,5);assert.equal(refundHoldsManualPayout(released),false);
   for(const terminal of [released,step(prepared,'withdraw',prepared.preparedById)])for(const action of ['review','reserve','request-release']as const)assert.throws(()=>step(terminal,action),/STATE/);
  });
  await t.test('sealed records reject wrong store, tampered ciphertext, forged source and altered signature',()=>{
   const sealed=sealRefundRecord(prepared);assert.deepEqual(readRefundRecord(sealed,expected),prepared);
   assert.throws(()=>readRefundRecord(sealed,{...expected,facilityId:'foreign-store'}),/INTEGRITY_REVIEW/);
   assert.throws(()=>readRefundRecord({...sealed,signature:'0'.repeat(64)},expected),/INTEGRITY_REVIEW/);
   const parts=sealed.payloadEncrypted.split('.');parts[3]=(parts[3][0]==='A'?'B':'A')+parts[3].slice(1);assert.throws(()=>readRefundRecord({...sealed,payloadEncrypted:parts.join('.')},expected),/INTEGRITY_REVIEW/);
   assert.throws(()=>sealRefundRecord({...prepared,source:{...source,refundAmount:'101.00'}}));
   assert.ok(!JSON.stringify(sealed).includes(source.paymentId));
  });
 }finally{for(const[name,value]of [['AUTH_SECRET',before.auth],['INTEGRATION_CONFIG_ENCRYPTION_KEY',before.vault]]){if(value===undefined)delete process.env[name!];else process.env[name!]=value}}
});
