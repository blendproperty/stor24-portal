import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace view="merchandise"/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/package-update-recovery",{recursive:true});
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];let mode='validation',posts=0,saved=null,pending,readFail=false;
  const product={id:'synthetic-product',facilityId:'synthetic-facility',sku:'TEST',name:'Synthetic product',category:'Test',barcode:null,imageUrl:null,costPrice:'1',sellingPrice:'2',quantityOnHand:5,quantityReserved:0,reorderPoint:0,active:true,facility:{name:'Synthetic facility'}};
  const original={id:'synthetic-package',facilityId:product.facilityId,code:'TEST',name:'Original package',description:'Test package',badge:null,imageUrl:null,sellingPrice:'2',minUnitAreaSqM:null,maxUnitAreaSqM:null,sortOrder:0,active:true,facility:product.facility,items:[{id:'synthetic-item',productId:product.id,product,quantity:1}]}; saved={...original};
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/v1/operations/merchandise-orders',r=>r.fulfill({json:{data:[]}}));
  await page.route(/\/api\/v1\/operations(?:\/storage-packages\/[^/]+)?$/,r=>{
   if(r.request().method()==='GET')return readFail?r.abort():r.fulfill({json:{data:{products:[product],facilities:[{id:product.facilityId,name:'Synthetic facility',units:[]}],tasks:[],maintenance:[],storagePackages:saved?[saved]:[],dailyCloses:[],notes:[]}}});
   assert.equal(r.request().method(),'PATCH');posts++;const p=r.request().postDataJSON();assert.equal(p.items[0].quantity,2);
   if(mode==='hold'){pending=r;return;}
   if(mode==='validation'||mode==='denied')return r.fulfill({status:mode==='validation'?422:403,json:{error:{message:'Check package details or access.'}}});
   const result={...original,...p,id:'synthetic-package',sellingPrice:String(p.sellingPrice),facility:{name:'Synthetic facility'},items:p.items.map(i=>({...i,id:'synthetic-item',product}))};
   if(mode==='malformed')return r.fulfill({json:{data:{id:result.id}}});
   if(['id','facilityId','code','name','sellingPrice'].includes(mode))return r.fulfill({json:{data:{...result,[mode]:'wrong'}}});
   if(mode==='items')return r.fulfill({json:{data:{...result,items:[{...result.items[0],quantity:99}]}}});
   if(mode==='product')return r.fulfill({json:{data:{...result,items:[{...result.items[0],productId:'wrong'}]}}});
   if(mode==='server'||mode==='conflict')return r.fulfill({status:mode==='server'?500:409,json:{error:{message:'Unavailable'}}});
   saved=result;if(mode==='lost')return r.abort();if(mode==='read-fail')readFail=true;return r.fulfill({status:201,json:{data:result}});
  });
  const dialog=page.getByRole('dialog');const submit=dialog.getByRole('button',{name:'Save package',exact:true});
  async function open(){await page.locator('table').last().locator('tbody tr').click();await dialog.getByLabel('Public name',{exact:true}).fill('Changed package');await dialog.locator('input[name=sellingPrice]').fill('3');await dialog.getByLabel('Synthetic product quantity',{exact:true}).fill('2');}
  await page.goto(`http://127.0.0.1:${server.address().port}`);await open();
  for(const rejection of ['validation','denied']) {mode=rejection;await submit.click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(submit).toBeEnabled();await expect(dialog.getByLabel('Public name',{exact:true})).toHaveValue('Changed package');await expect(dialog.getByLabel('Synthetic product quantity',{exact:true})).toHaveValue('2');assert.equal(saved.name,original.name);}
  mode='hold';await page.clock.install();await dialog.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit()});await expect.poll(()=>posts).toBe(3);await page.clock.fastForward(21000);await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();await expect(dialog.getByRole('button',{name:'Reload catalogue',exact:true})).toBeInViewport();await pending.abort().catch(()=>{});await page.screenshot({path:`output/package-update-recovery/${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await open();await expect(submit).toBeDisabled();
  for(const uncertain of ['malformed','id','facilityId','code','name','sellingPrice','items','product','server','conflict','lost']){await page.reload();await open();mode=uncertain;await submit.click();await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();}
  assert.equal(posts,14);await dialog.getByRole('button',{name:'Reload catalogue',exact:true}).click();await expect(page.locator('table').last()).toContainText('Changed package');assert.equal(posts,14);
  mode='success';saved={...original};await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status')).toContainText('Package updated.');assert.equal(posts,15);
  mode='read-fail';saved={...original};await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('may be out of date');readFail=false;await page.getByRole('button',{name:'Retry loading',exact:true}).click();await expect(page.locator('table').last()).toContainText('Changed package');assert.equal(posts,16);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: package edits retain rejected details/items, guards duplicates/timeouts/mismatched contents/price/identity/conflict/server/lost confirmations, preserves closed-modal block, GET recovery and saved refresh failure at1440/390/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
