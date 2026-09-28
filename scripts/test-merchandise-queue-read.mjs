import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MerchandiseOrderQueue} from './src/components/merchandise-order-queue';createRoot(document.getElementById('root')).render(<MerchandiseOrderQueue/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/merchandise-queue-read",{recursive:true});
try { for(const width of [1440,390,320]) {
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[],methods=[];let mode='fail',pending;
 page.on('pageerror',e=>errors.push(e.message));
 const order={id:'synthetic',status:'PAID',total:'100.00',currency:'ZAR',items:[{name:'Synthetic boxes',quantity:2}],account:{accountNumber:'TEST-1',customer:{firstName:'Synthetic',lastName:'Customer',companyName:null}}};
 await page.route('**/api/v1/operations/merchandise-orders',route=>{
  methods.push(route.request().method());
  if(mode==='fail')return route.abort();
  if(mode==='hold'){pending=route;return;}
  if(mode==='bad-json')return route.fulfill({body:'oops'});
  if(mode==='malformed')return route.fulfill({json:{data:[{...order,account:null}]}});
  if(mode==='denied'||mode==='expired')return route.fulfill({status:mode==='denied'?403:401,json:{error:{message:'Denied'}}});
  return route.fulfill({json:{data:mode==='empty'?[]:[order]}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await expect(page.getByRole('alert')).toContainText('could not be loaded');
 await expect(page.getByText('No orders to display.',{exact:true})).toHaveCount(0);
 const refresh=page.getByRole('button',{name:'Refresh orders',exact:true});
 for(const failure of ['bad-json','malformed']){mode=failure;await refresh.click();await expect(page.getByRole('alert')).toContainText('could not be loaded');}
 mode='populated';await refresh.click();await expect(page.getByText('Synthetic Customer',{exact:true})).toBeVisible();
 mode='fail';await refresh.click();await expect(page.getByRole('alert')).toContainText('could not be loaded');await expect(page.getByRole('button',{name:'Record collection / delivery',exact:true})).toBeDisabled();
 mode='denied';await refresh.click();await expect(page.getByRole('alert')).toContainText('contact your administrator');await expect(page.getByText('Synthetic Customer',{exact:true})).toHaveCount(0);
 mode='expired';await refresh.click();await expect(page.getByRole('alert')).toContainText('sign in');
 mode='hold';await page.clock.install();await refresh.click();await expect(page.getByRole('status')).toContainText('Loading orders');await page.clock.fastForward(21000);await expect(page.getByRole('alert')).toBeVisible();await pending.abort().catch(()=>{});
 mode='empty';await refresh.click();await expect(page.getByText('No orders to display.',{exact:true})).toBeVisible();
 mode='populated';await refresh.click();await expect(page.getByText('Synthetic Customer',{exact:true})).toBeVisible();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
 await page.screenshot({path:`output/merchandise-queue-read/${width}.png`,fullPage:true});assert.ok(methods.every(m=>m==='GET'));assert.deepEqual(errors,[]);await page.close();
 } console.log('PASS: merchandise queue network/malformed/denial/timeout/empty/populated GET-only recovery at1440/390/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
