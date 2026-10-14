import assert from 'node:assert/strict';import test from 'node:test';import {randomUUID,createHash} from 'node:crypto';
import {db} from '../../src/lib/db';import {postedRecurringChargeReport} from '../../src/lib/posted-recurring-charge-service';import {reportParametersSchema} from '../../src/lib/reporting';
test('isolated original posted billing report preserves historical amounts, scope and financial records',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 const org=await db.organisation.create({data:{name:'Posted billing CI',slug:randomUUID()}}),facilities=await Promise.all(['Owned','Other'].map(name=>db.facility.create({data:{organisationId:org.id,name,code:randomUUID()}})));
 const scope={organisationId:org.id,userId:'synthetic-reader',facilityIds:[facilities[0].id],unrestrictedFacilities:false},period='2026-09',fingerprint='a'.repeat(64),effectiveAt=new Date('2026-08-31T22:00:00Z');
 async function fixture(index:number){
  const customer=await db.customer.create({data:{organisationId:org.id,firstName:'Synthetic'}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID(),balance:48.5}}),tenancy=await db.tenancy.create({data:{accountId:account.id,customerId:customer.id,facilityId:facilities[index].id,status:'CLOSED',startDate:new Date('2025-01-01'),endDate:new Date('2026-10-01')}});
  const content='<p>Synthetic original invoice</p>',invoiceNumber='INV-SYNTHETIC-'+account.id,document=await db.document.create({data:{tenancyId:tenancy.id,type:'INVOICE',status:'GENERATED',content,sha256:createHash('sha256').update(content).digest('hex'),storageKey:'inline:synthetic',externalId:invoiceNumber,idempotencyKey:`monthly-invoice:${account.id}:${period}`}});
  const metadata={billingPeriod:period,invoiceNumber,approvalReference:'SYNTHETIC-APPROVAL',fingerprint};
  await db.ledgerEntry.create({data:{accountId:account.id,type:'CHARGE',amount:115,taxAmount:15,description:'Original monthly rent',effectiveAt,externalRef:`RENT-${period}`,metadata:{...metadata,chargeKey:'rent:unit'}}});
  await db.ledgerEntry.create({data:{accountId:account.id,type:'CREDIT',amount:11.5,taxAmount:1.5,description:'Original discount',effectiveAt,externalRef:`BILL-${period}-discount`,metadata:{...metadata,chargeKey:'discount'}}});
  // Later corrections and receipts share a period but are not original bill lines.
  await db.ledgerEntry.create({data:{accountId:account.id,type:'CREDIT',amount:5,taxAmount:0,description:'Later correction',effectiveAt:new Date('2026-09-10'),externalRef:'ADJUSTMENT-SYNTHETIC',metadata}});
  await db.ledgerEntry.create({data:{accountId:account.id,type:'PAYMENT',amount:50,description:'Synthetic later receipt',effectiveAt:new Date('2026-09-10'),externalRef:'PAYMENT-SYNTHETIC',metadata}});
  await db.auditEvent.create({data:{organisationId:org.id,facilityId:facilities[index].id,action:'billing.month_posted',entityType:'Account',entityId:account.id,occurredAt:new Date('2026-09-05'),after:{period,invoiceNumber,documentId:document.id,total:103.5,taxTotal:13.5,fingerprint}}});
  return{account,tenancy,document};
 }
 const a=await fixture(0),b=await fixture(1),parameters=reportParametersSchema.parse({reportKey:'posted-recurring-charges',from:'2026-09-01',to:'2026-09-30',format:'JSON'});
 const before={accounts:await db.account.findMany({where:{customer:{organisationId:org.id}},orderBy:{id:'asc'}}),ledger:await db.ledgerEntry.findMany({where:{accountId:{in:[a.account.id,b.account.id]}},orderBy:{id:'asc'}}),payments:await db.payment.count()};
 try{
 await t.test('ended tenancies retain original charge/tax signs and never include another store, later corrections or receipts',async()=>{
  const rows=await postedRecurringChargeReport(scope,parameters);assert.equal(rows.length,2);assert.ok(rows.every(row=>row.accountId===a.account.id&&row.status==='POSTED'));assert.deepEqual(rows.map(row=>row.amount).sort(),['-11.50','115.00']);assert.ok(rows.every(row=>row.financialReceipt===false&&row.correctionsIncluded===false));
 });
 await t.test('current plan changes cannot reprice original posted history',async()=>{
  await db.configurationProfile.create({data:{organisationId:org.id,facilityId:facilities[0].id,domain:'MONTHLY_BILLING',name:a.account.id,status:'READY',config:{firstPeriod:'2026-10',proration:'FULL_MONTH',taxPercent:15,rentTaxable:true,insuranceEnabled:false,insuranceTaxable:false,charges:[{code:'LATER',name:'Later price plan',amount:999,taxable:true}],discount:null,approvalReference:'LATER-APPROVAL'}}});
  assert.equal((await postedRecurringChargeReport(scope,parameters)).find(row=>row.category==='RENT')?.amount,'115.00');
 });
 await t.test('date windows use SAST billing effective dates while explicit store requests enforce scope',async()=>{
  assert.deepEqual(await postedRecurringChargeReport(scope,{...parameters,from:'2026-09-02'}),[]);await assert.rejects(postedRecurringChargeReport(scope,{...parameters,facilityId:facilities[1].id}),/FORBIDDEN/);assert.deepEqual(await postedRecurringChargeReport({...scope,organisationId:'unrelated'},parameters),[]);
 });
 await t.test('changed original invoice content produces one held invoice with no amounts',async()=>{
  await db.document.update({where:{id:a.document.id},data:{content:'Changed synthetic invoice'}});const rows=await postedRecurringChargeReport(scope,parameters);assert.equal(rows.length,1);assert.equal(rows[0].status,'REVIEW');assert.equal(rows[0].amount,null);
 });
 assert.deepEqual({accounts:await db.account.findMany({where:{customer:{organisationId:org.id}},orderBy:{id:'asc'}}),ledger:await db.ledgerEntry.findMany({where:{accountId:{in:[a.account.id,b.account.id]}},orderBy:{id:'asc'}}),payments:await db.payment.count()},before);
 }finally{await db.$disconnect()}
});
