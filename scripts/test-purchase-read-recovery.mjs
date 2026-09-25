import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {TenantPurchases} from './src/components/tenant-purchases';const root=createRoot(document.getElementById('root'));window.showUnit=unit=>root.render(<TenantPurchases unitKey={unit} unitNumber={unit} accountId='synthetic-account' unitId={unit} canShop={false} bookingPackages={[{id:'booking',publicReference:'SYNTHETIC',packageSelection:{packageName:'Booking box pack',status:'RESERVED',priceSnapshot:'25',itemsSnapshot:[],fulfilledAt:null}}]}/>);window.showUnit('A');`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"images",setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"image-fixture"}));b.onLoad({filter:/.*/,namespace:"image-fixture"},()=>({contents:"import React from 'react';export default function Image(p){return React.createElement('img',{src:p.src,alt:p.alt})}",loader:"jsx",resolveDir:process.cwd()}));}},{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[],methods=[];let mode="hold",pending;
  page.on("pageerror",e=>(errors.push(e.message),console.error(e.message)));
  await page.route("**/api/tenant/orders**",async route=>{
   methods.push(route.request().method());const url=new URL(route.request().url());
   if(url.pathname.endsWith('/pending'))return route.fulfill({json:{data:[]}});
   if(mode==="hold"){pending=route;return;}
   if(mode==="network")return route.abort();
   if(mode==="malformed")return route.fulfill({json:{data:{}}});
   const unit=url.searchParams.get('unit');
   return route.fulfill({json:{data:mode==="empty"?[]:[{id:`purchase-${unit}`,unitId:unit,status:'FULFILLED',total:'25',currency:'ZAR',paymentId:null,createdAt:'2026-09-25T08:00:00Z',fulfilledAt:null,items:[]}]}});
  });
  await page.clock.install();await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole('heading',{name:'Booking box pack'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Checking purchases…'})).toBeDisabled();
  await expect.poll(()=>Boolean(pending)).toBe(true);await page.clock.fastForward(21000);
  await expect(page.getByRole('alert')).toContainText('Refresh purchase status');await pending.abort().catch(()=>{});
  for(mode of ['network','malformed']){await page.getByRole('button',{name:'Refresh purchase status'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'Booking box pack'})).toBeVisible();}
  mode='success';await page.getByRole('button',{name:'Refresh purchase status'}).click();await expect(page.getByRole('link',{name:'View order status'})).toHaveAttribute('href','/my/orders/purchase-A');
  mode='hold';await page.evaluate(()=>window.showUnit('B'));await expect(page.getByRole('link',{name:'View order status'})).toHaveCount(0);
  mode='empty';await page.evaluate(()=>window.showUnit('C'));await expect(page.getByText('No completed separate purchases for this unit.',{exact:false})).toBeVisible();await pending.abort().catch(()=>{});
  assert.ok(methods.every(m=>m==='GET'));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS completed-purchase timeout/read retry, malformed response, successful/empty results and unit changes retain booking package; GET-only desktop/mobile fixtures.');
}finally{await browser.close();await new Promise(r=>server.close(r));}


