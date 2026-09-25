import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {TenantPendingOrders} from './src/components/tenant-pending-orders';const root=createRoot(document.getElementById('root'));window.showUnit=unit=>root.render(<TenantPendingOrders accountId='synthetic-account' unitId={unit}/>);window.showUnit('A');`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];const methods=[];let mode="failure",pending;
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/tenant/orders/pending?**", async route=>{
   methods.push(route.request().method());
   if(mode==="failure")return route.abort();
   if(mode==="hold"){pending=route;return;}
   if(mode==="malformed")return route.fulfill({json:{data:{}}});
   const unit=new URL(route.request().url()).searchParams.get("unit");
   return route.fulfill({json:{data:mode==="empty"?[]:[{id:`order-${unit}`,status:"PAYMENT_REVIEW",total:"123.45",currency:"ZAR"}]}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole("alert")).toContainText("could not check");
  mode="success";await page.getByRole("button",{name:"Retry order check"}).click();
  await expect(page.getByRole("link")).toHaveAttribute("href","/my/orders/order-A");
  mode="hold";await page.evaluate(()=>window.showUnit('B'));
  await expect(page.getByRole("status")).toContainText("Checking pending orders");
  await expect(page.getByRole("link")).toHaveCount(0);
  mode="success";await page.evaluate(()=>window.showUnit('C'));
  await expect(page.getByRole("link")).toHaveAttribute("href","/my/orders/order-C");
  await pending.fulfill({json:{data:[{id:"late-B",status:"PAYMENT_REVIEW",total:"1",currency:"ZAR"}]}}).catch(()=>{});
  await expect(page.getByRole("link")).toHaveAttribute("href","/my/orders/order-C");
  mode="hold";await page.clock.install();await page.evaluate(()=>window.showUnit('D'));
  await expect(page.getByRole("status")).toBeVisible();await page.clock.fastForward(21000);
  await expect(page.getByRole("alert")).toContainText("could not check");await pending.abort().catch(()=>{});
  mode="malformed";await page.getByRole("button",{name:"Retry order check"}).click();await expect(page.getByRole("alert")).toBeVisible();
  mode="empty";await page.getByRole("button",{name:"Retry order check"}).click();await expect(page.getByRole("status")).toHaveCount(0);await expect(page.getByRole("alert")).toHaveCount(0);await expect(page.getByRole("link")).toHaveCount(0);
  assert.ok(methods.length>0&&methods.every(m=>m==="GET"));assert.deepEqual(errors,[]);await page.close();
 }
 console.log("PASS: pending order failure/retry, timeout, malformed response, empty success and unit-switch stale-response protection; GET only at1440/390/320px.");
} finally {await browser.close();await new Promise(r=>server.close(r));}
