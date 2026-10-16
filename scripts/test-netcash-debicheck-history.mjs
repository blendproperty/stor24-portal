import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{NetcashDebiCheckHistory}from'./src/components/netcash-debicheck-history';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:16}}><NetcashDebiCheckHistory facilities={[{id:'cmfixturefacility000000001',name:'Synthetic store'},{id:'cmfixturefacility000000002',name:'Other permitted store'}]}/></main>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";','');
const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/app.js'?'text/javascript':request.url==='/style.css'?'text/css':'text/html');response.end(request.url==='/app.js'?bundle.outputFiles[0].text:request.url==='/style.css'?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();
try{
 await mkdir('output/netcash-debicheck-history',{recursive:true});
 const errors=[],requests=[],writes=[];
 for(const width of [1440,768,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();let failed=false,malformed=false;
  const base={requestId:'debicheck-request:11111111-1111-4111-8111-111111111111',bankSuffix:'2345',monthlyAmount:'950.00',startDate:'2026-11-01',claimedAt:'2026-10-15T12:00:00.000Z',completedAt:'2026-10-15T12:01:00.000Z',status:'OUTCOME_UNKNOWN',bankAuthenticationObserved:false,originalContractAvailable:true,reconciliationRequired:true,retryAllowed:false,collectionAuthorised:false,financialReceipt:false};
  const unknown={...base,id:'debicheck-attempt:11111111-1111-4111-8111-111111111111',accountNumber:'SYNTHETIC-UNKNOWN'},accepted={...base,id:'debicheck-attempt:22222222-2222-4222-8222-222222222222',requestId:'debicheck-request:22222222-2222-4222-8222-222222222222',accountNumber:'SYNTHETIC-ACCEPTED',status:'BANK_AUTHENTICATED',bankAuthenticationObserved:true,reconciliationRequired:false},older={...base,id:'debicheck-attempt:33333333-3333-4333-8333-333333333333',requestId:'debicheck-request:33333333-3333-4333-8333-333333333333',accountNumber:'SYNTHETIC-OLDER'};
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(url.pathname,'/api/v1/payments/netcash/debicheck/history');requests.push(url.search);
   if(request.method()!=='GET'){writes.push(request.method());return route.abort()}
   if(failed)return route.fulfill({status:503,json:{error:{message:'Simulated failed read'}}});
   const facilityId=url.searchParams.get('facilityId'),status=url.searchParams.get('status'),selectedId=url.searchParams.get('attemptId'),selected=[unknown,accepted,older].find(row=>row.id===selectedId)??null;
   const list=facilityId.endsWith('2')?[]:url.searchParams.has('cursor')?[older]:[unknown,accepted];
   const observations=selected?[{id:'retained-status',attemptId:selected.id,observedAt:'2026-10-15T12:05:00.000Z',bankAuthenticationObserved:!url.searchParams.has('observationCursor'),retryAllowed:false,collectionAuthorised:false,financialReceipt:false}]:[];
   return route.fulfill({json:{data:{facilityId,attempts:list.filter(row=>!status||row.status===status).map(row=>malformed?{...row,collectionAuthorised:true}:row),selected,observations,nextCursor:!status&&!url.searchParams.has('cursor')&&!facilityId.endsWith('2')?'older-attempts':null,nextObservationCursor:selected&&!url.searchParams.has('observationCursor')?'older-observations':null,providerQueried:false}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'SYNTHETIC-UNKNOWN — Outcome unknown — investigate'})).toBeVisible();
  await page.getByRole('button',{name:'Inspect retained status reads for SYNTHETIC-UNKNOWN'}).click();
  const detail=page.getByRole('complementary',{name:'Selected authentication evidence'});await expect(detail).toContainText('Original attempt: Outcome unknown');await expect(detail).toContainText('Bank authentication was observed in this retained read.');await expect(detail.getByRole('heading')).toBeFocused();
  await page.getByRole('button',{name:'Older retained status reads'}).click();await expect(detail).toContainText('Bank authentication was not established');
  await page.getByRole('button',{name:'Older authentication attempts'}).click();await expect(page.getByRole('heading',{name:'SYNTHETIC-OLDER — Outcome unknown — investigate'})).toBeVisible();
  await page.getByLabel('Original authentication outcome').selectOption('BANK_AUTHENTICATED');await expect(page.getByRole('heading',{name:'SYNTHETIC-ACCEPTED — Bank authentication observed'})).toBeVisible();await expect(page.getByText('SYNTHETIC-UNKNOWN',{exact:false})).toHaveCount(0);
  await page.getByLabel('DebiCheck history store').selectOption('cmfixturefacility000000002');await expect(page.getByText('No retained authentication attempts match',{exact:false})).toBeVisible();
  await page.getByLabel('DebiCheck history store').selectOption('cmfixturefacility000000001');await expect(page.getByRole('heading',{name:'SYNTHETIC-ACCEPTED — Bank authentication observed'})).toBeVisible();
  await page.screenshot({path:`output/netcash-debicheck-history/${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'No horizontal overflow at '+width);
  failed=true;await page.getByRole('button',{name:'Refresh recorded history'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'SYNTHETIC-ACCEPTED — Bank authentication observed'})).toHaveCount(0);
  failed=false;malformed=true;await page.getByRole('button',{name:'Refresh recorded history'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'SYNTHETIC-ACCEPTED — Bank authentication observed'})).toHaveCount(0);
  await context.close();
 }
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({widths:[1440,768,390,320],reads:requests.length,operationalWrites:writes.length,browserErrors:errors.length,originalAndObservedEvidenceSeparate:true,failedAndMalformedReadsClearHistory:true}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
