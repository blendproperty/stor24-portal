import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {cardSourceHash} from '../src/lib/payments/card-autopay-enrollment-policy';
import {requireBankAuthenticationTestApproval,bankAuthenticationPayerFingerprint} from '../src/lib/payments/netcash-debicheck-bank-test-approval';
import type {DebiCheckAuthenticationTerms,parseDebiCheckTemplate} from '../src/lib/payments/netcash-debicheck-soap';

test('separate deployment test approval binds exact payer, subject, template, amount and time without inventing a provider approval',async t=>{
 const prior=process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL,key=process.env.AUTH_SECRET;process.env.AUTH_SECRET=randomBytes(32).toString('hex');
 const now=new Date('2026-10-16T04:00:00Z');
 // Deliberately synthetic raw labels: this is NOT a verified positive Netcash
 // TT1 response. The trusted deployment approval supplies the exact snapshot;
 // actual provider-approved values and a real payer remain external gates.
 const template:ReturnType<typeof parseDebiCheckTemplate>={templateId:'NCDCT000000001',detail:{AdjustmentAmount:'0.0000',AdjustmentCategory:'N',AdjustmentRuleIndicator:'Y',AdjustmentType:'AMNT',AuthenticationType:'SYNTHETIC APPROVED REALTIME',CollectionFrequency:'MNTH',CollectionFrequencyDayCode:'MNTH_01',DebitEntryClassCode:'0036',DebitValueType:'USAGE BASED',DebtorAuthCode:'SYNTHETIC TT1',DebtorAuthenticationRequired:'synthetic',InstallmentOccurrence:'RCUR',RMS:'False',TemplateName:'Synthetic approved template',TrackingDayCode:'01 Day tracking',TrackingIndicator:'Y'},monthlyDayOptions:['MNTH_01'],authenticationSubmissionEnabled:false,collectionEnabled:false};
 const terms:DebiCheckAuthenticationTerms={accountReference:'synthetic',templateId:template.templateId,isIdNumber:false,debtorIdentification:'SYNTHETIC-PASSPORT',debtorIdentificationCode:'P',accountName:'Synthetic tenant',bankAccountName:'Synthetic payer',branchCode:'000000',bankAccountNumber:'000123456',bankAccountType:'Current',mobileNumber:'0000000000',emailAddress:'synthetic@example.invalid',collectionAmount:'950.00',firstCollectionAmount:'950.00',firstCollectionDiffers:false,firstCollectionDate:'2026-11-01',monthlyCollectionDay:1};
 const expected={organisationId:'synthetic-org',facilityId:'synthetic-store',accountId:'synthetic-account',customerId:'synthetic-customer',merchantHash:'1'.repeat(64),templateId:template.templateId,templateSourceHash:cardSourceHash(template),payerFingerprint:bankAuthenticationPayerFingerprint('synthetic-org','synthetic-store',terms),monthlyAmount:'950.00',startDate:'2026-11-01'};
 const approval=()=>({...expected,version:1,purpose:'BANK_AUTHENTICATION_TEST_ONLY',authenticationMode:'TT1_SYNCHRONOUS',approvedAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString(),providerEvidenceReference:'Synthetic future provider reference',approvalRecordedBy:'Synthetic approved operator',collectionAuthorised:false});
 const configure=(value:unknown=approval())=>{process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=JSON.stringify(value)};
 try{
  await t.test('missing configuration and other-purpose approvals fail closed',()=>{
   delete process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL;assert.throws(()=>requireBankAuthenticationTestApproval(expected,template,now),/APPROVAL_REQUIRED/);
   for(const purpose of ['SIGNING_ONLY','PAY_NOW_TEST','COLLECTION_TEST']){configure({...approval(),purpose});assert.throws(()=>requireBankAuthenticationTestApproval(expected,template,now),/APPROVAL_REQUIRED/)}
   configure({...approval(),collectionAuthorised:true});assert.throws(()=>requireBankAuthenticationTestApproval(expected,template,now),/APPROVAL_REQUIRED/);
  });
  await t.test('an exact configured source yields a hash reference and never returns private payer values',()=>{
   configure();const result=requireBankAuthenticationTestApproval(expected,template,now);assert.match(result.providerApprovalHash,/^[a-f0-9]{64}$/);assert.equal(result.providerApprovalId,'debicheck-test-approval:'+result.providerApprovalHash);
   for(const privateValue of [terms.bankAccountNumber,terms.debtorIdentification,terms.emailAddress,'bankAccountNumber','providerEvidenceReference'])assert.ok(!JSON.stringify(result).includes(privateValue));
  });
  await t.test('all subject bindings are required and a fingerprint cannot be transferred across stores or bank details',()=>{
   configure();for(const field of Object.keys(expected)){assert.throws(()=>requireBankAuthenticationTestApproval({...expected,[field]:'foreign'},template,now))}
   const{payerFingerprint:removed,...incomplete}=expected;assert.ok(removed);assert.throws(()=>requireBankAuthenticationTestApproval(incomplete as typeof expected,template,now));
   assert.notEqual(bankAuthenticationPayerFingerprint('synthetic-org','other-store',terms),expected.payerFingerprint);assert.notEqual(bankAuthenticationPayerFingerprint('synthetic-org','synthetic-store',{...terms,bankAccountNumber:'000123457'}),expected.payerFingerprint);
  });
  await t.test('template details cannot be swapped away from the approved whole snapshot',()=>{
   configure();assert.throws(()=>requireBankAuthenticationTestApproval(expected,{...template,detail:{...template.detail,RMS:'True'}},now),/SOURCE_CHANGED/);
  });
  await t.test('a configured claim of realtime cannot override known batch, RMS, nonmonthly or missing first-day evidence',()=>{
   for(const change of [{detail:{...template.detail,AuthenticationType:'BATCH',DebtorAuthCode:'Batch (TT2)'}},{detail:{...template.detail,RMS:'True'}},{detail:{...template.detail,CollectionFrequency:'WEEK'}},{monthlyDayOptions:['MNTH_15']}]){
    const contradictory={...template,...change},hash=cardSourceHash(contradictory);configure({...approval(),templateSourceHash:hash});assert.throws(()=>requireBankAuthenticationTestApproval({...expected,templateSourceHash:hash},contradictory,now),/TEMPLATE_REVIEW/);
   }
  });
  await t.test('future, nearing-expiry or overlong windows and extra secret fields do not qualify',()=>{
   configure();assert.throws(()=>requireBankAuthenticationTestApproval(expected,template,new Date(now.getTime()-1)),/EXPIRED/);assert.throws(()=>requireBankAuthenticationTestApproval(expected,template,new Date(now.getTime()+3000001)),/EXPIRED/);
   configure({...approval(),expiresAt:new Date(now.getTime()+86400001).toISOString()});assert.throws(()=>requireBankAuthenticationTestApproval(expected,template,now),/REQUIRED/);
   configure({...approval(),bankAccountNumber:terms.bankAccountNumber});assert.throws(()=>requireBankAuthenticationTestApproval(expected,template,now),/REQUIRED/);
  });
 }finally{if(prior===undefined)delete process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL;else process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL=prior;if(key===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=key}
});
