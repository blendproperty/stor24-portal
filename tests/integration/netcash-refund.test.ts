import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {db} from '../../src/lib/db';
import {previewAdjustment,requestAdjustment,decideAdjustment,recordRefundPayout} from '../../src/lib/adjustment-service';
import {previewStatement,settlementAction,settlementDetail} from '../../src/lib/settlement-service';
import {encryptIntegrationSecret} from '../../src/lib/integrations/integration-secret-vault';
import {merchantIdentity} from '../../src/lib/payments/netcash-statement';
import {previewNetcashRefund,prepareNetcashRefund,actOnNetcashRefund,netcashRefundHistory} from '../../src/lib/payments/netcash-refund-service';
import {NETCASH_REFUND_DOMAIN} from '../../src/lib/payments/netcash-refund-policy';
import {southAfricaDateKey} from '../../src/lib/south-africa-time';

test('isolated native refund preparation, explicit hold and independently reviewed zero-dispatch release',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 const names=['AUTH_SECRET','INTEGRATION_CONFIG_ENCRYPTION_KEY','NETCASH_REFUND_PREPARATION_ENABLED','NETCASH_REFUND_RESERVATION_ENABLED'];const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 process.env.AUTH_SECRET=randomBytes(32).toString('hex');process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');process.env.NETCASH_REFUND_PREPARATION_ENABLED='true';process.env.NETCASH_REFUND_RESERVATION_ENABLED='false';
 const fetchBefore=globalThis.fetch;let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('No external request is permitted by refund preparation')};
 async function fixture(){
  const key=randomUUID(),org=await db.organisation.create({data:{name:'Synthetic refund CI',slug:key}}),facility=await db.facility.create({data:{organisationId:org.id,code:key,name:'Synthetic store'}});
  const preparer=await db.user.create({data:{organisationId:org.id,name:'Synthetic preparer',email:key+'@example.invalid'}}),reviewer=await db.user.create({data:{organisationId:org.id,name:'Synthetic reviewer',email:'review-'+key+'@example.invalid'}});
  const role=await db.role.create({data:{organisationId:org.id,name:'Synthetic refund authority',permissions:['adjustments.view','payments.refund_prepare','payments.refund_review','payments.refund_reserve','payments.refund_release_review']}});
  await db.roleAssignment.createMany({data:[preparer,reviewer].map(user=>({userId:user.id,facilityId:facility.id,roleId:role.id}))});
  const customer=await db.customer.create({data:{organisationId:org.id,firstName:'Synthetic only'}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:key,balance:-200}});
  await db.tenancy.create({data:{customerId:customer.id,facilityId:facility.id,accountId:account.id,status:'ACTIVE',startDate:new Date('2026-01-01')}});
  const merchantKey=merchantIdentity(org.id,'live','50000000000'),payment=await db.payment.create({data:{accountId:account.id,amount:200,currency:'ZAR',method:'CARD',provider:'NETCASH',environment:'live',providerMerchantKey:merchantKey,status:'SUCCEEDED',idempotencyKey:key}});
  const entry=await db.ledgerEntry.create({data:{accountId:account.id,type:'PAYMENT',amount:200,description:'Isolated synthetic receipt; no actual payment',effectiveAt:new Date('2026-01-01'),metadata:{paymentId:payment.id,verifiedStatus:true,environment:'live'}}});
  const connection=await db.integrationConnection.create({data:{organisationId:org.id,facilityId:facility.id,category:'PAYMENTS',provider:'NETCASH',status:'CONNECTED',config:{environment:'live',merchantAccountEncrypted:encryptIntegrationSecret('50000000000')}}});
  const scope={organisationId:org.id,userId:preparer.id,unrestrictedFacilities:false,facilityIds:[facility.id]},reviewScope={...scope,userId:reviewer.id},statementScope={...scope,unrestrictedFacilities:true};
  const raw=['2026-01-01\tOBL\t0\tOpening\t0\t+\t0','2026-01-01\tPNC\t1234\tSynthetic card receipt\t200\t+\t0','2026-01-01\tCBL\t0\tClosing\t200\t+\t0'].join('\n'),statementInput={connectionId:connection.id,date:'2026-01-01',raw,sourceReference:'Synthetic original full statement'};
  const preview=await previewStatement(statementScope,statementInput),statement=await settlementAction(statementScope,{action:'import',...statementInput,fingerprint:preview.fingerprint,confirm:true})as{id:string};
  const detail=await settlementDetail(statementScope,statement.id),lineId=detail.lines[0].id;
  await settlementAction(statementScope,{action:'resolve',id:statement.id,revision:detail.revision,lineId,targetId:payment.id,reference:'Synthetic original receipt match',merchantConfirmed:false,requestKey:randomUUID()});
  await settlementAction({...statementScope,userId:reviewer.id},{action:'approve',id:statement.id,revision:1,reference:'Synthetic independent statement approval',confirm:true});
  const adjustmentInput={accountId:account.id,kind:'REFUND',amount:'60.00',taxAmount:'0',sourceEntryId:entry.id,reason:'Synthetic independently approved refund',evidenceReference:'Synthetic original receipt'},adjustmentPreview=await previewAdjustment(scope,adjustmentInput),adjustment=await requestAdjustment(scope,adjustmentInput,adjustmentPreview.fingerprint,randomUUID());
  await decideAdjustment(reviewScope,adjustment.id,'approve','Synthetic original refund approval');
  return{org,facility,account,payment,entry,connection,role,scope,reviewScope,lineId,statement,adjustment,input:{facilityId:facility.id,adjustmentId:adjustment.id,lineId}};
 }
 async function prepared(){const f=await fixture(),preview=await previewNetcashRefund(f.scope,f.input),record=await prepareNetcashRefund(f.scope,{...f.input,previewHash:preview.previewHash,reference:'Synthetic native preparation',confirmed:true});return{...f,preview,record};}
 async function action(f:Awaited<ReturnType<typeof prepared>>,record:{id:string;revision:number},action:Parameters<typeof actOnNetcashRefund>[1]['action'],scope=f.reviewScope){return actOnNetcashRefund(scope,{facilityId:f.facility.id,id:record.id,revision:record.revision,action,reference:'Synthetic independently checked '+action,confirmed:true});}
 try{
  await t.test('preview and save are read-only financially, idempotent, and do not block an actual manual payout',async()=>{
   const f=await prepared();assert.equal(f.record.manualPayoutHeld,false);assert.equal(f.record.providerAttempted,false);
   assert.equal((await prepareNetcashRefund(f.scope,{...f.input,previewHash:f.preview.previewHash,reference:'Synthetic native preparation',confirmed:true})).id,f.record.id);
   assert.equal((await recordRefundPayout(f.reviewScope,f.adjustment.id,'SYNTHETIC-ONLY-'+f.account.id,southAfricaDateKey(new Date()))).status,'POSTED');assert.equal((await db.account.findUniqueOrThrow({where:{id:f.account.id}})).balance.toString(),'-140');
   await assert.rejects(action(f,f.record,'review'),/ADJUSTMENT_REVIEW/);
  });
  await t.test('default-off reservation cannot hold; explicit reservation blocks manual payout and approved cancellation even after flags are disabled',async()=>{
   const f=await prepared(),reviewed=await action(f,f.record,'review');await assert.rejects(action(f,reviewed,'reserve'),/RESERVATION_DISABLED/);
   process.env.NETCASH_REFUND_RESERVATION_ENABLED='true';const held=await action(f,reviewed,'reserve');assert.equal(held.manualPayoutHeld,true);
   process.env.NETCASH_REFUND_RESERVATION_ENABLED='false';process.env.NETCASH_REFUND_PREPARATION_ENABLED='false';
   await assert.rejects(recordRefundPayout(f.reviewScope,f.adjustment.id,'SYNTHETIC-NOT-PAID',southAfricaDateKey(new Date())),/REFUND_RESERVED/);await assert.rejects(decideAdjustment(f.reviewScope,f.adjustment.id,'cancel','Synthetic unpaid confirmation',true),/REFUND_RESERVED/);
   const requested=await action(f,held,'request-release',f.scope);await assert.rejects(action(f,requested,'approve-release',f.scope),/INDEPENDENT/);
   const released=await action(f,requested,'approve-release');assert.equal(released.state,'RELEASED');assert.equal(released.manualPayoutHeld,false);assert.equal(released.providerAttempted,false);assert.equal(released.financialPosting,false);
   assert.equal((await db.account.findUniqueOrThrow({where:{id:f.account.id}})).balance.toString(),'-200');assert.equal((await db.payment.findUniqueOrThrow({where:{id:f.payment.id}})).status,'SUCCEEDED');assert.equal(await db.ledgerEntry.count({where:{accountId:f.account.id}}),1);
   assert.equal((await recordRefundPayout(f.reviewScope,f.adjustment.id,'SYNTHETIC-RELEASED-'+f.account.id,southAfricaDateKey(new Date()))).status,'POSTED');assert.equal((await netcashRefundHistory(f.scope,f.facility.id)).rows[0].state,'RELEASED');process.env.NETCASH_REFUND_PREPARATION_ENABLED='true';
  });
  await t.test('wrong store, current role revocation and changed original statement reject without records or transport',async()=>{
   const f=await fixture();await assert.rejects(previewNetcashRefund({...f.scope,facilityIds:[]},f.input),/FORBIDDEN/);
   await db.role.update({where:{id:f.role.id},data:{permissions:['adjustments.view']}});await assert.rejects(previewNetcashRefund(f.scope,f.input),/FORBIDDEN/);
   await db.role.update({where:{id:f.role.id},data:{permissions:['adjustments.view','payments.refund_prepare']}});await db.settlementStatement.update({where:{id:f.statement.id},data:{sha256:'0'.repeat(64)}});await assert.rejects(previewNetcashRefund(f.scope,f.input),/SOURCE_INTEGRITY/);assert.equal(await db.configurationProfile.count({where:{organisationId:f.org.id,domain:NETCASH_REFUND_DOMAIN}}),0);
  });
  assert.equal(outbound,0);
 }finally{globalThis.fetch=fetchBefore;for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name]}await db.$disconnect();}
});
