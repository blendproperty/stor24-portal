import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace view={new URLSearchParams(location.search).get('view')==='merchandise'?'merchandise':'operations'}/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/operations-read-recovery",{recursive:true});
try {
 for (const view of ['operations','merchandise']) for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[],methods=[];let mode='fail',pending;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations/merchandise-orders',route=>route.fulfill({json:{data:[]}}));
  await page.route('**/api/v1/operations',route=>{
   methods.push(route.request().method());
   if(route.request().method()==='POST'){mode='fail';return route.fulfill({status:201,json:{data:{id:'synthetic-new-task',title:'Synthetic added'}}});}
   if(mode==='fail')return route.abort();
   if(mode==='hold'){pending=route;return;}
   if(mode==='bad-json')return route.fulfill({body:'not json'});
   if(mode==='malformed')return route.fulfill({json:{data:{tasks:[]}}});
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Forbidden'}}});
   return route.fulfill({json:{data:{tasks:mode==='populated'?[{id:'synthetic-task',title:'Synthetic task',status:'OPEN',priority:'NORMAL',dueAt:null}]:[],maintenance:[],products:[],storagePackages:[],dailyCloses:[],notes:[],facilities:[{id:"synthetic-facility",name:"Synthetic facility",units:[]}]}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}?view=${view}`);
  const retry=page.getByRole('button',{name:/^(Retry loading|Check access again)$/});
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByText('No open tasks',{exact:true})).toHaveCount(0);
  await expect(page.getByText('No products match these filters.',{exact:true})).toHaveCount(0);
  for(const failure of ['malformed','bad-json','denied']){mode=failure;await retry.click();await expect(page.getByRole('alert')).toContainText(failure==='denied'?'contact your administrator':'could not be loaded');}
  mode='hold';await page.clock.install();await retry.click();await expect(page.getByRole('status')).toContainText('Loading operations data');
  await page.clock.fastForward(21000);await expect(page.getByRole('alert')).toBeVisible();await pending.abort().catch(()=>{});
  await page.screenshot({path:`output/operations-read-recovery/${view}-${width}.png`,fullPage:true});
  mode='empty';await retry.click();await expect(page.getByText(view==='operations'?'No open tasks':'No products match these filters.',{exact:true})).toBeVisible();
  if(view==='operations'){mode='populated';await page.reload();await expect(page.getByText('Synthetic task',{exact:true})).toBeVisible();await page.getByRole('button',{name:'New task',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('select[name=facilityId]').selectOption('synthetic-facility');await dialog.getByLabel('Title',{exact:true}).fill('Synthetic added');await dialog.getByRole('button',{name:'Create task',exact:true}).click();await expect(page.getByRole('alert')).toContainText('may be out of date');await expect(page.getByText('Synthetic task',{exact:true})).toBeVisible();mode='populated';await retry.click();await expect(page.getByRole('alert')).toHaveCount(0);}
  assert.ok(methods.length>0&&methods.every(m=>m==='GET'||m==='POST'));assert.equal(methods.filter(m=>m==='POST').length,view==='operations'?1:0);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: operations and merchandise failed read, malformed JSON/data, forbidden response, timeout, empty/populated recovery at1440/390/320px; GET-only retries, synthetic post-save read recovery, no false empty state or unhandled page errors.');
} finally {await browser.close();await new Promise(r=>server.close(r));}