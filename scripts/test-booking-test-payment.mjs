/** Actual booking test-payment component, synthetic responses only. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BookingTestPayment} from './src/components/booking-test-payment';createRoot(document.getElementById('root')).render(<BookingTestPayment reservationId="booking-ci" requiredAmount={2199}/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic" });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server = createServer((req,res) => { res.setHeader("content-type",req.url === "/app.js" ? "text/javascript" : "text/html");res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:700px;margin:auto"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0,"127.0.0.1",r));
const browser = await chromium.launch(); await mkdir("output/booking-test-payment",{recursive:true});
try {
 for (const width of [1440,390,320]) {
  for (const scenario of ['off','success','lost','timeout','malformed','mismatch','denied','read-failure']) {
   const page=await browser.newPage({viewport:{width,height:900}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{const original=AbortSignal.timeout;AbortSignal.timeout=ms=>original.call(AbortSignal,Math.min(ms,150));});
   let posts=0,reads=0,saved=null;
   const state=()=>({reservationId:'booking-ci',enabled:scenario!=='off',generation:1,receipt:saved});
   await page.route('**/api/v1/move-in-training/payment**',async route=>{
    if(route.request().method()==='GET') { reads++;if(scenario==='read-failure'&&reads===1)return route.abort();return route.fulfill({json:{data:state()}}); }
    posts++;const input=route.request().postDataJSON();assert.deepEqual(input,{reservationId:'booking-ci',generation:1,amount:2199,testConfirmed:true});
    saved={id:'receipt-ci',amount:2199,recordedAt:'2026-09-29T08:00:00.000Z',testOnly:true};
    if(scenario==='lost')return route.abort();
    if(scenario==='timeout'){await new Promise(r=>setTimeout(r,350));return route.abort().catch(()=>{});}
    if(scenario==='denied'){saved=null;return route.fulfill({status:403,json:{error:{message:'Denied'}}});}
    if(scenario==='malformed')return route.fulfill({json:{data:{}}});
    if(scenario==='mismatch')return route.fulfill({json:{data:{...state(),reservationId:'wrong'}}});
    await new Promise(r=>setTimeout(r,30));return route.fulfill({json:{data:state()}});
   });
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   if(scenario==='off'){await expect(page.getByText('The owner must enable Manager training above. Then check status here.')).toBeVisible();assert.equal(posts,0);await expect(page.getByRole('button',{name:'Record test payment',exact:true})).toHaveCount(0);}
   else {
    if(scenario==='read-failure'){await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Check test-payment status',exact:true}).click();}
    const save=page.getByRole('button',{name:'Record test payment',exact:true});await expect(save).toBeVisible();
    await page.getByRole('checkbox').check();await save.dblclick();
    if(['lost','timeout','malformed','mismatch'].includes(scenario)){await expect(page.getByRole('alert')).toContainText('uncertain');await expect(save).toBeDisabled();await page.getByRole('button',{name:'Check test-payment status',exact:true}).click();}
    if(scenario==='denied')await expect(page.getByRole('alert')).toContainText('access changed');
    else await expect(page.getByRole('status')).toContainText('Test payment recorded: R 2199.00');
    assert.equal(posts,1);assert.ok(reads>=1);
   }
   assert.deepEqual(errors,[]);
   const box=await page.getByRole('region',{name:'Booking test payment'}).boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width);
   if(scenario==='success')await page.screenshot({path:`output/booking-test-payment/${width}.png`});
   await page.close();
  }
 }
 console.log('PASS booking test payment desktop/mobile: off, saved, denial, duplicate, uncertain result and GET-only recovery.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
