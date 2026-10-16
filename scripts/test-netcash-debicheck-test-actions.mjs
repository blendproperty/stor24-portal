import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{NetcashDebiCheckTestActions}from'./src/components/netcash-debicheck-test-actions';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:16}}><NetcashDebiCheckTestActions facilities={[{id:'cmfixturefacility000000001',name:'Synthetic store'},{id:'cmfixturefacility000000002',name:'Other store'}]} submitFacilities={['cmfixturefacility000000001']} statusFacilities={['cmfixturefacility000000001']} submitEnabled={true} statusEnabled={true}/></main>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";','');
const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/app.js'?'text/javascript':request.url==='/style.css'?'text/css':'text/html');response.end(request.url==='/app.js'?bundle.outputFiles[0].text:request.url==='/style.css'?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();


try{
 await mkdir('output/netcash-debicheck-test-actions',{recursive:true});const errors=[],writes=[];
 for(const width of[1440,768,390,320]){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();let attempted=false,failed=false,malformed=false,release,entered=false;
  const gate=new Promise(resolve=>{release=resolve}),id='debicheck-bank-consent:11111111-1111-4111-8111-111111111111',requestId='debicheck-request:11111111-1111-4111-8111-111111111111',attemptId=id.replace('bank-consent','attempt'),noReference=width===320;
  const permission={id,requestId,accountId:'account',status:'REVIEWED',monthlyAmount:'950.00',startDate:'2026-11-01',bankSuffix:'2345',consentText:'I authorise one bank-authentication request for R950.00 monthly from 2026-11-01, account ending 2345. This is not a collection.',consentedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),expired:false,providerActionPerformed:false,collectionEnabled:false,financialReceipt:false,retryAllowed:false,accountNumber:'SYNTHETIC-001',canReview:false};
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()==='GET'&&url.pathname==='/api/v1/payments/netcash/debicheck/bank-consents'){
    if(failed)return route.fulfill({status:503,json:{error:{message:'Saved evidence unavailable.'}}});
    const records=url.searchParams.get('facilityId')==='cmfixturefacility000000002'?[]:[{...permission,attemptRecorded:attempted,...(attempted?{expired:true,expiresAt:new Date(Date.now()-1000).toISOString()}:{}),...(malformed?{collectionEnabled:true}:{})}];return route.fulfill({json:{data:{records,nextCursor:null}}});
   }
   if(request.method()==='GET'&&url.pathname==='/api/v1/payments/netcash/debicheck/history'){
    assert.equal(url.searchParams.get('attemptId'),attemptId);const attempt={id:attemptId,requestId,accountNumber:'SYNTHETIC-001',bankSuffix:'2345',monthlyAmount:'950.00',startDate:'2026-11-01',claimedAt:new Date().toISOString(),completedAt:noReference?null:new Date().toISOString(),status:noReference?'CLAIMED':'OUTCOME_UNKNOWN',bankAuthenticationObserved:false,originalContractAvailable:!noReference,reconciliationRequired:true,retryAllowed:false,collectionAuthorised:false,financialReceipt:false};return route.fulfill({json:{data:{facilityId:'cmfixturefacility000000001',attempts:[attempt],selected:attempt,observations:[],nextCursor:null,nextObservationCursor:null,providerQueried:false}}});
   }
   assert.equal(url.pathname,'/api/v1/payments/netcash/debicheck/test-actions');assert.equal(request.method(),'POST');const body=request.postDataJSON();writes.push({width,body});
   if(body.action==='submit-test'){assert.equal(body.confirmation,'SUBMIT ONE BANK TEST');assert.equal(body.facilityId,'cmfixturefacility000000001');assert.equal(body.accountId,'account');assert.equal(body.consentId,id);attempted=true;entered=true;await gate;return route.fulfill({json:{data:{attemptId,newClaim:true,providerActionAttempted:true,originalResultRetained:!noReference,historyRequired:true,retryAllowed:false,collectionAuthorised:false,financialReceipt:false}}})}
   assert.equal(body.action,'read-status');assert.equal(body.attemptId,attemptId);assert.equal(body.confirmed,true);return route.fulfill({json:{data:{retained:true}}});
  });
  // History DTO uses real cuid facility syntax; the component's selected-store
  // contract is preserved by replacing only this fixture's store identifiers.
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('combobox',{name:'Saved bank permission',exact:true}).selectOption(id);const submit=page.getByRole('button',{name:'Submit one approved bank test',exact:true});await expect(submit).toBeDisabled();await page.getByRole('textbox',{name:'Bank test confirmation',exact:true}).fill('SUBMIT ONE BANK TEST');await submit.click();await expect.poll(()=>entered).toBe(true);await expect(submit).toBeDisabled();await submit.evaluate(el=>el.click());assert.equal(writes.filter(w=>w.width===width&&w.body.action==='submit-test').length,1);release();
  await expect(page.getByRole('status').filter({hasText:noReference?'original attempt is held':'Original result retained'})).toBeVisible();await page.getByRole('combobox',{name:'Saved bank permission',exact:true}).selectOption(id);await expect(page.getByText('An original attempt already exists. Submitting it again is blocked.',{exact:true})).toBeVisible();await expect(submit).toHaveCount(0);
  const status=page.getByRole('button',{name:'Read current status for original bank test',exact:true});if(noReference){await expect(status).toHaveCount(0);await expect(page.getByText('No original returned contract is available for an automatic status lookup. Ask staff to investigate the original provider evidence.',{exact:true})).toBeVisible()}else{await expect(status).toBeVisible();await status.click();await expect(page.getByRole('status').filter({hasText:'original outcome is unchanged'})).toBeVisible()}
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,text:e.textContent.slice(0,90),width:e.getBoundingClientRect().width})));if(overflow.length)console.log(JSON.stringify({width,overflow}));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Bank test overflow ${width}`);await page.screenshot({path:`output/netcash-debicheck-test-actions/held-${width}.png`,fullPage:true});
  malformed=true;await page.getByRole('button',{name:'Refresh saved bank-test evidence',exact:true}).click();await expect(page.getByRole('combobox',{name:'Saved bank permission',exact:true})).toHaveCount(0);await expect(page.getByRole('alert')).toBeFocused();malformed=false;await page.getByRole('button',{name:'Refresh saved bank-test evidence',exact:true}).click();failed=true;await page.getByRole('button',{name:'Refresh saved bank-test evidence',exact:true}).click();await expect(page.getByRole('alert')).toBeFocused();failed=false;await page.getByRole('button',{name:'Refresh saved bank-test evidence',exact:true}).click();
  await page.getByRole('combobox',{name:'Bank test store',exact:true}).selectOption('cmfixturefacility000000002');await expect(submit).toHaveCount(0);assert.equal(writes.filter(w=>w.width===width&&w.body.action==='submit-test').length,1);await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',widths:[1440,768,390,320],syntheticPosts:writes.length,physicalProviderCalls:0,financialWrites:0,coverage:['typed purpose confirmation','duplicate click blocked','retained unknown prevents resubmission','missing original contract held','status read after consent expiry','scope change','malformed/failure clears controls and focuses error','no horizontal overflow']}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
