import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {debiCheckPayerSchema,debiCheckRequestSignature,debiCheckSetupRequestText,encryptDebiCheckTerms,privateDebiCheckTerms,projectDebiCheckRequest,readDebiCheckRequest,sealDebiCheckRequest} from '../src/lib/payments/netcash-debicheck-request-policy';

test('DebiCheck setup consent is bound to its original identity and encrypted bank terms; review cannot become bank approval',()=>{
 const oldAuth=process.env.AUTH_SECRET,oldVault=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
 process.env.AUTH_SECRET='synthetic-debicheck-request-policy-secret-32';process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='synthetic-debicheck-request-vault-secret-32';
 try{
  const recordId='debicheck-request:'+randomUUID(),terms={accountReference:recordId.replace('debicheck-request:','').replaceAll('-',''),templateId:'NCDCT000000001',isIdNumber:false,debtorIdentification:'SYNTHETIC-PASSPORT',debtorIdentificationCode:'P' as const,accountName:'Synthetic tenant',bankAccountName:'Synthetic holder',branchCode:'198765',bankAccountNumber:'990012345',bankAccountType:'Current' as const,mobileNumber:'0820000000',emailAddress:'synthetic@example.invalid',collectionAmount:'950.00',firstCollectionDiffers:false,firstCollectionAmount:'950.00',firstCollectionDate:'2026-11-01',monthlyCollectionDay:1};
  const value=sealDebiCheckRequest({version:1,recordId,organisationId:'org',facilityId:'store',accountId:'account',customerId:'customer',tenancyId:'tenancy',sourceHash:'a'.repeat(64),templateObservationId:'observation',templateSourceHash:'b'.repeat(64),templateId:terms.templateId,connectionId:'connection',connectionUpdatedAt:'2026-10-15T04:00:00.000Z',merchantHash:'c'.repeat(64),environment:'sandbox',startDate:terms.firstCollectionDate,monthlyAmount:terms.collectionAmount,consentVersion:'debicheck-setup-request-v1',consentText:debiCheckSetupRequestText(terms.collectionAmount,terms.firstCollectionDate),consentAt:'2026-10-15T04:01:00.000Z',tenantIdentityHash:debiCheckRequestSignature({customerId:'customer'}),bankSuffix:'2345',encryptedTerms:encryptDebiCheckTerms(terms)});
  const identity={id:recordId,organisationId:'org',facilityId:'store',accountId:'account'};
  assert.deepEqual(privateDebiCheckTerms(readDebiCheckRequest(value,identity)),terms);
  for(const secret of [terms.debtorIdentification,terms.bankAccountNumber,terms.bankAccountName,terms.emailAddress,terms.mobileNumber])assert.ok(!JSON.stringify(value).includes(secret));
  const resealed=sealDebiCheckRequest({...value,consentAt:'2026-10-15T04:02:00.000Z'});assert.equal(readDebiCheckRequest(resealed,identity).consentAt,'2026-10-15T04:02:00.000Z');
  for(const changed of [{id:'debicheck-request:'+randomUUID()},{organisationId:'other'},{facilityId:'other'},{accountId:'other'}])assert.throws(()=>readDebiCheckRequest(value,{...identity,...changed}),/INTEGRITY_REVIEW/);
  for(const changed of [{monthlyAmount:'951.00'},{encryptedTerms:encryptDebiCheckTerms({...terms,bankAccountNumber:'991112345'})},{consentText:'Forged authorisation'},{signature:'0'.repeat(64)}])assert.throws(()=>readDebiCheckRequest({...value,...changed},identity),/INTEGRITY_REVIEW/);
  assert.throws(()=>privateDebiCheckTerms(sealDebiCheckRequest({...value,encryptedTerms:encryptDebiCheckTerms({...terms,templateId:'NCDCT000000002'})})),/INTEGRITY_REVIEW/);
  const projected=projectDebiCheckRequest(value,'REVIEWED');assert.equal(projected.authenticationSubmitted,false);assert.equal(projected.collectionEnabled,false);assert.equal(projected.financialReceipt,false);assert.ok(!('encryptedTerms' in projected));assert.match(projected.consentText,/does not send it to my bank/);
  assert.throws(()=>projectDebiCheckRequest(value,'BANK_AUTHENTICATED'),/STATE_REVIEW/);
  assert.throws(()=>encryptDebiCheckTerms({...terms,firstCollectionAmount:'0.00'}),/TERMS_INVALID/);
  assert.equal(debiCheckPayerSchema.safeParse({bankAccountNumber:'1234'}).success,false);
 }finally{if(oldAuth===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=oldAuth;if(oldVault===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=oldVault;}
});
