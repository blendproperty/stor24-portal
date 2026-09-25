import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace view="merchandise"/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/product-update-recovery",{recursive:true});
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1100}}); const errors=[]; let mode='validation',patches=0,pending,readFail=false;
  const original={id:'synthetic-product',facilityId:'synthetic-facility',sku:'TEST',name:'Synthetic product',category:'Test',barcode:null,imageUrl:null,costPrice:'1',sellingPrice:'2',quantityOnHand:5,quantityReserved:0,reorderPoint:0,active:true,facility:{name:'Synthetic facility'}}; let saved={...original};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations/merchandise-orders',r=>r.fulfill({json:{data:[]}}));
  await page.route('**/api/v1/operations',r=>readFail?r.abort():r.fulfill({json:{data:{products:[saved],facilities:[],tasks:[],maintenance:[],storagePackages:[],dailyCloses:[],notes:[]}}}));
  await page.route('**/api/v1/operations/products/*',r=>{
   assert.equal(r.request().method(),'PATCH');patches++;const p=r.request().postDataJSON();
   if(mode==='hold'){pending=r;return;}
   if(mode==='validation'||mode==='denied')return r.fulfill({status:mode==='validation'?400:403,json:{error:{message:'Check details or access.'}}});
   const result={...saved,...p,costPrice:String(p.costPrice),sellingPrice:String(p.sellingPrice)};
   if(mode==='malformed')return r.fulfill({json:{data:{id:saved.id}}});
   if(['id','facilityId','name','sku','sellingPrice','active'].includes(mode))return r.fulfill({json:{data:{...result,[mode]:mode==='active'?false:'wrong'}}});
   if(mode==='server'||mode==='conflict')return r.fulfill({status:mode==='server'?500:409,json:{error:{message:'Unavailable'}}});
   saved=result;if(mode==='lost')return r.abort();if(mode==='read-fail')readFail=true;return r.fulfill({json:{data:result}});
  });
  const dialog=page.getByRole('dialog');const submit=dialog.getByRole('button',{name:'Save product',exact:true});
  async function open(){await page.locator('.merchandise-table tbody tr').click();await dialog.getByLabel('Product name',{exact:true}).fill('Changed product');await dialog.locator('input[name=sellingPrice]').fill('3');}
  await page.goto(`http://127.0.0.1:${server.address().port}`);await open();
  for(const rejection of ['validation','denied']){mode=rejection;await submit.click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(submit).toBeEnabled();await expect(dialog.getByLabel('Product name',{exact:true})).toHaveValue('Changed product');await expect(dialog.locator('input[name=sellingPrice]')).toHaveValue('3');assert.equal(saved.name,original.name);}
  mode='hold';await page.clock.install();await dialog.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit()});await expect.poll(()=>patches).toBe(3);await page.clock.fastForward(21000);await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();await pending.abort().catch(()=>{});
  await page.screenshot({path:`output/product-update-recovery/${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await open();await expect(submit).toBeDisabled();assert.equal(patches,3);
  for(const uncertain of ['malformed','id','facilityId','name','sku','sellingPrice','active','server','conflict','lost']) {await page.reload();await open();mode=uncertain;await submit.click();await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();}
  assert.equal(patches,13);await dialog.getByRole('button',{name:'Reload catalogue',exact:true}).click();await expect(page.locator('.merchandise-table')).toContainText('Changed product');assert.equal(patches,13);
  mode='success';saved={...original};await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status')).toContainText('Product updated.');await expect(page.locator('.catalogue-price')).toHaveText('R 3.00');assert.equal(patches,14);
  mode='read-fail';saved={...original};await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('may be out of date');readFail=false;await page.getByRole('button',{name:'Retry loading',exact:true}).click();await expect(page.locator('.catalogue-price')).toHaveText('R 3.00');assert.equal(patches,15);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: product edits preserve rejected input, guard duplicate/timeout/mismatched/500/conflict/lost confirmation, retain reopen block, GET-only recovery and saved refresh failure at1440/390/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
