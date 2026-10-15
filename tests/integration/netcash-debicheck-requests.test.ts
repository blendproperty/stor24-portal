import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import {encryptIntegrationSecret} from '../../src/lib/integrations/integration-secret-vault';
import {observeDebiCheckTemplate,reviewDebiCheckTemplate} from '../../src/lib/payments/netcash-debicheck-template-service';
import {previewDebiCheckRequest,saveDebiCheckRequest,listTenantDebiCheckRequests,listStaffDebiCheckRequests,reviewDebiCheckRequest,withdrawDebiCheckRequest} from '../../src/lib/payments/netcash-debicheck-request-service';
import {previewCardAutopayRequest,saveCardAutopayRequest} from '../../src/lib/payments/card-autopay-service';

test('isolated DebiCheck tenant consent and staff review never submit authentication or change financial records',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 process.env.AUTH_SECRET='synthetic-debicheck-request-ci-secret-32';process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='synthetic-debicheck-request-ci-vault-32';process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED='true';
 const now=new Date('2026-10-15T04:00:00.000Z'),startDate='2026-11-01',schedule={startDate,cycles:12};
 const payer={debtorIdentification:'SYNTHETIC-PASSPORT',debtorIdentificationCode:'P',accountName:'Synthetic tenant',bankAccountName:'Synthetic holder',branchCode:'198765',bankAccountNumber:'990012345',bankAccountType:'Current',mobileNumber:'0820000000',emailAddress:''};
 const original=globalThis.fetch;let providerReads=0;globalThis.fetch=async()=>{throw Error('Real provider transport forbidden')};
 const request:typeof fetch=async(_url,options)=>{
  providerReads++;assert.equal((options!.headers as Record<string,string>).SOAPAction,'"http://tempuri.org/INIWS_NIF/DebiCheckRetrieveMandateTemplateDetail"');
  const fields={AdjustmentAmount:'0.0000',AdjustmentCategory:'N',AdjustmentRuleIndicator:'Y',AdjustmentType:'AMNT',AuthenticationType:'BATCH',CollectionFrequency:'MNTH',CollectionFrequencyDayCode:'MNTH_01',DebitEntryClassCode:'0036',DebitValueType:'USAGE BASED',DebtorAuthCode:'Batch (TT2)',DebtorAuthenticationRequired:'0227',InstallmentOccurrence:'RCUR',RMS:'False',TemplateName:'Synthetic template',TrackingDayCode:'01 Day tracking',TrackingIndicator:'Y'};
  return new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><DebiCheckRetrieveMandateTemplateDetailResponse xmlns="http://tempuri.org/"><DebiCheckRetrieveMandateTemplateDetailResult xmlns:a="http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS"><a:ErrorCode>000</a:ErrorCode><a:TemplateId>NCDCT000000001</a:TemplateId>${Object.entries(fields).map(([k,v])=>`<a:${k}>${v}</a:${k}>`).join('')}<a:InitiationDayOptions xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><b:string>MNTH_01</b:string></a:InitiationDayOptions></DebiCheckRetrieveMandateTemplateDetailResult></DebiCheckRetrieveMandateTemplateDetailResponse></s:Body></s:Envelope>`);
 };
 async function fixture(){
  const key=randomUUID(),org=await db.organisation.create({data:{name:'DebiCheck request CI',slug:key}}),store=await db.facility.create({data:{organisationId:org.id,code:key,name:'Synthetic store'}}),other=await db.facility.create({data:{organisationId:org.id,code:randomUUID(),name:'Other store'}});
  const customer=await db.customer.create({data:{organisationId:org.id,firstName:'Synthetic',email:key+'@example.invalid',emailVerifiedAt:now}}),users=await Promise.all(['Creator','Reviewer','Staff'].map(name=>db.user.create({data:{organisationId:org.id,name,email:randomUUID()+'@example.invalid'}})));
  const unitType=await db.unitType.create({data:{facilityId:store.id,name:'Synthetic',features:[]}}),unit=await db.unit.create({data:{facilityId:store.id,unitTypeId:unitType.id,number:'101',monthlyRate:950,status:'OCCUPIED'}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:'DC-'+key}});
  const tenancy=await db.tenancy.create({data:{facilityId:store.id,customerId:customer.id,accountId:account.id,status:'ACTIVE',paymentMethod:'CARD',startDate:new Date('2026-01-01'),occupancies:{create:{unitId:unit.id,status:'ACTIVE',monthlyRate:950,startDate:new Date('2026-01-01')}}}});
  await db.document.create({data:{tenancyId:tenancy.id,type:'LEASE_AGREEMENT',status:'SIGNED',storageKey:'synthetic://lease',provider:'BLENDSIGN',externalId:key,signedAt:now}});
  const profile=await db.configurationProfile.create({data:{organisationId:org.id,facilityId:store.id,domain:'MONTHLY_BILLING',name:account.id,status:'READY',config:{firstPeriod:'2026-11',proration:'FULL_MONTH',taxPercent:15,rentTaxable:true,insuranceEnabled:false,insuranceTaxable:false,charges:[],discount:null,approvalReference:'Synthetic approved fixture'}}});
  const connection=await db.integrationConnection.create({data:{organisationId:org.id,category:'PAYMENTS',provider:'NETCASH',status:'HEALTHY',config:{environment:'test',debitOrderServiceKeyEncrypted:encryptIntegrationSecret(randomUUID()),merchantAccountEncrypted:encryptIntegrationSecret('53000000000'),transactionProcessingEnabled:false}}});
  const scope={organisationId:org.id,userId:users[0].id,facilityIds:[store.id],unrestrictedFacilities:false},reviewer={...scope,userId:users[1].id},staff={...scope,userId:users[2].id};
  const template=await observeDebiCheckTemplate(scope,{facilityId:store.id,templateId:'NCDCT000000001'},request,now);await reviewDebiCheckTemplate(reviewer,{id:template.id,confirmed:true},request,now);
  const session={organisationId:org.id,email:customer.email!,customerIds:[customer.id]},input={accountId:account.id,templateObservationId:template.id,startDate,payer:{...payer,emailAddress:customer.email!}};
  return{org,store,other,customer,users,account,tenancy,profile,connection,scope,staff,session,input};
 }
 try{
 await t.test('authenticated consent, idempotent save, encrypted details and separate staff review retain financial baselines',async()=>{
  const f=await fixture(),baseline={accounts:await db.account.findMany({orderBy:{id:'asc'}}),payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()},reads=providerReads,p=await previewDebiCheckRequest(f.session,f.input,now);
  assert.equal(p.monthlyAmount,'950.00');assert.equal(p.authenticationSubmitted,false);assert.equal(p.collectionEnabled,false);
  await assert.rejects(saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:false},now),/CONSENT_REQUIRED/);
  const saved=await saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},new Date(now.getTime()+1000));
  assert.equal((await saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},now)).id,saved.id);
  const retained=await db.configurationProfile.findUniqueOrThrow({where:{id:saved.id}}),text=JSON.stringify(retained.config);for(const value of [payer.debtorIdentification,payer.bankAccountNumber,payer.bankAccountName,payer.mobileNumber,f.customer.email!])assert.ok(!text.includes(value));
  assert.equal(await db.auditEvent.count({where:{entityId:saved.id,action:'netcash.debicheck_request_consented',actorId:null}}),1);
  const reviewed=await reviewDebiCheckRequest(f.staff,{id:saved.id,confirmed:true},new Date(now.getTime()+2000));assert.equal(reviewed.status,'REVIEWED');assert.equal(reviewed.authenticationSubmitted,false);assert.equal(reviewed.collectionEnabled,false);
  assert.deepEqual((await db.configurationProfile.findUniqueOrThrow({where:{id:saved.id}})).config,retained.config);
  assert.equal((await listTenantDebiCheckRequests(f.session,f.account.id,now)).requests[0].id,saved.id);assert.equal((await listStaffDebiCheckRequests(f.staff,f.store.id)).requests[0].accountNumber,f.account.accountNumber);
  assert.equal(providerReads,reads);assert.deepEqual({accounts:await db.account.findMany({orderBy:{id:'asc'}}),payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()},baseline);
 });
 await t.test('ownership, scope, revoked verification, stale amounts, changed merchant and copied tickets are held',async()=>{
  const f=await fixture(),p=await previewDebiCheckRequest(f.session,f.input,now);
  for(const session of [{...f.session,customerIds:[]},{...f.session,email:'other@example.invalid'},{...f.session,organisationId:'other'}])await assert.rejects(saveDebiCheckRequest(session,{accountId:f.account.id,preview:p.preview,accepted:true},now),/TENANT_NOT_FOUND/);
  await assert.rejects(saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:{...p.preview,monthlyAmount:'1.00'},accepted:true},now),/INTEGRITY_REVIEW/);
  await assert.rejects(saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},new Date(now.getTime()+601000)),/PREVIEW_EXPIRED/);
  await db.occupancy.updateMany({where:{tenancyId:f.tenancy.id},data:{monthlyRate:951}});await assert.rejects(saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},now),/SOURCE_CHANGED/);
  await db.occupancy.updateMany({where:{tenancyId:f.tenancy.id},data:{monthlyRate:950}});const fresh=await previewDebiCheckRequest(f.session,f.input,now);await db.integrationConnection.update({where:{id:f.connection.id},data:{status:'DISCONNECTED'}});await assert.rejects(saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:fresh.preview,accepted:true},now),/CONFIGURATION/);
  await db.customer.update({where:{id:f.customer.id},data:{emailVerifiedAt:null}});await assert.rejects(listTenantDebiCheckRequests(f.session,f.account.id,now),/TENANT_NOT_FOUND/);
  await assert.rejects(listStaffDebiCheckRequests({...f.staff,facilityIds:[f.other.id]},f.store.id),/FORBIDDEN/);
 });
 await t.test('self review is refused, withdrawal retains old consent and permits one new separately consented request',async()=>{
  const f=await fixture(),p=await previewDebiCheckRequest(f.session,f.input,now),saved=await saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},now);
  await db.user.update({where:{id:f.staff.userId},data:{email:f.customer.email!}});await assert.rejects(reviewDebiCheckRequest(f.staff,{id:saved.id,confirmed:true},now),/INDEPENDENT_REVIEW/);
  await withdrawDebiCheckRequest(f.session,f.account.id,saved.id);assert.equal((await withdrawDebiCheckRequest(f.session,f.account.id,saved.id)).status,'WITHDRAWN');
  const fresh=await previewDebiCheckRequest(f.session,f.input,now),renewed=await saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:fresh.preview,accepted:true},now);assert.notEqual(renewed.id,saved.id);assert.equal((await listTenantDebiCheckRequests(f.session,f.account.id,now)).requests.length,2);
  await assert.rejects(reviewDebiCheckRequest(f.staff,{id:saved.id,confirmed:true},now),/SOURCE_CHANGED/);
 });
 await t.test('competing bank/card requests share an account lock and cannot both be retained as open',async()=>{
  const f=await fixture(),p=await previewDebiCheckRequest(f.session,f.input,now),card=await previewCardAutopayRequest(f.session,f.account.id,schedule,now);
  const result=await Promise.allSettled([saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},now),saveCardAutopayRequest(f.session,f.account.id,schedule,card.fingerprint,true,now)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await db.configurationProfile.count({where:{organisationId:f.org.id,domain:{in:['NETCASH_DEBICHECK_REQUEST','CARD_AUTOPAY_REQUEST']},status:'REQUESTED'}}),1);
 });
 await t.test('review audit failure rolls back the state and disabled preparation retains readable history and withdrawal',async()=>{
  const f=await fixture(),p=await previewDebiCheckRequest(f.session,f.input,now),saved=await saveDebiCheckRequest(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},now);
  await db.$executeRawUnsafe(`CREATE FUNCTION ci_reject_debicheck_request_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('netcash.debicheck_request_reviewed','netcash.debicheck_request_consented') THEN RAISE EXCEPTION 'Synthetic review audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER ci_reject_debicheck_request_review BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ci_reject_debicheck_request_review()`);
  try{await assert.rejects(reviewDebiCheckRequest(f.staff,{id:saved.id,confirmed:true},now),/Synthetic review audit failure/);assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:saved.id}})).status,'REQUESTED');const second=await fixture(),fresh=await previewDebiCheckRequest(second.session,second.input,now);await assert.rejects(saveDebiCheckRequest(second.session,{accountId:second.account.id,preview:fresh.preview,accepted:true},now),/Synthetic review audit failure/);assert.equal(await db.configurationProfile.count({where:{id:fresh.id}}),0);}finally{await db.$executeRawUnsafe(`DROP TRIGGER ci_reject_debicheck_request_review ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION ci_reject_debicheck_request_review()`);}
  process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED='false';await assert.rejects(previewDebiCheckRequest(f.session,f.input,now),/PREPARATION_DISABLED/);assert.equal((await listTenantDebiCheckRequests(f.session,f.account.id,now)).requests[0].id,saved.id);await withdrawDebiCheckRequest(f.session,f.account.id,saved.id);process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED='true';
 });
 }finally{globalThis.fetch=original;delete process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED;await db.$disconnect()}
});
