import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{TenantPaymentRequests}from'./src/components/tenant-payment-requests';function Fixture(){const[id,setId]=useState('account-a');return <main><button onClick={()=>setId('account-b')}>Switch account</button><TenantPaymentRequests key={id} accountId={id}/></main>}createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";','');
const server=createServer((request,response)=>{
 response.setHeader('content-type',request.url==='/app.js'?'text/javascript':request.url==='/style.css'?'text/css':'text/html');
 response.end(request.url==='/app.js'?bundle.outputFiles[0].text:request.url==='/style.css'?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();
try {
 await mkdir('output/tenant-payment-requests',{recursive:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 let fail=false,stale=false,unknown=false;
 await context.route('**/api/tenant/payment-requests**',async route=>{
  assert.equal(route.request().method(),'GET');
  const account=new URL(route.request().url()).searchParams.get('accountId');
  assert.ok(['account-a','account-b'].includes(account));
  if(fail)return route.fulfill({status:503,json:{error:'Payment requests are temporarily unavailable.'}});
  return route.fulfill({json:{data:{requests:account==='account-b'?[]:[{paymentId:'synthetic-only',status:'READY',paymentStatus:'TEST_PENDING',amount:'40.00',sourceCurrent:!stale,methods:[{type:'CreditCard',text:'Card payment',requiresReview:unknown,links:[{label:'Pay online',url:'https://paynow.netcash.co.za/site/paynow.aspx?token=synthetic'}],instructions:[]},{type:'EFT',text:'Bank EFT',requiresReview:false,links:[],instructions:[{name:'Reference',value:'SYNTHETIC'.repeat(40)}]}]}]}}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const refresh=page.getByRole('button',{name:'Refresh account payment requests',exact:true}),link=page.getByRole('link',{name:'Pay online',exact:true});
 await expect(link).toBeVisible();
 await expect(page.getByText('Test requests are separate from live payments and do not reduce your balance.',{exact:false})).toBeVisible();
 for(const width of[1440,768,390,320]){
  await page.setViewportSize({width,height:1000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`tenant overflow ${width}`);
  await page.screenshot({path:`output/tenant-payment-requests/${width}.png`,fullPage:true});
 }
 fail=true;await refresh.click();await expect(page.getByRole('alert')).toContainText('temporarily unavailable');await expect(link).toHaveCount(0);
 fail=false;await refresh.click();await expect(link).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
 stale=true;await refresh.click();await expect(link).toHaveCount(0);await expect(page.getByText('The store must review this source or outcome before payment instructions can be shown.',{exact:true})).toBeVisible();
 stale=false;unknown=true;await refresh.click();await expect(link).toHaveCount(0);await expect(page.getByText('This provider option needs staff review.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Switch account',exact:true}).click();await expect(page.getByText('No payment requests for this account.',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Card payment',exact:true})).toHaveCount(0);
 assert.deepEqual(errors,[]);
 console.log('Tenant payment-request fixture passed: selected-account isolation, failed refresh link hold/recovery, changed-source and unknown-method holds, 1440/768/390/320 bounds. Synthetic GET only; no provider or financial action.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
