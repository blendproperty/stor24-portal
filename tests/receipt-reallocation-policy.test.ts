import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {planReceiptReallocation,receiptCents,requireReallocationReviewer,type ReallocationAccount,type ReceiptRoot} from "../src/lib/receipt-reallocation-policy";
const source:ReallocationAccount={id:"csourceaccount0000000000001",organisationId:"org",facilityId:"store",currency:"ZAR",balance:"-200.00",ledgerBalance:"-200.00",hasTenancy:true,inFlight:false};
const target:ReallocationAccount={...source,id:"ctargetaccount0000000000001",balance:"450.00",ledgerBalance:"450.00"};
const entryId="coriginalreceipt00000000001";
const root:ReceiptRoot={paymentId:"payment",organisationId:"org",facilityId:"store",currency:"ZAR",provider:"NETCASH",environment:"live",status:"SUCCEEDED",amount:"200.00",refunded:"0.00",postedExactlyOnce:true,verified:true};
const input={sourceAccountId:source.id,sourceEntryId:entryId,targetAccountId:target.id,amount:"75.25",reason:"Correct the documented allocation error",evidenceReference:"Synthetic finance evidence",requestKey:randomUUID()};
const position={entryId,accountId:source.id,organisationId:"org",facilityId:"store",remaining:"200.00"};
test("partial and full receipt moves conserve money and retain one external payment",()=>{
  const partial=planReceiptReallocation(input,source,target,root,[position]);
  assert.equal(partial.amountCents,7525);assert.equal(partial.sourceReceiptRemainingCents,12475);assert.equal(partial.sourceBalanceAfterCents,-12475);assert.equal(partial.targetBalanceAfterCents,37475);assert.equal(partial.totalReceiptRemainingCents,20000);assert.equal(partial.taxCents,0);
  assert.equal(partial.externalPaymentCreated,false);assert.equal(partial.providerRequest,false);assert.deepEqual(partial.outgoing,{type:"REVERSAL",reversalOfId:entryId});assert.deepEqual(partial.incoming,{type:"PAYMENT",rootPaymentId:root.paymentId});
  const full=planReceiptReallocation({...input,amount:"200.00"},source,target,root,[position]);assert.equal(full.sourceReceiptRemainingCents,0);assert.equal(full.sourceBalanceAfterCents,0);assert.equal(full.targetBalanceAfterCents,25000);
});
test("prior moves and actual partial refunds cannot be allocated twice",()=>{
  const positions=[{...position,remaining:"125.00"},{...position,entryId:"cmovedreceipt00000000000001",accountId:target.id,remaining:"75.00"}];
  assert.throws(()=>planReceiptReallocation({...input,amount:"125.01"},source,target,root,positions),/EXCEEDS_RECEIPT/);
  assert.equal(planReceiptReallocation({...input,amount:"125.00"},source,target,root,positions).sourceReceiptRemainingCents,0);
  const refunded={...root,status:"PARTIALLY_REFUNDED",refunded:"25.00"};
  assert.equal(planReceiptReallocation(input,source,target,refunded,[{...position,remaining:"175.00"}]).totalReceiptRemainingCents,17500);
  assert.throws(()=>planReceiptReallocation(input,source,target,refunded,[position]),/RECONCILIATION/);
});
test("foreign accounts, stale balances and unresolved work hold corrections",()=>{
  for(const changed of [{facilityId:"other"},{organisationId:"other"},{id:source.id}])assert.throws(()=>planReceiptReallocation(input,source,{...target,...changed},root,[position]),/SCOPE/);
  for(const changed of [{currency:"USD"},{hasTenancy:false},{inFlight:true},{balance:"-199.99"}])assert.throws(()=>planReceiptReallocation(input,{...source,...changed},target,root,[position]));
  assert.throws(()=>planReceiptReallocation(input,source,target,root,[{...position,facilityId:"other"}]),/SCOPE/);
});
test("unverified, sandbox, reversed, refunded and duplicate receipt evidence is held",()=>{
  for(const changed of [{verified:false},{postedExactlyOnce:false},{environment:"sandbox"},{provider:null,environment:"sandbox"},{status:"REVERSED"},{status:"REFUNDED",refunded:"200.00"},{currency:"USD"},{organisationId:"other"}])assert.throws(()=>planReceiptReallocation(input,source,target,{...root,...changed},[position]));
  assert.throws(()=>planReceiptReallocation(input,source,target,root,[position,position]),/RECONCILIATION/);
  assert.throws(()=>planReceiptReallocation(input,source,target,root,[{...position,remaining:"200.01"}]),/RECONCILIATION/);
});
test("whole cents, explicit targets and independent approval cannot be bypassed",()=>{
  for(const amount of ["0.00","1.001","1e2","-1.00","NaN","9999999999999.00"])assert.throws(()=>planReceiptReallocation({...input,amount},source,target,root,[position]));
  assert.equal(receiptCents("0.01"),1);assert.equal(receiptCents("999999999999.99"),99999999999999);assert.equal(receiptCents("-1.25",true),-125);
  assert.throws(()=>planReceiptReallocation(input,{...source,balance:"999999999999.99",ledgerBalance:"999999999999.99"},target,root,[position]),/AMOUNT/);
  assert.throws(()=>requireReallocationReviewer("same","same"),/INDEPENDENT/);requireReallocationReviewer("proposer","reviewer");
});
test("partial undo restores the original receipt through retained reverse-of-reversal evidence",()=>{
  const creditId="cmovedreceipt00000000000001",parent={id:"cpriorallocation00000000001",operation:"MOVE",paymentId:root.paymentId,sourceAccountId:source.id,targetAccountId:target.id,sourceLedgerEntryId:"cprioroutgoing0000000000001",targetLedgerEntryId:creditId,remaining:"75.00",verified:true};
  const movedSource={...target,balance:"375.00",ledgerBalance:"375.00"},restoredTarget={...source,balance:"-125.00",ledgerBalance:"-125.00"};
  const positions=[{...position,remaining:"125.00"},{...position,entryId:creditId,accountId:target.id,remaining:"75.00"}];
  const undo={...input,operation:"UNDO" as const,reversesId:parent.id,sourceAccountId:target.id,sourceEntryId:creditId,targetAccountId:source.id,amount:"25.00"};
  const planned=planReceiptReallocation(undo,movedSource,restoredTarget,root,positions,parent);
  assert.deepEqual(planned.incoming,{type:"REVERSAL",reversalOfId:parent.sourceLedgerEntryId});assert.equal(planned.sourceBalanceAfterCents,40000);assert.equal(planned.targetBalanceAfterCents,-15000);assert.equal(planned.sourceReceiptRemainingCents,5000);assert.equal(planned.externalPaymentCreated,false);
  for(const changed of [{verified:false},{operation:"UNDO"},{sourceAccountId:"other"},{paymentId:"other"},{remaining:"24.99"}])assert.throws(()=>planReceiptReallocation(undo,movedSource,restoredTarget,root,positions,{...parent,...changed}),/UNDO_REVIEW/);
  assert.throws(()=>planReceiptReallocation(undo,movedSource,restoredTarget,root,positions),/UNDO_REVIEW/);
  assert.throws(()=>planReceiptReallocation({...undo,reversesId:null},movedSource,restoredTarget,root,positions,parent));
});
