import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import {encryptIntegrationSecret} from '../../src/lib/integrations/integration-secret-vault';
import {observeDebiCheckTemplate,reviewDebiCheckTemplate} from '../../src/lib/payments/netcash-debicheck-template-service';
import {previewDebiCheckRequest,saveDebiCheckRequest,reviewDebiCheckRequest} from '../../src/lib/payments/netcash-debicheck-request-service';
import {previewTenantBankConsent,saveTenantBankConsent,withdrawTenantBankConsent,reviewBankConsent,listTenantBankConsents,listStaffBankConsents} from '../../src/lib/payments/netcash-debicheck-bank-consent-service';
import {readDebiCheckRequest,privateDebiCheckTerms} from '../../src/lib/payments/netcash-debicheck-request-policy';
import {bankAuthenticationPayerFingerprint} from '../../src/lib/payments/netcash-debicheck-bank-test-approval';
import {encryptBankConsent} from '../../src/lib/payments/netcash-debicheck-bank-consent-record';
import {DEBICHECK_BANK_CONSENT_DOMAIN,prepareBankAuthenticationConsent,acceptBankAuthenticationConsent} from '../../src/lib/payments/netcash-debicheck-bank-consent-policy';

test('isolated native bank-consent preparation keeps provider and financial actions disabled',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 process.env.AUTH_SECRET='synthetic-debicheck-request-ci-secret-32';process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='synthetic-debicheck-request-ci-vault-32';process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED='true';
 process.env.NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED='true';
 const now=new Date('2026-10-16T04:00:00.000Z'),startDate='2026-11-01';
 const payer={debtorIdentification:'SYNTHETIC-PASSPORT',debtorIdentificationCode:'P',accountName:'Synthetic tenant',bankAccountName:'Synthetic holder',branchCode:'198765',bankAccountNumber:'990012345',bankAccountType:'Current',mobileNumber:'0820000000',emailAddress:''};
 const original=globalThis.fetch;let providerReads=0;globalThis.fetch=async()=>{throw Error('Real provider transport forbidden')};
 const request:typeof fetch=async(_url,options)=>{
  providerReads++;assert.equal((options!.headers as Record<string,string>).SOAPAction,'"http://tempuri.org/INIWS_NIF/DebiCheckRetrieveMandateTemplateDetail"');
  const fields={AdjustmentAmount:'0.0000',AdjustmentCategory:'N',AdjustmentRuleIndicator:'Y',AdjustmentType:'AMNT',AuthenticationType:'SYNTHETIC_SINGLE',CollectionFrequency:'MNTH',CollectionFrequencyDayCode:'MNTH_01',DebitEntryClassCode:'0036',DebitValueType:'USAGE BASED',DebtorAuthCode:'SYNTHETIC_SINGLE',DebtorAuthenticationRequired:'0227',InstallmentOccurrence:'RCUR',RMS:'False',TemplateName:'Synthetic template',TrackingDayCode:'01 Day tracking',TrackingIndicator:'Y'};
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
  const setup=await previewDebiCheckRequest(session,input,now);await saveDebiCheckRequest(session,{accountId:account.id,preview:setup.preview,accepted:true},now);await reviewDebiCheckRequest(staff,{id:setup.id,confirmed:true},now);
  const stored=await db.configurationProfile.findUniqueOrThrow({where:{id:setup.id}}),definition=readDebiCheckRequest(stored.config,{id:stored.id,organisationId:org.id,facilityId:store.id,accountId:account.id});
  process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=JSON.stringify({version:1,purpose:'BANK_AUTHENTICATION_TEST_ONLY',authenticationMode:'TT1_SYNCHRONOUS',organisationId:org.id,facilityId:store.id,accountId:account.id,customerId:customer.id,merchantHash:definition.merchantHash,templateId:definition.templateId,templateSourceHash:definition.templateSourceHash,payerFingerprint:bankAuthenticationPayerFingerprint(org.id,store.id,privateDebiCheckTerms(definition)),monthlyAmount:definition.monthlyAmount,startDate:definition.startDate,approvedAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),providerEvidenceReference:'SYNTHETIC ONLY NOT PROVIDER ACCEPTANCE',approvalRecordedBy:'Synthetic isolated fixture',collectionAuthorised:false});
  const role=await db.role.create({data:{organisationId:org.id,name:'Synthetic bank review '+key,permissions:['payments.view','payments.bank_auth_review']}}),assignment=await db.roleAssignment.create({data:{userId:staff.userId,facilityId:store.id,roleId:role.id}});
  return{org,store,other,customer,users,account,tenancy,profile,connection,scope,staff,session,input,setup,assignment};
 }

 async function preview(f:Awaited<ReturnType<typeof fixture>>){return previewTenantBankConsent(f.session,{accountId:f.account.id,requestId:f.setup.id},now)}
 const later=new Date(now.getTime()+1000);
 try{
  const baseline={payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()};
  await t.test('native preview/save/review is encrypted, exact, idempotent and never provider authority',async()=>{
   const f=await fixture(),reads=providerReads,p=await preview(f),input={accountId:f.account.id,preview:p.preview,accepted:true};
   const saved=await saveTenantBankConsent(f.session,input,later);assert.equal(saved.status,'CONSENTED');
   assert.equal((await saveTenantBankConsent(f.session,input,later)).id,saved.id);
   const row=await db.configurationProfile.findUniqueOrThrow({where:{id:saved.id}}),text=JSON.stringify(row.config);
   for(const privateValue of [payer.bankAccountNumber,payer.mobileNumber,payer.debtorIdentification,p.consentText])assert.ok(!text.includes(privateValue));
   assert.equal(await db.auditEvent.count({where:{entityId:saved.id,action:'netcash.debicheck_bank_consent_saved'}}),1);
   const reviewed=await reviewBankConsent(f.staff,{accountId:f.account.id,id:saved.id,confirmed:true},later);assert.equal(reviewed.status,'REVIEWED');
   for(const flag of ['providerActionPerformed','collectionEnabled','financialReceipt','retryAllowed','attemptRecorded']as const)assert.equal(reviewed[flag],false);
   assert.equal(providerReads,reads);assert.equal(await db.auditEvent.count({where:{entityId:f.setup.id,action:{in:['netcash.debicheck_bank_authentication_consented','netcash.debicheck_bank_authentication_reviewed']}}}),0);
  });
  await t.test('missing separate test approval and changed billing do not produce consent',async()=>{
   const f=await fixture(),approval=process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL!;delete process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL;
   await assert.rejects(preview(f),/TEST_APPROVAL_REQUIRED/);process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=approval;
   const p=await preview(f);await db.configurationProfile.update({where:{id:f.profile.id},data:{status:'NEEDS_REVIEW'}});
   await assert.rejects(saveTenantBankConsent(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},later),/APPROVED_BILLING_REQUIRED/);
   assert.equal(await db.configurationProfile.count({where:{id:p.id}}),0);
  });
  await t.test('current role revocation and same-customer reviewer cannot approve',async()=>{
   const f=await fixture(),p=await preview(f);await saveTenantBankConsent(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},later);
   await db.roleAssignment.delete({where:{id:f.assignment.id}});await assert.rejects(reviewBankConsent(f.staff,{accountId:f.account.id,id:p.id,confirmed:true},later),/FORBIDDEN/);
   assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:p.id}})).status,'CONSENTED');
   await db.roleAssignment.create({data:{userId:f.staff.userId,roleId:f.assignment.roleId,facilityId:f.store.id}});await db.user.update({where:{id:f.staff.userId},data:{email:f.customer.email!}});
   await assert.rejects(reviewBankConsent(f.staff,{accountId:f.account.id,id:p.id,confirmed:true},later),/INDEPENDENT_REVIEW_REQUIRED/);
  });
  await t.test('withdrawal remains available when preparation is off; duplicate save never reopens it',async()=>{
   const f=await fixture(),p=await preview(f),input={accountId:f.account.id,preview:p.preview,accepted:true};await saveTenantBankConsent(f.session,input,later);
   process.env.NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED='false';
   assert.equal((await withdrawTenantBankConsent(f.session,{accountId:f.account.id,id:p.id},later)).status,'WITHDRAWN');
   assert.equal((await listTenantBankConsents(f.session,{accountId:f.account.id},later)).records[0].status,'WITHDRAWN');
   process.env.NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED='true';assert.equal((await saveTenantBankConsent(f.session,input,later)).status,'WITHDRAWN');
   await assert.rejects(reviewBankConsent(f.staff,{accountId:f.account.id,id:p.id,confirmed:true},later),/CONSENT_STATE/);
  });
  await t.test('expired preview and foreign verified identity cannot save another customer permission',async()=>{
   const f=await fixture(),p=await preview(f),input={accountId:f.account.id,preview:p.preview,accepted:true};
   await assert.rejects(saveTenantBankConsent(f.session,input,new Date(p.expiresAt)),/EXPIRED/);
   await assert.rejects(saveTenantBankConsent({...f.session,email:'foreign@example.invalid'},input,later),/TENANT_NOT_FOUND/);
   assert.equal(await db.configurationProfile.count({where:{id:p.id}}),0);
  });

  await t.test('all retained permissions remain reachable through stable scoped twenty-row cursors',async()=>{
   const f=await fixture(),p=await preview(f),at=new Date(now.getTime()+500);
   for(let i=0;i<23;i++){
    const value=acceptBankAuthenticationConsent(prepareBankAuthenticationConsent(p.preview.source,now),later);
    await db.configurationProfile.create({data:{id:value.recordId,organisationId:f.org.id,facilityId:f.store.id,domain:DEBICHECK_BANK_CONSENT_DOMAIN,name:value.recordId,status:'CONSENTED',createdAt:at,config:encryptBankConsent(value)}});
   }
   const first=await listTenantBankConsents(f.session,{accountId:f.account.id},later);assert.equal(first.records.length,20);assert.ok(first.nextCursor);
   const second=await listTenantBankConsents(f.session,{accountId:f.account.id,cursor:first.nextCursor!},later);assert.equal(second.records.length,3);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.records,...second.records].map(r=>r.id)).size,23);
   const staff=await listStaffBankConsents(f.staff,{facilityId:f.store.id},later);assert.equal(staff.records.length,20);assert.ok(staff.records.every(r=>r.canReview));
   const staffOlder=await listStaffBankConsents(f.staff,{facilityId:f.store.id,cursor:staff.nextCursor!},later);assert.equal(staffOlder.records.length,3);
   await db.roleAssignment.deleteMany({where:{userId:f.staff.userId}});await assert.rejects(listStaffBankConsents(f.staff,{facilityId:f.store.id},later),/FORBIDDEN/);
   await assert.rejects(listTenantBankConsents({...f.session,customerIds:[]},{accountId:f.account.id},later),/TENANT_NOT_FOUND/);
   await assert.rejects(listTenantBankConsents(f.session,{accountId:f.account.id,cursor:'malformed'},later),/CURSOR/);
  });
  await t.test('a retained attempt blocks withdrawal; sealed permission tampering fails closed',async()=>{
   const f=await fixture(),p=await preview(f);await saveTenantBankConsent(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},later);
   await db.configurationProfile.create({data:{organisationId:f.org.id,facilityId:f.store.id,domain:'NETCASH_DEBICHECK_ATTEMPT',name:f.setup.id,status:'CLAIMED',config:{synthetic:true}}});
   await assert.rejects(withdrawTenantBankConsent(f.session,{accountId:f.account.id,id:p.id},later),/PROVIDER_CANCELLATION_REVIEW/);
   await assert.rejects(reviewBankConsent(f.staff,{accountId:f.account.id,id:p.id,confirmed:true},later),/ATTEMPT_EXISTS/);
   const retained=await db.configurationProfile.findUniqueOrThrow({where:{id:p.id}});await db.configurationProfile.update({where:{id:p.id},data:{config:{...(retained.config as object),consentHash:'9'.repeat(64)}}});
   await assert.rejects(listTenantBankConsents(f.session,{accountId:f.account.id},later),/INTEGRITY/);
  });
  await t.test('audit failure rolls back encrypted permission and saved state',async()=>{
   const f=await fixture(),p=await preview(f);
   await db.$executeRawUnsafe(`CREATE FUNCTION ci_bank_consent_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='netcash.debicheck_bank_consent_saved' THEN RAISE EXCEPTION 'Synthetic bank consent audit failure'; END IF; RETURN NEW; END $$`);
   await db.$executeRawUnsafe(`CREATE TRIGGER ci_bank_consent_reject_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ci_bank_consent_reject_audit()`);
   try{await assert.rejects(saveTenantBankConsent(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},later),/Synthetic bank consent audit failure/);assert.equal(await db.configurationProfile.count({where:{id:p.id}}),0)}finally{await db.$executeRawUnsafe(`DROP TRIGGER ci_bank_consent_reject_audit ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION ci_bank_consent_reject_audit()`)}
  });
  assert.deepEqual({payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()},baseline);

 }finally{globalThis.fetch=original;for(const name of ['NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED','NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED','NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL'])delete process.env[name];await db.$disconnect()}
});
