import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import {sealDebiCheckRequest,DEBICHECK_REQUEST_TERMS} from '../../src/lib/payments/netcash-debicheck-request-policy';
import {encryptIntegrationSecret} from '../../src/lib/integrations/integration-secret-vault';
import {retainDebiCheckAttemptClaim,retainDebiCheckAttemptResult,retainDebiCheckStatusObservation} from '../../src/lib/payments/netcash-debicheck-attempt-journal';
import {readDebiCheckAttempt,projectDebiCheckAttempt,prepareDebiCheckAttempt,type DebiCheckAttemptSource} from '../../src/lib/payments/netcash-debicheck-attempt-policy';
import {readDebiCheckHistory} from '../../src/lib/payments/netcash-debicheck-history-service';
import type {DebiCheckAuthenticationOutcome} from '../../src/lib/payments/netcash-debicheck-authentication';
import {withdrawDebiCheckRequest} from '../../src/lib/payments/netcash-debicheck-request-service';

test('isolated PostgreSQL durable authentication journal retains exactly one attempt without provider or financial action',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 process.env.AUTH_SECRET=randomBytes(32).toString('hex');process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
 const now=new Date('2026-10-15T12:00:00Z'),originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Provider/network request forbidden in journal tests')};
 const accepted:DebiCheckAuthenticationOutcome={outcome:'BANK_AUTHENTICATED',contractReference:'NC000000000001',providerCode:'000',requestSubmitted:true,bankAuthenticationObserved:true,collectionAuthorised:false,financialReceipt:false,retryAllowed:false};
 async function fixture(){
  const key=randomUUID(),organisation=await db.organisation.create({data:{name:'Synthetic journal',slug:key}});
  const facility=await db.facility.create({data:{organisationId:organisation.id,code:key,name:'Synthetic journal store'}});
  const customer=await db.customer.create({data:{organisationId:organisation.id,firstName:'Synthetic',email:key+'@example.invalid',emailVerifiedAt:now}});
  const account=await db.account.create({data:{customerId:customer.id,accountNumber:key,currency:'ZAR',balance:100}});
  const tenancy=await db.tenancy.create({data:{accountId:account.id,facilityId:facility.id,customerId:customer.id,status:'ACTIVE',startDate:now,paymentMethod:'CARD'}});
  const reviewer=await db.user.create({data:{organisationId:organisation.id,name:'Synthetic reviewer',email:randomUUID()+'@example.invalid'}});
  const role=await db.role.create({data:{organisationId:organisation.id,name:'Synthetic history reader '+key,permissions:['payments.view']}});
  await db.roleAssignment.create({data:{userId:reviewer.id,roleId:role.id,facilityId:facility.id}});
  const request=sealDebiCheckRequest({version:1,recordId:'debicheck-request:'+randomUUID(),organisationId:organisation.id,facilityId:facility.id,accountId:account.id,customerId:customer.id,tenancyId:tenancy.id,sourceHash:'1'.repeat(64),templateObservationId:'synthetic-observation',templateSourceHash:'2'.repeat(64),templateId:'NCDCT000000001',connectionId:'synthetic-connection',connectionUpdatedAt:now.toISOString(),merchantHash:'3'.repeat(64),environment:'sandbox',startDate:'2026-11-01',monthlyAmount:'100.00',consentVersion:DEBICHECK_REQUEST_TERMS,consentText:'Synthetic setup only; no bank authority',consentAt:now.toISOString(),tenantIdentityHash:'4'.repeat(64),bankSuffix:'0000',encryptedTerms:encryptIntegrationSecret('synthetic private terms fixture')});
  await db.configurationProfile.create({data:{id:request.recordId,organisationId:organisation.id,facilityId:facility.id,domain:'NETCASH_DEBICHECK_REQUEST',name:account.id+':'+key,status:'REVIEWED',config:request}});
  const consentHash='5'.repeat(64);
  const consent=await db.auditEvent.create({data:{organisationId:organisation.id,facilityId:facility.id,entityType:'ConfigurationProfile',entityId:request.recordId,action:'netcash.debicheck_bank_authentication_consented',occurredAt:now,after:{consentVersion:'debicheck-bank-authentication-v1',customerId:customer.id,requestSignature:request.signature,sourceHash:request.sourceHash,merchantHash:request.merchantHash,consentHash}}});
  const review=await db.auditEvent.create({data:{organisationId:organisation.id,facilityId:facility.id,actorId:reviewer.id,entityType:'ConfigurationProfile',entityId:request.recordId,action:'netcash.debicheck_bank_authentication_reviewed',occurredAt:now,after:{requestSignature:request.signature,authenticationConsentHash:consentHash,sourceHash:request.sourceHash,merchantHash:request.merchantHash}}});
  const source:DebiCheckAttemptSource={organisationId:organisation.id,facilityId:facility.id,accountId:account.id,requestId:request.recordId,requestSignature:request.signature,sourceHash:request.sourceHash,merchantHash:request.merchantHash,connectionId:request.connectionId,connectionUpdatedAt:request.connectionUpdatedAt,templateSourceHash:request.templateSourceHash,authenticationConsentHash:consentHash,independentReviewAuditId:review.id};
  const identity={id:'debicheck-attempt:'+request.recordId.replace('debicheck-request:',''),organisationId:organisation.id,facilityId:facility.id,accountId:account.id};
  const claim=()=>db.$transaction(tx=>retainDebiCheckAttemptClaim(tx,source,now),{isolationLevel:'Serializable',timeout:20000});
  const complete=(value:DebiCheckAuthenticationOutcome)=>db.$transaction(tx=>retainDebiCheckAttemptResult(tx,identity,value,new Date(now.getTime()+1000)),{isolationLevel:'Serializable'});
  const session={organisationId:organisation.id,email:customer.email!,customerIds:[customer.id]};
  const scope={userId:reviewer.id,organisationId:organisation.id,facilityIds:[facility.id],unrestrictedFacilities:false};
  return{source,identity,claim,complete,consent,review,account,request,session,scope};
 }
 try{
  const financialBaseline={payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()};
  await t.test('setup consent or missing independent authentication review cannot create a dispatch claim',async()=>{
   const f=await fixture();await db.auditEvent.update({where:{id:f.consent.id},data:{action:'netcash.debicheck_request_consented'}});
   await assert.rejects(f.claim(),/BANK_AUTHENTICATION_CONSENT_REQUIRED/);assert.equal(await db.configurationProfile.count({where:{id:f.identity.id}}),0);
   await db.auditEvent.update({where:{id:f.consent.id},data:{action:'netcash.debicheck_bank_authentication_consented'}});
   await db.auditEvent.delete({where:{id:f.review.id}});await assert.rejects(f.claim(),/BANK_AUTHENTICATION_REVIEW_REQUIRED/);
  });
  await t.test('one committed claim survives crash/restart and repeated requests never yield a new attempt',async()=>{
   const f=await fixture(),first=await f.claim();assert.equal(first.newClaim,true);assert.equal(first.attempt.status,'CLAIMED');
   for(let i=0;i<3;i++){const retry=await f.claim();assert.equal(retry.newClaim,false);assert.equal(retry.attempt.retryAllowed,false);assert.equal(retry.attempt.reconciliationRequired,true);}
   assert.equal(await db.auditEvent.count({where:{entityId:f.identity.id,action:'netcash.debicheck_authentication_claim_retained'}}),1);
   await assert.rejects(db.$transaction(tx=>retainDebiCheckAttemptClaim(tx,{...f.source,merchantHash:'9'.repeat(64)},now)),/SOURCE_CHANGED/);
  });
  await t.test('concurrent claims retain one original durable claim; transaction conflicts do not permit network replay',async()=>{
   const f=await fixture(),results=await Promise.allSettled(Array.from({length:12},()=>f.claim()));
   assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.newClaim).length,1);
   for(const result of results)if(result.status==='rejected')assert.equal((result.reason as {code?:string}).code,'P2034');
   assert.equal(await db.configurationProfile.count({where:{id:f.identity.id}}),1);assert.equal((await f.claim()).newClaim,false);
  });
  await t.test('withdrawal before claim closes the request, while an existing claim requires separate provider cancellation review',async()=>{
   const first=await fixture();await first.claim();await assert.rejects(withdrawDebiCheckRequest(first.session,first.account.id,first.request.recordId),/PROVIDER_CANCELLATION_REVIEW/);assert.equal((await first.claim()).newClaim,false);
   const second=await fixture();await withdrawDebiCheckRequest(second.session,second.account.id,second.request.recordId);await assert.rejects(second.claim(),/REVIEWED_REQUEST_REQUIRED/);
  });
  await t.test('retained original result is encrypted, idempotent and cannot be replaced by a later different response',async()=>{
   const f=await fixture();await f.claim();const result=await f.complete(accepted);assert.equal(result.bankAuthenticationObserved,true);assert.equal(result.financialReceipt,false);
   const row=await db.configurationProfile.findUniqueOrThrow({where:{id:f.identity.id}});assert.ok(!JSON.stringify(row.config).includes(accepted.contractReference!));
   assert.deepEqual(await f.complete(accepted),result);
   await assert.rejects(f.complete({...accepted,outcome:'OUTCOME_UNKNOWN',bankAuthenticationObserved:false}),/RESULT_CONFLICT/);
   assert.equal(await db.auditEvent.count({where:{entityId:f.identity.id,action:'netcash.debicheck_authentication_result_retained'}}),1);
   assert.equal((await f.claim()).newClaim,false);
  });
  await t.test('lost or unknown provider response stays held; no contract is invented and no new attempt is offered',async()=>{
   const f=await fixture();await f.claim();const result=await f.complete({...accepted,outcome:'OUTCOME_UNKNOWN',contractReference:null,providerCode:null,requestSubmitted:null,bankAuthenticationObserved:false});
   assert.equal(result.reconciliationRequired,true);assert.equal(result.originalContractAvailable,false);assert.equal(result.retryAllowed,false);assert.equal((await f.claim()).newClaim,false);
  });
  await t.test('wrong account/store/organisation or changed source cannot claim or retain another outcome',async()=>{
   const f=await fixture();for(const field of ['organisationId','facilityId','accountId'] as const)await assert.rejects(db.$transaction(tx=>retainDebiCheckAttemptClaim(tx,{...f.source,[field]:'foreign'},now)),/ACCOUNT_REVIEW/);
   await assert.rejects(db.$transaction(tx=>retainDebiCheckAttemptClaim(tx,{...f.source,sourceHash:'9'.repeat(64)},now)),/SOURCE_CHANGED/);
   await f.claim();await assert.rejects(db.$transaction(tx=>retainDebiCheckAttemptResult(tx,{...f.identity,organisationId:'foreign'},accepted,now)),/NOT_FOUND/);
   await assert.rejects(db.$transaction(tx=>retainDebiCheckAttemptResult(tx,{...f.identity,accountId:'foreign'},accepted,now)),/INTEGRITY_REVIEW/);
  });
  await t.test('separate status read cannot invent a contract or overwrite the dispatch; matching observations deduplicate',async()=>{
   const f=await fixture();await f.claim();const status={contractReference:accepted.contractReference!,status:'Accepted',updatedAt:'20261015',cancelledAt:null,cancellationReason:null,bankAuthenticationObserved:true,collectionAuthorised:false as const,financialReceipt:false as const};
   const observe=(merchant=f.source.merchantHash,value=status)=>db.$transaction(tx=>retainDebiCheckStatusObservation(tx,f.identity,merchant,value,new Date(now.getTime()+2000)),{isolationLevel:'Serializable'});
   await assert.rejects(observe(),/SOURCE_REVIEW/);
   await f.complete({...accepted,outcome:'OUTCOME_UNKNOWN',bankAuthenticationObserved:false});
   await assert.rejects(observe('9'.repeat(64)),/SOURCE_REVIEW/);await assert.rejects(observe(f.source.merchantHash,{...status,contractReference:'NC000000000002'}),/SOURCE_REVIEW/);
   const first=await observe();assert.equal(first.retained,true);assert.equal((await observe()).retained,false);
   assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:f.identity.id}})).status,'OUTCOME_UNKNOWN');assert.equal((await f.claim()).newClaim,false);
   const row=await db.configurationProfile.findUniqueOrThrow({where:{id:first.id}});assert.ok(!JSON.stringify(row.config).includes(accepted.contractReference!));
   assert.equal(await db.auditEvent.count({where:{entityId:f.identity.id,action:'netcash.debicheck_authentication_status_retained'}}),1);
  });
  await t.test('audit failure rolls back both claim and result; a lost result leaves the original claim held',async()=>{
   const f=await fixture();await db.$executeRawUnsafe(`CREATE FUNCTION ci_reject_debicheck_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('netcash.debicheck_authentication_claim_retained','netcash.debicheck_authentication_result_retained') THEN RAISE EXCEPTION 'Synthetic attempt audit failure'; END IF; RETURN NEW; END $$`);
   await db.$executeRawUnsafe(`CREATE TRIGGER ci_reject_debicheck_attempt BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ci_reject_debicheck_attempt()`);
   try{await assert.rejects(f.claim(),/Synthetic attempt audit failure/);assert.equal(await db.configurationProfile.count({where:{id:f.identity.id}}),0);}
   finally{await db.$executeRawUnsafe(`DROP TRIGGER ci_reject_debicheck_attempt ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION ci_reject_debicheck_attempt()`);}
   await f.claim();
   await assert.rejects(db.$transaction(async tx=>{await retainDebiCheckAttemptResult(tx,f.identity,accepted,new Date(now.getTime()+1000));throw Error('Synthetic lost result transaction');}),/Synthetic lost result/);
   const row=await db.configurationProfile.findUniqueOrThrow({where:{id:f.identity.id}});assert.equal(row.status,'CLAIMED');assert.equal(projectDebiCheckAttempt(readDebiCheckAttempt(row.config,f.identity)).retryAllowed,false);assert.equal((await f.claim()).newClaim,false);
  });
  await t.test('native history reads preserve original unknown outcome separately from a later observed bank status without exposing private references or writes',async()=>{
   const f=await fixture();await f.claim();await f.complete({...accepted,outcome:'OUTCOME_UNKNOWN',bankAuthenticationObserved:false});
   const status={contractReference:accepted.contractReference!,status:'Accepted',updatedAt:'20261015',cancelledAt:null,cancellationReason:null,bankAuthenticationObserved:true,collectionAuthorised:false as const,financialReceipt:false as const};
   await db.$transaction(tx=>retainDebiCheckStatusObservation(tx,f.identity,f.source.merchantHash,status,new Date(now.getTime()+2000)));
   const before=await db.configurationProfile.findMany({where:{organisationId:f.scope.organisationId},orderBy:{id:'asc'}}),audits=await db.auditEvent.count({where:{organisationId:f.scope.organisationId}});
   const snapshot=await readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId,attemptId:f.identity.id});
   assert.equal(snapshot.attempts.length,1);assert.equal(snapshot.selected?.status,'OUTCOME_UNKNOWN');assert.equal(snapshot.selected?.bankAuthenticationObserved,false);assert.equal(snapshot.observations[0].bankAuthenticationObserved,true);assert.equal(snapshot.providerQueried,false);
   const json=JSON.stringify(snapshot);for(const privateValue of [accepted.contractReference!,'encryptedTerms','requestSignature','merchantHash','synthetic private terms fixture'])assert.ok(!json.includes(privateValue),privateValue);
   assert.deepEqual(await db.configurationProfile.findMany({where:{organisationId:f.scope.organisationId},orderBy:{id:'asc'}}),before);assert.equal(await db.auditEvent.count({where:{organisationId:f.scope.organisationId}}),audits);
  });
  await t.test('history enforces current database roles, exact organisation and store even with a forged unrestricted incoming scope',async()=>{
   const f=await fixture(),foreign=await fixture();await f.claim();
   await assert.rejects(readDebiCheckHistory(foreign.scope,{facilityId:f.identity.facilityId}),/FORBIDDEN/);
   await assert.rejects(readDebiCheckHistory({...f.scope,unrestrictedFacilities:true},{facilityId:foreign.identity.facilityId}),/FORBIDDEN/);
   await assert.rejects(readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId,attemptId:foreign.identity.id}),/NOT_FOUND/);
   await db.roleAssignment.deleteMany({where:{userId:f.scope.userId}});
   await assert.rejects(readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId}),/FORBIDDEN/);
  });
  await t.test('stable native attempt and observation pages retain original sources and explicit older selections',async()=>{
   const f=await fixture();await f.claim();await f.complete(accepted);
   const {signature:discarded,...plain}=f.request;assert.ok(discarded);
   for(let i=0;i<21;i++){
    const account=await db.account.create({data:{customerId:f.request.customerId,accountNumber:'SYN-HISTORY-'+randomUUID(),currency:'ZAR',balance:100}});
    const tenancy=await db.tenancy.create({data:{accountId:account.id,facilityId:f.identity.facilityId,customerId:f.request.customerId,status:'ACTIVE',startDate:now,paymentMethod:'CARD'}});
    const request=sealDebiCheckRequest({...plain,recordId:'debicheck-request:'+randomUUID(),accountId:account.id,tenancyId:tenancy.id,sourceHash:randomBytes(32).toString('hex')});
    await db.configurationProfile.create({data:{id:request.recordId,organisationId:f.scope.organisationId,facilityId:f.identity.facilityId,domain:'NETCASH_DEBICHECK_REQUEST',name:account.id,status:'REVIEWED',config:request}});
    const attempt=prepareDebiCheckAttempt({...f.source,accountId:account.id,sourceHash:request.sourceHash,requestId:request.recordId,requestSignature:request.signature},now);
    await db.configurationProfile.create({data:{id:attempt.recordId,organisationId:f.scope.organisationId,facilityId:f.identity.facilityId,domain:'NETCASH_DEBICHECK_ATTEMPT',name:request.recordId,status:'CLAIMED',config:attempt,createdAt:now}});
   }
   const first=await readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId}),older=await readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId,cursor:first.nextCursor!,attemptId:f.identity.id});
   assert.equal(first.attempts.length,20);assert.equal(older.attempts.length,2);assert.ok(!older.attempts.some(row=>first.attempts.some(previous=>previous.id===row.id)));assert.equal(older.selected?.id,f.identity.id);
   const filtered=await readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId,status:'BANK_AUTHENTICATED'});assert.equal(filtered.attempts.length,1);assert.equal(filtered.nextCursor,null);
   for(let i=0;i<21;i++){
    const updatedAt=new Date(Date.UTC(2026,9,15+i)).toISOString().slice(0,10).replaceAll('-','');
    await db.$transaction(tx=>retainDebiCheckStatusObservation(tx,f.identity,f.source.merchantHash,{contractReference:accepted.contractReference!,status:'Accepted',updatedAt,cancelledAt:null,cancellationReason:null,bankAuthenticationObserved:true,collectionAuthorised:false,financialReceipt:false},new Date(now.getTime()+2000+i*1000)));
   }
   const selected=await readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId,attemptId:f.identity.id});assert.equal(selected.observations.length,20);assert.ok(selected.nextObservationCursor);
   const previous=await readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId,attemptId:f.identity.id,observationCursor:selected.nextObservationCursor!});assert.equal(previous.observations.length,1);assert.ok(!previous.observations.some(row=>selected.observations.some(current=>current.id===row.id)));
   await assert.rejects(readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId,cursor:'not-json'}),/HISTORY_QUERY/);
  });
  await t.test('tampered sealed source or mismatched retained row status stops history instead of projecting a success',async()=>{
   const f=await fixture();await f.claim();await f.complete(accepted);
   await db.configurationProfile.update({where:{id:f.identity.id},data:{status:'CLAIMED'}});await assert.rejects(readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId}),/INTEGRITY/);
   const row=await db.configurationProfile.findUniqueOrThrow({where:{id:f.identity.id}});
   await db.configurationProfile.update({where:{id:f.identity.id},data:{status:'BANK_AUTHENTICATED',config:{...(row.config as object),signature:'a'.repeat(64)}}});await assert.rejects(readDebiCheckHistory(f.scope,{facilityId:f.identity.facilityId}),/INTEGRITY/);
  });
  assert.deepEqual({payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count()},financialBaseline);
 }finally{globalThis.fetch=originalFetch;await db.$disconnect();}
});
