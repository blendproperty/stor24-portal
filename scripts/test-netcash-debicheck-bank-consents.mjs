import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{TenantDebiCheckBankConsents}from'./src/components/tenant-debicheck-bank-consents';import{NetcashDebiCheckBankConsents}from'./src/components/netcash-debicheck-bank-consents';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:16}}><TenantDebiCheckBankConsents accountId="account" requestId="debicheck-request:11111111-1111-4111-8111-111111111111"/><NetcashDebiCheckBankConsents facilities={[{id:'store-a',name:'Synthetic store'},{id:'store-b',name:'Other store'}]}/></main>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";','');
const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/app.js'?'text/javascript':request.url==='/style.css'?'text/css':'text/html');response.end(request.url==='/app.js'?bundle.outputFiles[0].text:request.url==='/style.css'?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();

try{
 await mkdir('output/netcash-debicheck-bank-consents',{recursive:true});const allErrors=[],writes=[];
 for(const width of [1440,768,390,320]){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();let rows=[],failed=false,malformed=false;
  const id='debicheck-bank-consent:11111111-1111-4111-8111-111111111111',requestId='debicheck-request:11111111-1111-4111-8111-111111111111';
  const base={id,requestId,accountId:'account',status:'PREVIEW',monthlyAmount:'950.00',startDate:'2026-11-01',bankSuffix:'2345',consentText:'I authorise one bank-authentication request for R950.00 monthly from 2026-11-01, bank account ending 2345. Saving does not send it or collect a payment.',consentedAt:null,expiresAt:new Date(Date.now()+600000).toISOString(),expired:false,providerActionPerformed:false,collectionEnabled:false,financialReceipt:false,retryAllowed:false};
  const tenant=page.getByRole('region',{name:'Permission for one bank-authentication request'}),staff=page.getByRole('region',{name:'Bank-request consent review'});
  page.on('pageerror',e=>allErrors.push(e.message));
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),isTenant=url.pathname==='/api/tenant/debicheck-bank-consents';assert.ok(isTenant||url.pathname==='/api/v1/payments/netcash/debicheck/bank-consents','Unexpected provider/API action');
   if(request.method()==='GET'){
    if(failed)return route.fulfill({status:503,json:{error:isTenant?'Permission history unavailable.':{message:'Permission history unavailable.'}}});
    const older={...base,id:'debicheck-bank-consent:22222222-2222-4222-8222-222222222222',status:'WITHDRAWN',consentedAt:new Date().toISOString(),attemptRecorded:false};
    let records=url.searchParams.has('cursor')?[older]:rows;
    if(!isTenant&&url.searchParams.get('facilityId')==='store-b')records=[];
    if(malformed)records=[{...older,collectionEnabled:true}];
    if(!isTenant)records=records.map(r=>({...r,accountNumber:'SYNTHETIC-001',canReview:r.status==='CONSENTED'}));
    return route.fulfill({json:{data:{available:true,records,nextCursor:!url.searchParams.has('cursor')&&rows.length?'synthetic-older':null}}});
   }
   assert.equal(request.method(),'POST');const value=request.postDataJSON();writes.push({width,isTenant,action:value.action??'review'});
   if(isTenant&&value.action==='preview'){assert.deepEqual(value,{action:'preview',accountId:'account',requestId});return route.fulfill({json:{data:{...base,preview:{recordId:id,syntheticOpaqueTicket:true}}}})}
   if(isTenant&&value.action==='save'){assert.equal(value.accepted,true);assert.equal(value.preview.recordId,id);rows=[{...base,status:'CONSENTED',consentedAt:new Date().toISOString(),attemptRecorded:false}]}
   else if(isTenant&&value.action==='withdraw'){assert.equal(value.id,id);rows=rows.map(r=>({...r,status:'WITHDRAWN'}))}
   else{assert.deepEqual(value,{accountId:'account',id,confirmed:true});rows=rows.map(r=>({...r,status:'REVIEWED'}))}
   return route.fulfill({json:{data:rows[0]}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);const prepare=tenant.getByRole('button',{name:'Review permission for one bank request',exact:true});await expect(prepare).toBeVisible();await prepare.click();
  const save=tenant.getByRole('button',{name:'Save bank-request permission',exact:true});await expect(save).toBeDisabled();await tenant.getByRole('checkbox',{name:'I give the permission shown above for one bank-authentication request.',exact:true}).check();await save.click();await expect(tenant.getByRole('heading',{name:'CONSENTED',exact:true})).toBeVisible();
  await staff.getByRole('button',{name:'Refresh bank permissions',exact:true}).click();const review=staff.getByRole('button',{name:'Save independent bank-permission review',exact:true});await expect(review).toBeDisabled();await staff.getByRole('checkbox',{name:'I independently reviewed this exact tenant permission and its current source.',exact:true}).check();await review.click();await expect(staff.getByRole('heading',{name:'SYNTHETIC-001 — REVIEWED',exact:true})).toBeVisible();
  await tenant.getByRole('button',{name:'Refresh bank permissions',exact:true}).click();await expect(tenant.getByRole('heading',{name:'REVIEWED',exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Bank permission overflow ${width}`);await page.screenshot({path:`output/netcash-debicheck-bank-consents/review-${width}.png`,fullPage:true});
  await tenant.getByRole('button',{name:'Older bank permissions',exact:true}).click();await expect(tenant.getByRole('heading',{name:'WITHDRAWN',exact:true})).toBeVisible();await tenant.getByRole('button',{name:'Refresh bank permissions',exact:true}).click();
  failed=true;await tenant.getByRole('button',{name:'Refresh bank permissions',exact:true}).click();await expect(tenant.getByRole('heading',{name:'REVIEWED',exact:true})).toHaveCount(0);await expect(tenant.getByRole('alert')).toBeFocused();failed=false;await tenant.getByRole('button',{name:'Refresh bank permissions',exact:true}).click();
  malformed=true;await staff.getByRole('button',{name:'Refresh bank permissions',exact:true}).click();await expect(staff.getByRole('heading',{name:'SYNTHETIC-001 — REVIEWED',exact:true})).toHaveCount(0);await expect(staff.getByRole('alert')).toBeFocused();malformed=false;await staff.getByRole('button',{name:'Refresh bank permissions',exact:true}).click();
  await tenant.getByRole('button',{name:'Withdraw bank permission',exact:true}).click();await expect(tenant.getByRole('heading',{name:'WITHDRAWN',exact:true})).toBeVisible();
  await staff.getByRole('combobox',{name:'Bank permission store',exact:true}).selectOption('store-b');await expect(staff.getByText('No retained bank-request permissions for this store.',{exact:true})).toBeVisible();await expect(review).toHaveCount(0);
  assert.equal(writes.filter(r=>r.width===width).length,4);await context.close();
 }
 assert.deepEqual(allErrors,[]);console.log(JSON.stringify({result:'PASS',widths:[1440,768,390,320],syntheticPreparationPosts:writes.length,providerCalls:0,financialWrites:0,coverage:['explicit exact consent','independent review checkbox','history and older cursor','withdrawal','store change','failed and malformed response clearing and focus','no horizontal overflow']}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
