import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace view="merchandise"/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/stock-form-recovery",{recursive:true});
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];let mode='validation',posts=0,quantity=5,pending,readFail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations/merchandise-orders',route=>route.fulfill({json:{data:[]}}));
  await page.route('**/api/v1/operations',route=>{
   if(route.request().method()==='GET')return readFail?route.abort():route.fulfill({json:{data:{tasks:[],maintenance:[],products:[{id:'synthetic-product',facilityId:'synthetic-facility',sku:'TEST',name:'Synthetic product',category:'Test',barcode:null,imageUrl:null,costPrice:'1',sellingPrice:'2',quantityOnHand:quantity,quantityReserved:0,reorderPoint:0,active:true,facility:{name:'Synthetic facility'}}],storagePackages:[],dailyCloses:[],notes:[],facilities:[]}}});
   assert.equal(route.request().method(),'POST');assert.match(route.request().headers()['idempotency-key'],/^[a-f0-9-]{36}$/);posts++;const input=route.request().postDataJSON();assert.equal(input.kind,'stockMovement');const p=input.payload;const delta=['SALE','DAMAGE'].includes(p.type)?-Math.abs(p.quantity):p.quantity;
   if(mode==='hold'){pending=route;return;}
   if(mode==='validation')return route.fulfill({status:400,json:{error:{message:'Check the movement details.'}}});
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Access denied.'}}});
   if(mode==='insufficient')return route.fulfill({status:409,json:{error:{message:'Insufficient stock.'}}});
   const result={id:'synthetic-movement',productId:p.productId,type:p.type,quantity:delta};
   if(mode==='malformed')return route.fulfill({json:{data:{id:'synthetic-movement'}}});
   if(mode==='product')return route.fulfill({json:{data:{...result,productId:'wrong'}}});
   if(mode==='type')return route.fulfill({json:{data:{...result,type:'wrong'}}});
   if(mode==='quantity')return route.fulfill({json:{data:{...result,quantity:999}}});
   if(mode==='server')return route.fulfill({status:500,json:{error:{message:'Unavailable'}}});
   quantity+=delta;if(mode==='lost')return route.abort();if(mode==='read-fail')readFail=true;return route.fulfill({status:201,json:{data:result}});
  });
  const dialog=page.getByRole('dialog');const submit=dialog.getByRole('button',{name:'Record movement',exact:true});const stockCell=page.locator('.merchandise-table tbody tr').first().locator('td').nth(3).locator('strong');
  async function open(type='RECEIPT',qty='2'){await page.getByRole('button',{name:'Move stock',exact:true}).click();await dialog.locator('select[name=productId]').selectOption('synthetic-product');await dialog.locator('select[name=type]').selectOption(type);await dialog.getByLabel('Quantity',{exact:true}).fill(qty);await dialog.getByLabel('Reason',{exact:true}).fill('Synthetic movement reason');}
  await page.goto(`http://127.0.0.1:${server.address().port}`);await open();
  for(const rejection of ['validation','denied','insufficient']){mode=rejection;await submit.click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(submit).toBeEnabled();await expect(dialog.getByLabel('Quantity',{exact:true})).toHaveValue('2');await expect(dialog.getByLabel('Reason',{exact:true})).toHaveValue('Synthetic movement reason');assert.equal(quantity,5);}
  mode='hold';await page.clock.install();await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await expect(dialog.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();await expect.poll(()=>posts).toBe(4);await page.clock.fastForward(21000);await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();await pending.abort().catch(()=>{});assert.equal(posts,4);
  await page.screenshot({path:`output/stock-form-recovery/${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Move stock',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Reload inventory',exact:true})).toBeVisible();
  for(const uncertain of ['malformed','product','type','quantity','server','lost']){await page.reload();await open();mode=uncertain;await submit.click();await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();}
  assert.equal(posts,10);await dialog.getByRole('button',{name:'Reload inventory',exact:true}).click();await expect(stockCell).toHaveText('7');assert.equal(posts,10);
  mode='success';for(const [type,qty,expected] of [['RECEIPT','2','9'],['DAMAGE','-2','7'],['ADJUSTMENT','-1','6'],['RETURN','3','9']]){await open(type,qty);await submit.click();await expect(dialog).toHaveCount(0);await expect(stockCell).toHaveText(expected);await expect(page.getByRole('status')).toContainText('Stock movement recorded.');}
  assert.equal(posts,14);mode='read-fail';await open('RECEIPT','1');await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('may be out of date');await expect(page.getByRole('status')).toContainText('recorded');readFail=false;await page.getByRole('button',{name:'Retry loading',exact:true}).click();await expect(stockCell).toHaveText('10');assert.equal(posts,15);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: stock validation/denial/insufficient quantity, retained input, duplicate/timeout/mismatched/500/lost confirmation, persistent close block, GET reload, signed movement success and refresh failure at1440/390/320px; no mutation retry.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
