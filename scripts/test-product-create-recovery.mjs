import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace view="merchandise"/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/product-create-recovery",{recursive:true});
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];let mode='validation',posts=0,saved=null,pending,readFail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations/merchandise-orders',route=>route.fulfill({json:{data:[]}}));
  await page.route('**/api/v1/operations',route=>{
   if(route.request().method()==='GET')return readFail?route.abort():route.fulfill({json:{data:{tasks:[],maintenance:[],products:saved?[saved]:[],storagePackages:[],dailyCloses:[],notes:[],facilities:[{id:'synthetic-facility',name:'Synthetic facility',units:[]}]}}});
   assert.equal(route.request().method(),'POST');posts++;const input=route.request().postDataJSON();assert.equal(input.kind,'product');const p=input.payload;assert.equal(p.sku,'SYNTHETIC');
   if(mode==='hold'){pending=route;return;}
   if(mode==='validation')return route.fulfill({status:400,json:{error:{message:'Check the price.'}}});
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Access denied.'}}});
   const result={...p,id:'synthetic-product',costPrice:String(p.costPrice),sellingPrice:String(p.sellingPrice),quantityReserved:0,active:true,imageUrl:null,facility:{name:'Synthetic facility'}};
   if(mode==='malformed')return route.fulfill({json:{data:{id:'synthetic-product'}}});
   if(mode==='facility')return route.fulfill({json:{data:{...result,facilityId:'wrong'}}});
   if(mode==='sku')return route.fulfill({json:{data:{...result,sku:'wrong'}}});
   if(mode==='name')return route.fulfill({json:{data:{...result,name:'wrong'}}});
   if(mode==='quantity')return route.fulfill({json:{data:{...result,quantityOnHand:999}}});
   if(mode==='server'||mode==='conflict')return route.fulfill({status:mode==='server'?500:409,json:{error:{message:'Unavailable'}}});
   saved=result;if(mode==='lost')return route.abort();if(mode==='read-fail')readFail=true;return route.fulfill({status:201,json:{data:result}});
  });
  const dialog=page.getByRole('dialog');const submit=dialog.getByRole('button',{name:'Add product',exact:true});const stockCell=page.locator('.merchandise-table tbody tr').first().locator('td').nth(3).locator('strong');
  async function open(){await page.getByRole('button',{name:'Add product',exact:true}).click();await dialog.locator('select[name=facilityId]').selectOption('synthetic-facility');await dialog.getByLabel('SKU',{exact:true}).fill(' SYNTHETIC ');await dialog.getByLabel('Product name',{exact:true}).fill('Synthetic product');await dialog.getByLabel('Category',{exact:true}).fill('Test');await dialog.getByLabel('Selling price',{exact:true}).fill('2');await dialog.getByLabel('Opening stock',{exact:true}).fill('5');}
  await page.goto(`http://127.0.0.1:${server.address().port}`);await open();
  for(const rejection of ['validation','denied']){mode=rejection;await submit.click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(submit).toBeEnabled();await expect(dialog.getByLabel('SKU',{exact:true})).toHaveValue(' SYNTHETIC ');await expect(dialog.getByLabel('Opening stock',{exact:true})).toHaveValue('5');assert.equal(saved,null);}
  mode='hold';await page.clock.install();await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await expect(dialog.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();await expect.poll(()=>posts).toBe(3);await page.clock.fastForward(21000);await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();await pending.abort().catch(()=>{});assert.equal(posts,3);
  await page.screenshot({path:`output/product-create-recovery/${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Add product',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Reload catalogue',exact:true})).toBeVisible();
  for(const uncertain of ['malformed','facility','sku','name','quantity','server','conflict','lost']){await page.reload();await open();mode=uncertain;await submit.click();await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();}
  assert.equal(posts,11);await dialog.getByRole('button',{name:'Reload catalogue',exact:true}).click();await expect(stockCell).toHaveText('5');assert.equal(posts,11);
  saved=null;mode='success';await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(stockCell).toHaveText('5');await expect(page.getByRole('status')).toContainText('Product created.');assert.equal(posts,12);
  saved=null;mode='read-fail';await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('may be out of date');await expect(page.getByRole('status')).toContainText('created');readFail=false;await page.getByRole('button',{name:'Retry loading',exact:true}).click();await expect(stockCell).toHaveText('5');assert.equal(posts,13);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: product creation retains rejected input, blocks duplicate/timeout/malformed/mismatched/conflict/500/lost confirmations, preserves closed-modal block, reloads opening stock and recovers saved-but-refresh-failed at1440/390/320px without retrying POST.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
