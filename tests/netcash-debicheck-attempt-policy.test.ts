import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {prepareDebiCheckAttempt,readDebiCheckAttempt,completeDebiCheckAttempt,debiCheckAttemptInitialResult,projectDebiCheckAttempt,prepareDebiCheckStatusObservation,readDebiCheckStatusObservation,type DebiCheckAttemptSource} from '../src/lib/payments/netcash-debicheck-attempt-policy';
import type {DebiCheckAuthenticationOutcome} from '../src/lib/payments/netcash-debicheck-authentication';
process.env.AUTH_SECRET='synthetic-attempt-signing-secret-32-characters';
process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='synthetic-attempt-vault-secret-32-characters';
const now=new Date('2026-10-15T12:00:00Z');
const source:DebiCheckAttemptSource={organisationId:'synthetic-org',facilityId:'synthetic-store',accountId:'synthetic-account',requestId:'debicheck-request:'+randomUUID(),requestSignature:'1'.repeat(64),sourceHash:'2'.repeat(64),merchantHash:'3'.repeat(64),connectionId:'synthetic-connection',connectionUpdatedAt:now.toISOString(),templateSourceHash:'4'.repeat(64),authenticationConsentHash:'5'.repeat(64),independentReviewAuditId:'synthetic-review'};
const accepted:DebiCheckAuthenticationOutcome={outcome:'BANK_AUTHENTICATED',contractReference:'NC000000000001',providerCode:'000',requestSubmitted:true,bankAuthenticationObserved:true,collectionAuthorised:false,financialReceipt:false,retryAllowed:false};
const identity=(id:string)=>({id,organisationId:source.organisationId,facilityId:source.facilityId,accountId:source.accountId});
test('durable attempt identity binds original request, scope, consent, source and merchant',()=>{
 const attempt=prepareDebiCheckAttempt(source,now);
 assert.equal(prepareDebiCheckAttempt(source,new Date(now.getTime()+1000)).recordId,attempt.recordId);
 assert.deepEqual(readDebiCheckAttempt(attempt,identity(attempt.recordId)),attempt);
 for(const key of ['organisationId','facilityId','accountId'] as const)assert.throws(()=>readDebiCheckAttempt(attempt,{...identity(attempt.recordId),[key]:'foreign'}),/INTEGRITY_REVIEW/);
 for(const key of ['sourceHash','merchantHash','authenticationConsentHash','requestSignature','templateSourceHash'] as const)assert.throws(()=>readDebiCheckAttempt({...attempt,source:{...source,[key]:'9'.repeat(64)}},identity(attempt.recordId)),/INTEGRITY_REVIEW/);
 assert.throws(()=>prepareDebiCheckAttempt({...source,authenticationConsentHash:''},now));
 assert.throws(()=>prepareDebiCheckAttempt({...source,bankAccountNumber:'not-retained'} as DebiCheckAttemptSource,now));
});
test('a claim without a saved response remains uncertain and never becomes retryable through age',()=>{
 const attempt=prepareDebiCheckAttempt(source,now),projection=projectDebiCheckAttempt(attempt);
 assert.equal(projection.status,'CLAIMED');assert.equal(projection.reconciliationRequired,true);assert.equal(projection.retryAllowed,false);
 assert.equal(projection.bankAuthenticationObserved,false);assert.equal(projection.collectionAuthorised,false);assert.equal(projection.financialReceipt,false);
 assert.equal(debiCheckAttemptInitialResult(attempt),null);
});
test('original result is encrypted, immutable and idempotent; conflicting or invalid later results hold',()=>{
 const attempt=prepareDebiCheckAttempt(source,now),completed=completeDebiCheckAttempt(attempt,accepted,new Date(now.getTime()+1000));
 assert.ok(!JSON.stringify(completed).includes(accepted.contractReference!));
 assert.deepEqual(debiCheckAttemptInitialResult(completed),accepted);
 assert.equal(completeDebiCheckAttempt(completed,accepted,new Date(now.getTime()+100000)),completed);
 assert.throws(()=>completeDebiCheckAttempt(completed,{...accepted,outcome:'OUTCOME_UNKNOWN',bankAuthenticationObserved:false},now),/RESULT_CONFLICT/);
 assert.throws(()=>completeDebiCheckAttempt(attempt,accepted,new Date(now.getTime()-1)),/TIME_REVIEW/);
 for(const value of [{...accepted,collectionAuthorised:true},{...accepted,retryAllowed:true},{...accepted,contractReference:null},{...accepted,requestSubmitted:false},{...accepted,bankAuthenticationObserved:false},{...accepted,financialReceipt:true}])assert.throws(()=>completeDebiCheckAttempt(attempt,value as DebiCheckAuthenticationOutcome,now));
 const projection=projectDebiCheckAttempt(completed);assert.equal(projection.originalContractAvailable,true);assert.equal(projection.bankAuthenticationObserved,true);assert.equal(projection.collectionAuthorised,false);assert.equal(projection.financialReceipt,false);assert.ok(!JSON.stringify(projection).includes(accepted.contractReference!));
});
test('unknown original response retains its contract for reconciliation and cannot be rewritten as bank acceptance',()=>{
 const unknown={...accepted,outcome:'OUTCOME_UNKNOWN' as const,bankAuthenticationObserved:false};
 const completed=completeDebiCheckAttempt(prepareDebiCheckAttempt(source,now),unknown,now);
 assert.equal(projectDebiCheckAttempt(completed).reconciliationRequired,true);
 assert.equal(debiCheckAttemptInitialResult(completed)?.contractReference,accepted.contractReference);
 assert.throws(()=>completeDebiCheckAttempt(completed,accepted,now),/RESULT_CONFLICT/);
 const broken={...completed,initialResultEncrypted:completed.initialResultEncrypted!.slice(0,-2)+'xx'};
 assert.throws(()=>readDebiCheckAttempt(broken,identity(completed.recordId)),/INTEGRITY_REVIEW/);
});
test('separate status evidence binds the original NC and merchant, retains unknown initial response and gives no resend or cash authority',()=>{
 const attempt=completeDebiCheckAttempt(prepareDebiCheckAttempt(source,now),{...accepted,outcome:'OUTCOME_UNKNOWN',bankAuthenticationObserved:false},now);
 const status={contractReference:accepted.contractReference!,status:'Accepted',updatedAt:'20261015',cancelledAt:null,cancellationReason:null,bankAuthenticationObserved:true,collectionAuthorised:false as const,financialReceipt:false as const};
 const {record,projection}=prepareDebiCheckStatusObservation(attempt,source.merchantHash,status,now);
 assert.ok(!JSON.stringify(record).includes(accepted.contractReference!));assert.ok(!JSON.stringify(projection).includes(accepted.contractReference!));
 assert.deepEqual(readDebiCheckStatusObservation(record,attempt,source.merchantHash),projection);
 assert.equal(debiCheckAttemptInitialResult(attempt)?.outcome,'OUTCOME_UNKNOWN');assert.equal(projection.bankAuthenticationObserved,true);assert.equal(projection.retryAllowed,false);
 for(const value of [{...status,contractReference:'NC000000000002'},{...status,cancelledAt:'20261015'},{...status,updatedAt:'20260230'},{...status,financialReceipt:true}])assert.throws(()=>prepareDebiCheckStatusObservation(attempt,source.merchantHash,value as typeof status,now));
 assert.throws(()=>prepareDebiCheckStatusObservation(attempt,'9'.repeat(64),status,now),/SOURCE_REVIEW/);
 assert.throws(()=>readDebiCheckStatusObservation({...record,merchantHash:'9'.repeat(64)},attempt,source.merchantHash),/INTEGRITY_REVIEW/);
 assert.throws(()=>prepareDebiCheckStatusObservation(prepareDebiCheckAttempt(source,now),source.merchantHash,status,now),/SOURCE_REVIEW/);
});
