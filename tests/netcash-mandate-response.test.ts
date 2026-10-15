import assert from 'node:assert/strict';import test from 'node:test';
import {mandateCreationResult,niwsStringResult} from '../src/lib/payments/netcash-niws-response';
import {addHostedMandate,parseAddMandateResponse,requestMandateData,type MandateTerms} from '../src/lib/payments/netcash-mandate';
import {niwsMandateResponse,niwsStringResponse} from './fixtures/niws-mandate-response';

test('AddMandate accepts only its complete current-WSDL response and never returns diagnostic bank data',()=>{
 const good=niwsMandateResponse('000','https://short.surf/synthetic');assert.equal(parseAddMandateResponse(good),'https://short.surf/synthetic');
 for(const code of ['100','200','203'])assert.throws(()=>parseAddMandateResponse(niwsMandateResponse(code,null,['synthetic private diagnostic'])),new RegExp('^Error: MANDATE_PROVIDER_'+code+'$'));
 const failures=[
  '<r><b:ErrorCode>000</b:ErrorCode><b:MandateUrl>https://short.surf/synthetic</b:MandateUrl></r>',
  '<r><ErrorCode>100</ErrorCode></r>',good.slice(0,-10),good+good,
  good.replace('http://schemas.xmlsoap.org/soap/envelope/','http://www.w3.org/2003/05/soap-envelope'),
  good.replaceAll('http://tempuri.org/','https://example.invalid/wrong'),
  good.replaceAll('http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS','https://example.invalid/wrong'),
  good.replace('<a:ErrorCode>000</a:ErrorCode>','<a:ErrorCode>000</a:ErrorCode><a:ErrorCode>100</a:ErrorCode>'),
  good.replace('</a:MandateUrl>','</a:MandateUrl><a:MandateUrl>https://short.surf/other</a:MandateUrl>'),
  good.replace('<a:MandateUrl>','<a:MandateUrl i:nil="true">'),
  good.replace('<s:Body>','<s:Body xmlns:i="http://www.w3.org/2001/XMLSchema-instance" i:nil="true">'),
  good.replace('<a:MandateUrl>','<a:Unknown>ignored</a:Unknown><a:MandateUrl>'),
  good.replace('https://short.surf/synthetic','<a:Nested>https://short.surf/synthetic</a:Nested>'),
  niwsMandateResponse('000','https://short.surf/synthetic',['synthetic error']),
  niwsMandateResponse('100','https://short.surf/synthetic'),niwsMandateResponse('000',null),
  good.replace('<AddMandateResult','<OtherResult').replace('</AddMandateResult>','</OtherResult>'),
  '<!DOCTYPE x [<!ENTITY wrong "000">]>'+good,
  good.replace('<a:Warnings i:nil="true"/>','<a:Warnings><a:string>wrong array namespace</a:string></a:Warnings>'),
  good.replace('<a:Warnings i:nil="true"/>','<a:Warnings>'+ 'x'.repeat(64000)+'</a:Warnings>'),
 ];
 for(const xml of failures)assert.throws(()=>parseAddMandateResponse(xml),/^Error: MANDATE_RESPONSE_INVALID$/);
 assert.deepEqual(mandateCreationResult(good),{code:'000',url:'https://short.surf/synthetic'});
});
test('NIWS string reports and PDF tokens require the exact SOAP operation and decode the bounded result once',()=>{
 const content='###BEGIN\t20261015\nA & B < C &amp; ✓\n###END';
 for(const method of ['RequestMandateData','RetrieveMandateData','BatchFileUpload','RequestFileUploadReport','RetrieveMandatePDF']){
  const good=niwsStringResponse(method,content);assert.equal(niwsStringResult(good,method),content);
  const start=good.indexOf('<'+method+'Result>')+method.length+8,end=good.indexOf('</'+method+'Result>');
  const cdata=good.slice(0,start)+'<![CDATA['+content+']]>'+good.slice(end);assert.equal(niwsStringResult(cdata,method),content);
  const duplicate=good.replace('</'+method+'Response>','<'+method+'Result>other</'+method+'Result></'+method+'Response>');
  for(const xml of ['<'+method+'Result>100</'+method+'Result>',good.slice(0,-6),good+good,niwsStringResponse('OtherMethod',content),duplicate,good.replace('http://tempuri.org/','https://example.invalid'),good.replace('<'+method+'Result>','<'+method+'Result xmlns:i="http://www.w3.org/2001/XMLSchema-instance" i:nil="true">'),good.replace('###END','<unexpected/>'),good.replace('<s:Body>','<s:Header/><s:Header/><s:Body>')])assert.throws(()=>niwsStringResult(xml,method),/^Error: MANDATE_RESPONSE_INVALID$/);
 }
 const large='x'.repeat(100000);assert.equal(niwsStringResult(niwsStringResponse('RetrieveMandateData',large),'RetrieveMandateData'),large);assert.throws(()=>niwsStringResult(niwsStringResponse('RetrieveMandateData','x'.repeat(4_000_000)),'RetrieveMandateData'),/RESPONSE_INVALID/);
});
test('a malformed mandate creation or report response cannot trigger retries or expose diagnostics',async()=>{
 const terms:MandateTerms={reference:'ST24-synthetic',agreementReference:'signed-lease-synthetic',agreementDate:'20261015',firstName:'Synthetic',surname:'Tenant',phone:'0820000000',email:'synthetic@example.invalid',amount:'950.00',commencementMonth:11,debitDay:1,noticeDays:30,holiday:'VeryNextOrdinaryBusinessDay',correlation:'synthetic-correlation-not-a-token-01'};
 let calls=0;await assert.rejects(addHostedMandate('synthetic-service-key',terms,async()=>{calls++;return new Response('<r><ErrorCode>000</ErrorCode><MandateUrl>https://short.surf/synthetic</MandateUrl><Errors>private</Errors></r>')}),/^Error: MANDATE_RESPONSE_INVALID$/);assert.equal(calls,1);
 calls=0;await assert.rejects(requestMandateData('synthetic-service-key',async()=>{calls++;return new Response('<RequestMandateDataResult>20000000.1.2.3</RequestMandateDataResult>')}),/^Error: MANDATE_RESPONSE_INVALID$/);assert.equal(calls,1);
});
