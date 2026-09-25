import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace view={new URLSearchParams(location.search).get('view')==='merchandise'?'merchandise':'operations'}/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/operations-access-recovery",{recursive:true});
try {
 for (const view of ['operations','merchandise']) for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let access=403,afterSave=403,posts=0,patches=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations/merchandise-orders',route=>route.fulfill({json:{data:[]}}));
  await page.route('**/api/v1/operations/tasks/synthetic-task',route=>{patches++;return route.fulfill({status:500,json:{error:{message:'Uncertain'}}});});
  await page.route('**/api/v1/operations',route=>{
   if(route.request().method()==='POST'){posts++;access=afterSave;return route.fulfill({status:201,json:{data:{id:'synthetic-new',title:'Synthetic added'}}});}
   if(access!==200)return route.fulfill({status:access,body:'Access denied'});
   return route.fulfill({json:{data:{tasks:[{id:'synthetic-task',title:'Synthetic prior record',status:'OPEN',priority:'NORMAL',dueAt:null}],maintenance:[],products:[{id:'synthetic-product',facilityId:'synthetic-facility',sku:'TEST',name:'Synthetic product',category:'Test',barcode:null,imageUrl:null,costPrice:'1',sellingPrice:'2',quantityOnHand:3,quantityReserved:0,reorderPoint:0,active:true,facility:{name:'Synthetic facility'}}],storagePackages:[],dailyCloses:[],notes:[],facilities:[{id:'synthetic-facility',name:'Synthetic facility',units:[]}]}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}?view=${view}`);
  const record=view==='operations'?page.getByText('Synthetic prior record',{exact:true}):page.getByRole('cell',{name:/Synthetic product/});
  await expect(page.getByRole('alert')).toContainText('contact your administrator');await expect(record).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry loading',exact:true})).toHaveCount(0);
  await page.screenshot({path:`output/operations-access-recovery/${view}-${width}.png`,fullPage:true});
  access=200;await page.getByRole('button',{name:'Check access again',exact:true}).click();await expect(record).toBeVisible();
  access=401;await page.reload();await expect(page.getByRole('alert')).toContainText('sign in again');await expect(page.getByRole('link',{name:'Sign in',exact:true})).toHaveAttribute('href','/login');await expect(record).toHaveCount(0);
  if(view==='operations')for(const denied of [403,401]) {
   access=200;await page.reload();await page.getByRole('button',{name:'New task',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('select[name=facilityId]').selectOption('synthetic-facility');await dialog.getByLabel('Title',{exact:true}).fill('Synthetic added');afterSave=denied;await dialog.getByRole('button',{name:'Create task',exact:true}).click();
   await expect(page.getByRole('alert')).toContainText(denied===403?'contact your administrator':'sign in again');await expect(record).toHaveCount(0);await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Complete',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'New task',exact:true})).toHaveCount(0);
   access=200;if(denied===403)await page.getByRole('button',{name:'Check access again',exact:true}).click();else await page.reload();await expect(record).toBeVisible();await expect(dialog).toHaveCount(0);
   await page.getByRole('button',{name:'Complete',exact:true}).click();await expect(page.getByRole('alert')).toContainText('could not confirm');access=denied;await page.getByRole('button',{name:'Check task status',exact:true}).click();await expect(page.getByRole('alert')).toContainText(denied===403?'contact your administrator':'sign in again');await expect(record).toHaveCount(0);
  }
  assert.equal(posts,view==='operations'?2:0);assert.equal(patches,view==='operations'?2:0);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: initial401/403 and access restoration on operations/merchandise; denied post-save refresh and task-status check remove old records/actions, with sign-in/admin guidance at1440/390/320px. Synthetic mutations only; recovery does not retry them.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
