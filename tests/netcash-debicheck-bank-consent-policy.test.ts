import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {bankConsentSourceSchema,prepareBankAuthenticationConsent,readBankAuthenticationConsent,acceptBankAuthenticationConsent,bankAuthenticationConsentHash,projectBankAuthenticationConsent,type BankConsentSource} from '../src/lib/payments/netcash-debicheck-bank-consent-policy';

test('bank-authentication permission has separate exact source bindings and no dispatch or collection authority',async t=>{
 const prior=process.env.AUTH_SECRET;process.env.AUTH_SECRET=randomBytes(32).toString('hex');
 const now=new Date('2026-10-16T04:00:00.000Z');
 const source:BankConsentSource={organisationId:'synthetic-org',facilityId:'synthetic-store',accountId:'synthetic-account',customerId:'synthetic-customer',tenancyId:'synthetic-tenancy',requestId:'debicheck-request:11111111-1111-4111-8111-111111111111',requestSignature:'1'.repeat(64),sourceHash:'2'.repeat(64),merchantHash:'3'.repeat(64),templateSourceHash:'4'.repeat(64),templateId:'NCDCT000000001',connectionId:'synthetic-connection',connectionUpdatedAt:now.toISOString(),tenantIdentityHash:'5'.repeat(64),providerApprovalId:'synthetic-future-provider-approval',providerApprovalHash:'6'.repeat(64),payerFingerprint:'7'.repeat(64),monthlyAmount:'950.00',startDate:'2026-11-01',bankSuffix:'2345'};
 const preview=()=>prepareBankAuthenticationConsent(source,now),identity=(value:ReturnType<typeof preview>)=>({id:value.recordId,...source});
 try{
  await t.test('a preview is not saved consent; acceptance binds the same expiry, identity, source and displayed terms',()=>{
   const p=preview(),saved=acceptBankAuthenticationConsent(p,new Date(now.getTime()+1000));
   assert.equal(p.consentedAt,null);assert.equal(saved.recordId,p.recordId);assert.equal(saved.expiresAt,p.expiresAt);assert.deepEqual(readBankAuthenticationConsent(saved,identity(p)),saved);assert.match(saved.consentText,/one DebiCheck bank-authentication request/);assert.match(saved.consentText,/R950\.00/);assert.match(saved.consentText,/2026-11-01/);assert.match(saved.consentText,/2345/);
   assert.notEqual(bankAuthenticationConsentHash(p),bankAuthenticationConsentHash(saved));
   for(const flag of ['providerActionPerformed','collectionEnabled','financialReceipt','retryAllowed']as const)assert.equal(projectBankAuthenticationConsent(saved,'CONSENTED',now)[flag],false);
  });
  await t.test('wrong subject, changed source, approval, payer or amount cannot reuse the original signed permission',()=>{
   const p=preview();
   for(const field of ['organisationId','facilityId','accountId','customerId']as const)assert.throws(()=>readBankAuthenticationConsent(p,{...identity(p),[field]:'foreign'}),/INTEGRITY/);
   for(const change of [{monthlyAmount:'1.00'},{templateSourceHash:'9'.repeat(64)},{providerApprovalId:'other-approval'},{payerFingerprint:'9'.repeat(64)},{requestSignature:'9'.repeat(64)},{merchantHash:'9'.repeat(64)}])assert.throws(()=>readBankAuthenticationConsent({...p,source:{...p.source,...change}},identity(p)),/INTEGRITY/);
   assert.throws(()=>readBankAuthenticationConsent({...p,consentText:'I approve a different purpose.'},identity(p)),/INTEGRITY/);
  });
  await t.test('future, expired or already accepted previews cannot be accepted again or extend the ten-minute window',()=>{
   const p=preview();assert.throws(()=>acceptBankAuthenticationConsent(p,new Date(now.getTime()-1)),/EXPIRED/);assert.throws(()=>acceptBankAuthenticationConsent(p,new Date(p.expiresAt)),/EXPIRED/);
   const accepted=acceptBankAuthenticationConsent(p,now);assert.throws(()=>acceptBankAuthenticationConsent(accepted,now),/EXPIRED/);assert.throws(()=>projectBankAuthenticationConsent(p,'CONSENTED',now),/STATE/);assert.throws(()=>projectBankAuthenticationConsent(accepted,'PREVIEW',now),/STATE/);
   assert.equal(projectBankAuthenticationConsent(accepted,'CONSENTED',new Date(p.expiresAt)).expired,true);
  });
  await t.test('setup permission, malformed dates, extra private fields and noncanonical money do not enter this contract',()=>{
   const p=preview();assert.throws(()=>readBankAuthenticationConsent({...p,consentVersion:'debicheck-setup-request-v1'},identity(p)));
   for(const extra of [{bankAccountNumber:'123456789'},{monthlyAmount:'0.00'},{monthlyAmount:'0950.00'},{startDate:'2026-02-30'},{providerApprovalHash:'not-a-hash'}])assert.throws(()=>bankConsentSourceSchema.parse({...source,...extra}));
   process.env.AUTH_SECRET='short';assert.throws(()=>preview(),/SIGNING_REQUIRED/);
  });
 }finally{if(prior===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=prior}
});
