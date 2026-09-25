import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/maintenance-status-recovery",{recursive:true});
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let mode='denied',status='OPEN',patches=0,pending,readFail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations',route=>readFail?route.abort():route.fulfill({json:{data:{tasks:[],maintenance:[{id:'synthetic-repair',title:'Synthetic repair',status,priority:'NORMAL',facility:{name:'Synthetic facility'},unit:{number:'TEST'}}],products:[],storagePackages:[],dailyCloses:[],notes:[],facilities:[]}}}));
  await page.route('**/api/v1/operations/maintenance/synthetic-repair',route=>{
   patches++;assert.equal(route.request().method(),'PATCH');const desired=route.request().postDataJSON().status;
   if(mode==='hold'){pending=route;return;}
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Access denied.'}}});
   if(mode==='validation')return route.fulfill({status:400,json:{error:{message:'Check request status.'}}});
   if(mode==='network')return route.abort();
   if(mode==='malformed')return route.fulfill({json:{data:{id:'wrong',status:desired}}});
   if(mode==='server')return route.fulfill({status:500,json:{error:{message:'Unavailable'}}});
   if(mode==='lost'){status='COMPLETED';return route.abort();}
   status=desired;if(mode==='read-fail')readFail=true;return route.fulfill({json:{data:{id:'synthetic-repair',status}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const start=page.getByRole('button',{name:'Start',exact:true});const complete=page.getByRole('button',{name:'Complete',exact:true});const cancel=page.getByRole('button',{name:'Cancel',exact:true});
  await start.click();await expect(page.getByRole('alert')).toContainText('Access denied');await expect(start).toBeEnabled();
  mode='validation';await start.click();await expect(page.getByRole('alert')).toContainText('Check request status');await expect(start).toBeEnabled();
  mode='hold';await page.clock.install();await start.evaluate(button=>{button.click();button.click();});await expect(start).toBeDisabled();await expect.poll(()=>patches).toBe(3);await page.clock.fastForward(21000);await expect(page.getByRole('alert')).toContainText('could not confirm');await expect(page.getByRole('button',{name:'New request',exact:true})).toBeDisabled();await pending.abort().catch(()=>{});assert.equal(patches,3);
  await page.screenshot({path:`output/maintenance-status-recovery/${width}.png`,fullPage:true});
  for(const uncertain of ['malformed','server','network','lost']){await page.reload();mode=uncertain;await start.click();await expect(page.getByRole('alert')).toContainText('could not confirm');await expect(start).toBeDisabled();await expect(complete).toBeDisabled();await expect(cancel).toBeDisabled();}
  assert.equal(patches,7);await page.getByRole('button',{name:'Reload maintenance status',exact:true}).click();await expect(page.getByText('No service requests',{exact:true})).toBeVisible();assert.equal(patches,7);
  mode='success';status='OPEN';await page.reload();await start.click();await expect(start).toHaveCount(0);await expect(complete).toBeEnabled();await complete.click();await expect(page.getByText('No service requests',{exact:true})).toBeVisible();
  status='OPEN';await page.reload();await cancel.click();await expect(page.getByText('No service requests',{exact:true})).toBeVisible();assert.equal(patches,10);
  status='OPEN';mode='read-fail';await page.reload();await start.click();await expect(page.getByRole('alert')).toContainText('may be out of date');await expect(start).toHaveCount(0);readFail=false;await page.getByRole('button',{name:'Retry loading',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);assert.equal(patches,11);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: maintenance denial/validation, duplicate clicks, timeout, malformed/500/network/lost response, read-only reload, all three status transitions and post-save refresh failure at1440/390/320px; no mutation retry.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
