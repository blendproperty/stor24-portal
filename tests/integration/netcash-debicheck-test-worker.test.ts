import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {submitReviewedDebiCheckTest,reconcileDebiCheckTest} from '../../src/lib/payments/netcash-debicheck-test-worker';
import {db} from '../../src/lib/db';
import {encryptIntegrationSecret} from '../../src/lib/integrations/integration-secret-vault';
import {observeDebiCheckTemplate,reviewDebiCheckTemplate} from '../../src/lib/payments/netcash-debicheck-template-service';
import {previewDebiCheckRequest,saveDebiCheckRequest,reviewDebiCheckRequest} from '../../src/lib/payments/netcash-debicheck-request-service';
import {previewTenantBankConsent,saveTenantBankConsent,withdrawTenantBankConsent,reviewBankConsent} from '../../src/lib/payments/netcash-debicheck-bank-consent-service';
import {readDebiCheckRequest,privateDebiCheckTerms} from '../../src/lib/payments/netcash-debicheck-request-policy';
import {bankAuthenticationPayerFingerprint} from '../../src/lib/payments/netcash-debicheck-bank-test-approval';

test('isolated guarded bank test worker permits one physical attempt and holds every uncertain outcome',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 process.env.AUTH_SECRET='synthetic-debicheck-request-ci-secret-32';process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='synthetic-debicheck-request-ci-vault-32';process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED='true';
 process.env.NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED='true';
 const now=new Date('2026-10-16T04:00:00.000Z'),startDate='2026-11-01';
 const payer={debtorIdentification:'SYNTHETIC-PASSPORT',debtorIdentificationCode:'P',accountName:'Synthetic tenant',bankAccountName:'Synthetic holder',branchCode:'198765',bankAccountNumber:'990012345',bankAccountType:'Current',mobileNumber:'0820000000',emailAddress:''};
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Real provider transport forbidden')};
 const request:typeof fetch=async(_url,options)=>{
  assert.equal((options!.headers as Record<string,string>).SOAPAction,'"http://tempuri.org/INIWS_NIF/DebiCheckRetrieveMandateTemplateDetail"');
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
  const role=await db.role.create({data:{organisationId:org.id,name:'Synthetic bank review '+key,permissions:['payments.view','payments.bank_auth_review','payments.bank_auth_submit','payments.bank_auth_status']}}),assignment=await db.roleAssignment.create({data:{userId:staff.userId,facilityId:store.id,roleId:role.id}});
  return{org,store,other,customer,users,account,tenancy,profile,connection,scope,staff,session,input,setup,assignment};
 }


 const clock=()=>new Date(now.getTime()+3000);
 const envelope=(fields:string)=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><DebiCheckAuthenticateResponse xmlns="http://tempuri.org/"><DebiCheckAuthenticateResult xmlns:a="http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS">${fields}</DebiCheckAuthenticateResult></DebiCheckAuthenticateResponse></s:Body></s:Envelope>`;
 const accepted=envelope('<a:ErrorCode>000</a:ErrorCode><a:BankResponseCode>900000</a:BankResponseCode><a:BankservResponseCode>ACCP</a:BankservResponseCode><a:ClientResponseCode>TRUE</a:ClientResponseCode><a:ContractReference>NC000000000001</a:ContractReference><a:Status>Accepted</a:Status>');
 async function ready(){const f=await fixture(),p=await previewTenantBankConsent(f.session,{accountId:f.account.id,requestId:f.setup.id},now);await saveTenantBankConsent(f.session,{accountId:f.account.id,preview:p.preview,accepted:true},new Date(now.getTime()+1000));await reviewBankConsent(f.staff,{accountId:f.account.id,id:p.id,confirmed:true},new Date(now.getTime()+2000));return{...f,consent:p,input:{facilityId:f.store.id,accountId:f.account.id,consentId:p.id,confirmed:true},attemptId:'debicheck-attempt:'+f.setup.id.replace('debicheck-request:','')}}
 const noNetwork:typeof fetch=async()=>{throw Error('Unexpected provider attempt')};
 try{
  const baseline={payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()};
  await t.test('default-off and missing separate approval reject before durable claim or transport',async()=>{
   const f=await ready();delete process.env.NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED;await assert.rejects(submitReviewedDebiCheckTest(f.staff,f.input,noNetwork,clock),/TEST_SUBMISSION_DISABLED/);
   process.env.NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED='true';delete process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL;await assert.rejects(submitReviewedDebiCheckTest(f.staff,f.input,noNetwork,clock),/TEST_APPROVAL_REQUIRED/);assert.equal(await db.configurationProfile.count({where:{id:f.attemptId}}),0);
  });
  await t.test('chosen store, current submit permission and withdrawn native consent cannot be substituted',async()=>{
   const f=await ready();let calls=0;const request:typeof fetch=async()=>{calls++;return new Response(accepted)};
   await assert.rejects(submitReviewedDebiCheckTest(f.staff,{...f.input,facilityId:f.other.id},request,clock),/FORBIDDEN/);
   await db.role.update({where:{id:f.assignment.roleId},data:{permissions:['payments.view','payments.bank_auth_review','payments.bank_auth_status']}});await assert.rejects(submitReviewedDebiCheckTest(f.staff,f.input,request,clock),/FORBIDDEN/);
   await db.role.update({where:{id:f.assignment.roleId},data:{permissions:['payments.view','payments.bank_auth_review','payments.bank_auth_submit','payments.bank_auth_status']}});await withdrawTenantBankConsent(f.session,{accountId:f.account.id,id:f.consent.id},clock());await assert.rejects(submitReviewedDebiCheckTest(f.staff,f.input,request,clock),/CONSENT_REQUIRED/);assert.equal(calls,0);assert.equal(await db.configurationProfile.count({where:{id:f.attemptId}}),0);
  });
  await t.test('claim is committed before exactly one outbound call; duplicate POST never submits again even when disabled',async()=>{
   const f=await ready();let calls=0;const request:typeof fetch=async(_url,options)=>{calls++;assert.equal((options?.headers as Record<string,string>).SOAPAction,'"http://tempuri.org/INIWS_NIF/DebiCheckAuthenticate"');assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:f.attemptId}})).status,'CLAIMED');return new Response(accepted)};
   const result=await submitReviewedDebiCheckTest(f.staff,f.input,request,clock);assert.equal(calls,1);assert.equal(result.originalResultRetained,true);assert.equal(result.attempt?.status,'BANK_AUTHENTICATED');
   process.env.NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED='false';const duplicate=await submitReviewedDebiCheckTest(f.staff,f.input,request,clock);assert.equal(duplicate.newClaim,false);assert.equal(duplicate.providerActionAttempted,false);assert.equal(calls,1);process.env.NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED='true';
  });
  await t.test('unchanged documentary whitespace uses the same canonical approval through the final guard',async()=>{
   const f=await ready(),approval=JSON.parse(process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL!);approval.providerEvidenceReference='  '+approval.providerEvidenceReference+'  ';approval.approvalRecordedBy='  '+approval.approvalRecordedBy+'  ';process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=JSON.stringify(approval);
   let calls=0;const result=await submitReviewedDebiCheckTest(f.staff,f.input,async()=>{calls++;return new Response(accepted)},clock);assert.equal(calls,1);assert.equal(result.localGuardHeld,false);assert.equal(result.originalResultRetained,true);assert.equal(result.attempt?.status,'BANK_AUTHENTICATED');
  });
  await t.test('a semantically changed approval rejects before claim and is held if changed at the final guard',async()=>{
   const f=await ready(),original=process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL!,approval=JSON.parse(original);approval.providerEvidenceReference+=' changed';process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=JSON.stringify(approval);
   await assert.rejects(submitReviewedDebiCheckTest(f.staff,f.input,noNetwork,clock),/CONSENT_SOURCE_CHANGED/);assert.equal(await db.configurationProfile.count({where:{id:f.attemptId}}),0);
   process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=original;let ticks=0,calls=0;
   const result=await submitReviewedDebiCheckTest(f.staff,f.input,async()=>{calls++;return new Response(accepted)},()=>{if(++ticks===4)process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=JSON.stringify(approval);return clock()});
   assert.equal(ticks,4);assert.equal(calls,0);assert.equal(result.localGuardHeld,true);assert.equal(result.originalResultRetained,false);assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:f.attemptId}})).status,'CLAIMED');
  });
  await t.test('parallel explicit calls reach only one physical provider attempt',async()=>{
   const f=await ready();let calls=0;const request:typeof fetch=async()=>{calls++;return new Response(accepted)};
   const results=await Promise.allSettled(Array.from({length:8},()=>submitReviewedDebiCheckTest(f.staff,f.input,request,clock)));
   assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.newClaim).length,1);for(const r of results)if(r.status==='rejected')assert.equal((r.reason as {code?:string}).code,'P2034');
  });
  await t.test('timeout, HTTP failure and malformed response each retain unknown without transport replay',async()=>{
   for(const failure of ['timeout','http','malformed']){const f=await ready();let calls=0;const request:typeof fetch=async()=>{calls++;if(failure==='timeout')throw new DOMException('Synthetic timeout','TimeoutError');return failure==='http'?new Response('',{status:503}):new Response('<incomplete>')};const result=await submitReviewedDebiCheckTest(f.staff,f.input,request,clock);assert.equal(calls,1);assert.equal(result.attempt?.status,'OUTCOME_UNKNOWN');assert.equal(result.attempt?.retryAllowed,false);assert.equal((await submitReviewedDebiCheckTest(f.staff,f.input,request,clock)).newClaim,false);assert.equal(calls,1)}
  });
  await t.test('failed outcome audit leaves a durable claimed hold and never resubmits or retries persistence',async()=>{
   const f=await ready();let calls=0;await db.$executeRawUnsafe(`CREATE FUNCTION ci_bank_result_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='netcash.debicheck_authentication_result_retained' THEN RAISE EXCEPTION 'Synthetic retained outcome failure'; END IF; RETURN NEW; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER ci_bank_result_reject BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ci_bank_result_reject()`);
   try{const request:typeof fetch=async()=>{calls++;return new Response(accepted)},result=await submitReviewedDebiCheckTest(f.staff,f.input,request,clock);assert.equal(result.originalResultRetained,false);assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:f.attemptId}})).status,'CLAIMED');assert.equal((await submitReviewedDebiCheckTest(f.staff,f.input,request,clock)).newClaim,false);assert.equal(calls,1)}finally{await db.$executeRawUnsafe(`DROP TRIGGER ci_bank_result_reject ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION ci_bank_result_reject()`)}
  });
  await t.test('real reviewer role revocation committed with claim is caught before transport',async()=>{
   const f=await ready();assert.match(f.staff.userId,/^[a-z0-9]+$/);
   await db.$executeRawUnsafe(`CREATE FUNCTION ci_bank_claim_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='netcash.debicheck_authentication_claim_retained' THEN DELETE FROM "RoleAssignment" WHERE "userId"='${f.staff.userId}'; END IF; RETURN NEW; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER ci_bank_claim_revoke AFTER INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ci_bank_claim_revoke()`);
   try{let calls=0;const result=await submitReviewedDebiCheckTest(f.staff,f.input,async()=>{calls++;return new Response(accepted)},clock);assert.equal(result.newClaim,true);assert.equal(result.providerActionAttempted,false);assert.equal(result.originalResultRetained,false);assert.equal(calls,0);assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:f.attemptId}})).status,'CLAIMED')}finally{await db.$executeRawUnsafe(`DROP TRIGGER ci_bank_claim_revoke ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION ci_bank_claim_revoke()`)}
  });
  await t.test('later status read appends evidence to the returned original contract without changing unknown original result',async()=>{
   const f=await ready(),partial=envelope('<a:ErrorCode>000</a:ErrorCode><a:ContractReference>NC000000000001</a:ContractReference>');await submitReviewedDebiCheckTest(f.staff,f.input,async()=>new Response(partial),clock);const original=await db.configurationProfile.findUniqueOrThrow({where:{id:f.attemptId}});assert.equal(original.status,'OUTCOME_UNKNOWN');process.env.NETCASH_DEBICHECK_STATUS_LOOKUP_ENABLED='true';let reads=0;
   const request:typeof fetch=async(_url,options)=>{reads++;assert.equal((options?.headers as Record<string,string>).SOAPAction,'"http://tempuri.org/INIWS_NIF/DebiCheckAuthenticationCurrentStatus"');assert.match(String(options?.body),/<ContractReference>NC000000000001<\/ContractReference>/);return new Response('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><DebiCheckAuthenticationCurrentStatusResponse xmlns="http://tempuri.org/"><DebiCheckAuthenticationCurrentStatusResult xmlns:a="http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><a:ErrorCode>000</a:ErrorCode><a:ContractReference>NC000000000001</a:ContractReference><a:Status>Accepted</a:Status><a:DateCancelled i:nil="true"/><a:UpdateDate>20261016</a:UpdateDate><a:CancellationReason i:nil="true"/></DebiCheckAuthenticationCurrentStatusResult></DebiCheckAuthenticationCurrentStatusResponse></s:Body></s:Envelope>')};
   const result=await reconcileDebiCheckTest(f.staff,{facilityId:f.store.id,accountId:f.account.id,attemptId:f.attemptId,confirmed:true},request,()=>new Date(now.getTime()+86400000));assert.equal(result.retained,true);assert.equal(reads,1);assert.deepEqual((await db.configurationProfile.findUniqueOrThrow({where:{id:f.attemptId}})).config,original.config);assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:f.attemptId}})).status,'OUTCOME_UNKNOWN');
   assert.equal((await reconcileDebiCheckTest(f.staff,{facilityId:f.store.id,accountId:f.account.id,attemptId:f.attemptId,confirmed:true},request,clock)).retained,false);assert.equal(reads,2);
  });
  await t.test('a missing original returned contract cannot be invented for reconciliation',async()=>{
   const f=await ready();await submitReviewedDebiCheckTest(f.staff,f.input,async()=>{throw Error('Synthetic timeout')},clock);let calls=0;await assert.rejects(reconcileDebiCheckTest(f.staff,{facilityId:f.store.id,accountId:f.account.id,attemptId:f.attemptId,confirmed:true},async()=>{calls++;return new Response('')},clock),/ORIGINAL_CONTRACT_REQUIRED/);assert.equal(calls,0);
  });
  assert.deepEqual({payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()},baseline);
 }finally{globalThis.fetch=original;for(const name of ['NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED','NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED','NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL','NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED','NETCASH_DEBICHECK_STATUS_LOOKUP_ENABLED'])delete process.env[name];await db.$disconnect()}
});
