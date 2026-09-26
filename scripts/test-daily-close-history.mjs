import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();

await mkdir('output/daily-close-history',{recursive:true});
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let reads=0,denied=false;
  page.on('pageerror',e=>errors.push(e.message));
  const records=[
   {id:'reviewed',businessDate:'2026-09-26T00:00:00.000Z',status:'CLOSED',facility:{name:'Synthetic facility'},expectedCash:'0',countedCash:'1.15',variance:'1.15',notes:'Receipt batch SYN-001\nCash counted by test staff.',closedBy:{name:'Synthetic reviewer'},closedAt:'2026-09-26T08:00:00.000Z',checks:[{label:'Source records checked',complete:true}]},
   {id:'legacy',businessDate:'2026-09-25T00:00:00.000Z',status:'OPEN',facility:{name:'Legacy synthetic facility'},expectedCash:null,countedCash:null,variance:null,notes:null,closedBy:null,closedAt:null,checks:[]},
   {id:'incomplete',businessDate:'2026-09-24T00:00:00.000Z',status:'READY',facility:{name:'Incomplete synthetic facility'},expectedCash:'1.15',countedCash:'0.29',variance:'-0.86',notes:'<b>Keep this as text</b>',checks:[{label:'Count checked',complete:false},null,{label:'Malformed legacy check'}]},
  ];
  await page.route('**/api/v1/operations',route=>{assert.equal(route.request().method(),'GET','Review must never write');reads++;return route.fulfill(denied?{status:403,json:{error:{message:'Denied'}}}:{json:{data:{tasks:[],maintenance:[],products:[],storagePackages:[],notes:[],facilities:[],dailyCloseFacilityIds:[],dailyCloses:records}}});});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const history=page.locator('.daily-close-history'), reviewed=history.locator('details').nth(0), legacy=history.locator('details').nth(1), incomplete=history.locator('details').nth(2);
  await expect(history.locator('summary')).toHaveCount(3);await reviewed.locator('summary').press('Enter');
  await expect(reviewed.getByText('R 0.00',{exact:true})).toBeVisible();await expect(reviewed.getByText('Synthetic reviewer',{exact:true})).toBeVisible();await expect(reviewed.getByText('Receipt batch SYN-001',{exact:false})).toContainText('Cash counted by test staff.');await expect(reviewed.getByText('Confirmed',{exact:true})).toBeVisible();await expect(reviewed.getByText(/10:00/)).toBeVisible();
  await legacy.locator('summary').click();await expect(legacy.locator('dd').filter({hasText:'Not recorded'})).toHaveCount(5);await expect(legacy.getByText('No notes recorded.')).toBeVisible();await expect(legacy.getByText('No attestations recorded.')).toBeVisible();await expect(legacy.getByText(/This snapshot has not been closed/)).toBeVisible();await expect(legacy.getByText('R 0.00',{exact:true})).toHaveCount(0);
  await incomplete.locator('summary').click();await expect(incomplete.getByText('Not confirmed',{exact:true})).toBeVisible();await expect(incomplete.getByText('<b>Keep this as text</b>',{exact:true})).toBeVisible();await expect(incomplete.locator('.daily-close-notes b')).toHaveCount(0);await expect(incomplete.locator('dd').filter({hasText:'R -0.86'})).toBeVisible();
  assert.equal(reads,1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await history.screenshot({path:`output/daily-close-history/${width}.png`});
  denied=true;await page.reload();await expect(page.getByRole('alert')).toContainText('administrator');await expect(page.locator('.daily-close-history')).toHaveCount(0);assert.equal(reads,2);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: daily-close snapshot review is read-only; exact cash, zero versus missing, SAST time, notes/attestations/attribution, legacy/incomplete states, escaped notes, keyboard and mobile layout; denied read hides snapshots.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
