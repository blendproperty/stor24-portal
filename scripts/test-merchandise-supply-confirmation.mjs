import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MerchandiseOrderQueue} from './src/components/merchandise-order-queue';createRoot(document.getElementById('root')).render(<MerchandiseOrderQueue/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/merchandise-supply-confirmation",{recursive:true});
try {for(const width of [1440,390,320]) for(const mode of ['bad-json','denied','expired','malformed','wrong-id','wrong-status','bad-date','network','server','timeout','rejected','success-refresh-failure']) {
 const page=await browser.newPage({viewport:{width,height:900}});let posts=0,reads=0,pending;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const order={id:'synthetic',status:'PAID',total:'100',currency:'ZAR',items:[{name:'Synthetic boxes',quantity:2}],account:{accountNumber:'TEST-1',customer:{firstName:'Synthetic',lastName:'Customer',companyName:null}}};
 await page.route('**/api/v1/operations/merchandise-orders',route=>{
  if(route.request().method()==='GET'){reads++;if(mode==='success-refresh-failure'&&posts)return route.abort();return route.fulfill({json:{data:[{...order,status:posts&&mode!=='rejected'?'FULFILLED':'PAID'}]}});}
  posts++;
  if(mode==='timeout'){pending=route;return;}
  if(mode==='network')return route.abort();
  if(mode==='bad-json')return route.fulfill({body:'not json'});
  if(mode==='denied'||mode==='expired')return route.fulfill({status:mode==='denied'?403:401,json:{error:{message:'Access denied'}}});
  if(mode==='rejected')return route.fulfill({status:409,json:{error:{message:'Verify payment and held stock.'}}});
  if(mode==='server')return route.fulfill({status:500,json:{error:{message:'Failed'}}});
  const data={id:mode==='wrong-id'?'other':'synthetic',status:mode==='wrong-status'?'PAID':'FULFILLED',fulfilledAt:mode==='bad-date'?'invalid':'2026-09-28T05:00:00.000Z'};
  return route.fulfill({json:mode==='malformed'?{}:{data}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Record collection / delivery',exact:true}).click();
 if(mode==='timeout')await page.clock.install();
 await page.getByRole('button',{name:'Confirm supplied',exact:true}).evaluate(button=>{button.click();button.click();});
 if(mode==='timeout'){await page.clock.fastForward(21000);await pending?.abort().catch(()=>{});}
 if(mode==='success-refresh-failure'){
  await expect(page.getByRole('status').filter({hasText:'Supply recorded'})).toContainText('Supply recorded');await expect(page.getByRole('alert')).toContainText('could not be loaded');await expect(page.getByText('Supplied',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Record collection / delivery',exact:true})).toHaveCount(0);
 }else if(mode==='denied'||mode==='expired'){
  await expect(page.getByText('Synthetic Customer',{exact:true})).toHaveCount(0);await expect(page.getByRole('alert').filter({hasText:mode==='denied'?'administrator':'sign in'})).toBeVisible();
 }else if(mode==='rejected'){
  await expect(page.getByRole('alert')).toContainText('Verify payment');await expect(page.getByRole('button',{name:'Confirm supplied',exact:true})).toBeEnabled();
 }else{
  await expect(page.getByRole('alert')).toContainText('could not confirm');await expect(page.getByRole('status').filter({hasText:'Supply recorded'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Confirm supplied',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Refresh orders',exact:true}).click();await expect(page.getByText('Supplied',{exact:true})).toBeVisible();
 }
 assert.equal(posts,1);assert.ok(reads>=1);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
 if(mode==='success-refresh-failure')await page.screenshot({path:`output/merchandise-supply-confirmation/${width}.png`,fullPage:true});await page.close();
}console.log('PASS: supply rejection/duplicate/timeout/malformed/wrong confirmation/lost result/GET recovery and saved-refresh failure at1440/390/320px.');}finally{await browser.close();await new Promise(r=>server.close(r));}
