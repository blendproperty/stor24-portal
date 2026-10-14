import assert from 'node:assert/strict';
import test from 'node:test';
import {buildDebiCheckAuthenticationEnvelope,debiCheckAuthenticationFields,parseDebiCheckCurrentStatus,readDebiCheckCurrentStatus,type DebiCheckAuthenticationTerms} from '../src/lib/payments/netcash-debicheck-soap';
const key='11111111-1111-4111-8111-111111111111',reference='NC000000000001';
const terms:DebiCheckAuthenticationTerms={accountReference:'SYNTHETIC-ONLY',templateId:'NCDCT000000001',isIdNumber:false,debtorIdentification:'SYNTHETIC-PASSPORT',accountName:'Synthetic & Account',bankAccountName:'Synthetic Account',branchCode:'000000',bankAccountNumber:'000000000',bankAccountType:'Current',mobileNumber:'0000000000',emailAddress:'synthetic@example.invalid',collectionAmount:'100.00',firstCollectionDiffers:true,firstCollectionAmount:'50.00',firstCollectionDate:'2026-11-01',monthlyCollectionDay:1,debtorIdentificationCode:'P'};
const xml=(status='Accepted')=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><DebiCheckAuthenticationCurrentStatusResponse xmlns="http://tempuri.org/"><DebiCheckAuthenticationCurrentStatusResult xmlns:a="http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><a:ErrorCode>000</a:ErrorCode><a:CancellationReason i:nil="true"/><a:ContractReference>${reference}</a:ContractReference><a:DateCancelled i:nil="true"/><a:Status>${status}</a:Status><a:UpdateDate>20261014</a:UpdateDate></DebiCheckAuthenticationCurrentStatusResult></DebiCheckAuthenticationCurrentStatusResponse></s:Body></s:Envelope>`;
test('TT1 authentication preparation follows current WSDL sequence, enums and date without a bank call',()=>{
 const fields=debiCheckAuthenticationFields(key,terms);
 assert.deepEqual(fields.map(([name])=>name),['ServiceKey','AccountReference','DebiCheckMandateTemplateId','IsIdNumber','DebtorIdentification','AccountName','BankAccountName','BranchCode','BankAccountNumber','BankAccountType','MobileNumber','EmailAddress','CollectionAmount','FirstCollectionDiffers','FirstCollectionAmount','FirstCollectionDate','collectionDayCode','DebtorIdentificationCode']);
 assert.deepEqual(fields.find(([name])=>name==='FirstCollectionDate'),['FirstCollectionDate','20261101']);assert.deepEqual(fields.find(([name])=>name==='collectionDayCode'),['collectionDayCode','MNTH_01']);
 const body=buildDebiCheckAuthenticationEnvelope(key,terms);assert.match(body,/<AccountName>Synthetic &amp; Account<\/AccountName>/);assert.match(body,/<BankAccountType>Current<\/BankAccountType>/);assert.match(body,/<IsIdNumber>false<\/IsIdNumber>/);
});
test('invalid authentication terms cannot be serialised as an authentic request',()=>{
 for(const value of[{...terms,monthlyCollectionDay:0},{...terms,templateId:'invented-template'},{...terms,bankAccountType:'1'},{...terms,firstCollectionDate:'2026-02-30'},{...terms,firstCollectionDiffers:false},{...terms,collectionAmount:'0.00'},{...terms,isIdNumber:true},{...terms,debtorIdentificationCode:'I'},{...terms,accountReference:'bad<ref>'},{...terms,bankAccountName:'bad\u0000name'}])assert.throws(()=>buildDebiCheckAuthenticationEnvelope(key,value as DebiCheckAuthenticationTerms),/TERMS_INVALID/);
 assert.throws(()=>buildDebiCheckAuthenticationEnvelope('invalid-key',terms),/CONFIGURATION_REQUIRED/);
 assert.throws(()=>buildDebiCheckAuthenticationEnvelope(key,{...terms,emailAddress:'bad\u0000@example.invalid'}),/TERMS_INVALID/);
});
test('status lookup uses the debit service key and exact read-only SOAP action and original reference',async()=>{
 let calls=0;const value=await readDebiCheckCurrentStatus(key,reference,async(url,options)=>{calls++;assert.equal(url,'https://ws.netcash.co.za/NIWS/NIWS_NIF.svc');assert.equal((options!.headers as Record<string,string>).SOAPAction,'"http://tempuri.org/INIWS_NIF/DebiCheckAuthenticationCurrentStatus"');assert.equal(options!.redirect,'error');assert.equal(options!.cache,'no-store');assert.match(String(options!.body),new RegExp(`<ServiceKey>${key}</ServiceKey><ContractReference>${reference}</ContractReference>`));return new Response(xml());});
 assert.equal(calls,1);assert.equal(value.bankAuthenticationObserved,true);assert.equal(value.collectionAuthorised,false);assert.equal(value.financialReceipt,false);assert.ok(!JSON.stringify(value).includes(key));
});
test('submitted, unknown, rejected and cancelled states never become collection authority',()=>{
 for(const status of['Pending','Submitted','Rejected','New provider state'])assert.equal(parseDebiCheckCurrentStatus(xml(status),reference).bankAuthenticationObserved,false);
 const cancelled=xml().replace('<a:DateCancelled i:nil="true"/>','<a:DateCancelled>20261014</a:DateCancelled>');assert.equal(parseDebiCheckCurrentStatus(cancelled,reference).bankAuthenticationObserved,false);
});
test('wrong contract, duplicate fields, malformed entities/dates and oversized/DTD results are held',()=>{
 for(const value of[xml().replace(reference,'NC000000000002'),xml().replace('<a:Status>','<a:Status>Accepted</a:Status><a:Status>'),xml().replace('20261014','20260230'),xml().replace('Accepted','&unknown;'),xml().replace('Accepted','&#0;'),xml()+xml(),'<!DOCTYPE private>'+xml(),xml().replace('Accepted','x'.repeat(65000)),xml().replace('<a:DateCancelled i:nil="true"/>','<a:DateCancelled/>')])assert.throws(()=>parseDebiCheckCurrentStatus(value,reference),/RESPONSE_REVIEW/);
 for(const code of['100','200','202'])assert.throws(()=>parseDebiCheckCurrentStatus(xml().replace('<a:ErrorCode>000','<a:ErrorCode>'+code),reference),new RegExp('STATUS_REJECTED_'+code));
});
test('failed transport never retries or exposes service keys or provider response text',async()=>{
 for(const transport of[async()=>{throw Error('private transport detail')},async()=>new Response('private provider text',{status:500}),async()=>new Response('x'.repeat(65000))]){let calls=0;await assert.rejects(readDebiCheckCurrentStatus(key,reference,async()=>{calls++;return transport()}),/^Error: DEBICHECK_STATUS_UNAVAILABLE$/);assert.equal(calls,1);}
 let calls=0;await assert.rejects(readDebiCheckCurrentStatus(key,'invalid',async()=>{calls++;return new Response(xml())}),/CONTRACT_INVALID/);assert.equal(calls,0);
});
test('status observation requires well-formed SOAP and the current WSDL data namespace',()=>{
 for(const value of[xml().replace('</s:Envelope>',''),xml().replace('http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS','https://foreign.invalid'),xml().replace('<s:Body>','<s:Body><unrelated/>'),xml().replace('<a:Status>Accepted</a:Status>','<a:Status>Accepted</wrong:Status>')])assert.throws(()=>parseDebiCheckCurrentStatus(value,reference),/RESPONSE_REVIEW/);
});
