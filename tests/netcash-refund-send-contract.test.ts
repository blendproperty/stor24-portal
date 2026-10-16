import test from 'node:test';
import assert from 'node:assert/strict';
import {transportRefundRequest} from '../src/lib/payments/netcash-refund-transport';
import {readRefundSendApproval,refundCredentialFingerprint,requireRefundRequestDate} from '../src/lib/payments/netcash-refund-send-policy';
import {cardSourceHash} from '../src/lib/payments/card-autopay-enrollment-policy';
const key='00000000-0000-0000-0000-000000000001',input={transactionId:'2147483647',amount:'12.50',wireFormat:'DECIMAL_DOT' as const};
const xml=(code:string)=>`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><RequestCreditCardRefundResponse xmlns="http://tempuri.org/"><RequestCreditCardRefundResult>${code}</RequestCreditCardRefundResult></RequestCreditCardRefundResponse></s:Body></s:Envelope>`;
test('refund request preserves exactly one bounded response without replay or financial settlement',async t=>{
 await t.test('000 is acknowledgement pending merchant authorization; 330 never authorizes resend',async()=>{
  for(const[code,outcome]of [['000','ACKNOWLEDGED_PENDING_MERCHANT'],['330','DUPLICATE_OWNERSHIP_UNKNOWN'],['100','REJECTED'],['202','REJECTED'],['316','REJECTED'],['200','UNKNOWN'],['999','UNKNOWN']]as const){
   let calls=0;const raw=xml(code),result=await transportRefundRequest(key,input,async(url,options)=>{calls++;assert.equal(url,'https://ws.netcash.co.za/PayNow/PayNow.svc');assert.equal(options?.redirect,'error');assert.match(String(options?.body),/<amount>12\.50<\/amount>/);return new Response(raw);});
   assert.equal(calls,1);assert.equal(result.outcome,outcome);assert.equal(result.complete,true);assert.equal(Buffer.from(result.bodyBase64,'base64').toString(),raw);assert.equal(result.financialPosting,false);assert.equal(result.retryAvailable,false);assert.ok(!JSON.stringify(result).includes(key));
  }
 });
 await t.test('one explicitly selected wire format, never a fallback',async()=>{
  let calls=0;await transportRefundRequest(key,{...input,wireFormat:'DECIMAL_COMMA'},async(_,options)=>{calls++;assert.match(String(options?.body),/<amount>12,50<\/amount>/);return new Response(xml('316'));});assert.equal(calls,1);
 });
 await t.test('overflow preserves an explicitly incomplete prefix and never accepts a complete-looking success prefix',async()=>{
  const raw=xml('000')+' '.repeat(64001),result=await transportRefundRequest(key,input,async()=>new Response(raw));assert.equal(result.complete,false);assert.equal(result.capturedBytes,64000);assert.equal(Buffer.from(result.bodyBase64,'base64').length,64000);assert.equal(result.outcome,'UNKNOWN');assert.equal(result.providerCode,null);
 });
 await t.test('stream failure retains captured bytes and unknown; no network exception text or retry',async()=>{
  let count=0;const stream=new ReadableStream<Uint8Array>({pull(controller){if(count++===0)controller.enqueue(new TextEncoder().encode(xml('000')));else controller.error(Error('PRIVATE-EXCEPTION'));}});
  const result=await transportRefundRequest(key,input,async()=>new Response(stream));assert.equal(result.complete,false);assert.equal(result.outcome,'UNKNOWN');assert.equal(Buffer.from(result.bodyBase64,'base64').toString(),xml('000'));assert.ok(!JSON.stringify(result).includes('PRIVATE-EXCEPTION'));
  let calls=0;const network=await transportRefundRequest(key,input,async()=>{calls++;throw Error('PRIVATE-CREDENTIAL');});assert.equal(calls,1);assert.equal(network.complete,false);assert.equal(network.httpStatus,null);assert.equal(network.outcome,'UNKNOWN');
 });
 await t.test('non-2xx, duplicate result, DTD and invalid UTF-8 cannot become acknowledgement',async()=>{
  for(const response of [new Response(xml('000'),{status:500}),new Response(xml('000').replace('</RequestCreditCardRefundResponse>','<RequestCreditCardRefundResult>000</RequestCreditCardRefundResult></RequestCreditCardRefundResponse>')),new Response('<!DOCTYPE x>'+xml('000')),new Response(Uint8Array.from([255,254]))]){
   const result=await transportRefundRequest(key,input,async()=>response);assert.equal(result.outcome,'UNKNOWN');assert.equal(result.providerCode,null);
  }
 });
 await t.test('invalid identities/amounts never reach transport',async()=>{
  for(const changed of [{...input,transactionId:'2147483648'},{...input,transactionId:'01'},{...input,amount:'0.00'},{...input,amount:'12,50'}]){let calls=0;await assert.rejects(transportRefundRequest(key,changed,async()=>{calls++;throw Error();}));assert.equal(calls,0);}
 });
});
test('refund provider approval uses one normalized strictly bounded operator assertion',()=>{
 const old=process.env.NETCASH_REFUND_REQUEST_APPROVAL,secret=process.env.AUTH_SECRET,now=new Date('2026-10-16T08:00:00Z');process.env.AUTH_SECRET='synthetic-refund-contract-key-123456789';
 const value={version:1,purpose:'CARD_REFUND_REQUEST_ONLY',organisationId:'org',facilityId:'store',accountId:'account',adjustmentId:'adjustment',paymentId:'payment',sourceHash:'1'.repeat(64),merchantKey:'2'.repeat(64),credentialFingerprint:'3'.repeat(64),transactionId:'123',amount:'0.50',wireFormat:'DECIMAL_DOT',environment:'live',providerEvidenceReference:'  Synthetic provider permission  ',approvalRecordedBy:'  Operator  ',approvedAt:'2026-10-16T07:00:00Z',expiresAt:'2026-10-16T09:00:00Z'};
 try{
  process.env.NETCASH_REFUND_REQUEST_APPROVAL=JSON.stringify(value);const parsed=readRefundSendApproval(now);assert.equal(parsed.providerEvidenceReference,'Synthetic provider permission');assert.equal(parsed.approvalRecordedBy,'Operator');
  process.env.NETCASH_REFUND_REQUEST_APPROVAL=JSON.stringify({...value,providerEvidenceReference:parsed.providerEvidenceReference,approvalRecordedBy:parsed.approvalRecordedBy},null,2);assert.equal(cardSourceHash(parsed),cardSourceHash(readRefundSendApproval(now)));
  for(const change of [{expiresAt:'2026-10-17T09:00:00Z'},{expiresAt:'2026-10-16T08:00:30Z'},{approvedAt:'2026-10-16T08:01:00Z'},{environment:'sandbox'},{wireFormat:'TRY_BOTH'},{extra:'forged'},{purpose:'SIGNING_ONLY'}]){process.env.NETCASH_REFUND_REQUEST_APPROVAL=JSON.stringify({...value,...change});assert.throws(()=>readRefundSendApproval(now));}
  assert.notEqual(refundCredentialFingerprint('org','connection',key),refundCredentialFingerprint('org','connection',key.replace(/1$/,'2')));
 }finally{if(old===undefined)delete process.env.NETCASH_REFUND_REQUEST_APPROVAL;else process.env.NETCASH_REFUND_REQUEST_APPROVAL=old;if(secret===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=secret;}
});

test('refund eligibility uses original transaction day with six-month/month-end/SAST boundary held for review',()=>{
 requireRefundRequestDate('2026-01-31',new Date('2026-07-30T12:00:00Z'));
 assert.throws(()=>requireRefundRequestDate('2026-01-31',new Date('2026-07-30T22:00:00Z')),/PROVIDER_DATE_REVIEW/);
 requireRefundRequestDate('2025-08-31',new Date('2026-02-27T12:00:00Z'));
 assert.throws(()=>requireRefundRequestDate('2025-08-31',new Date('2026-02-28T12:00:00Z')),/PROVIDER_DATE_REVIEW/);
 assert.throws(()=>requireRefundRequestDate('2026-10-17',new Date('2026-10-16T12:00:00Z')),/PROVIDER_DATE_REVIEW/);
 assert.throws(()=>requireRefundRequestDate('2026-02-30'));
});
