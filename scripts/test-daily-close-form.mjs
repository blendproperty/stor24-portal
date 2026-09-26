import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();

await mkdir('output/daily-close-form',{recursive:true});
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}}); const errors=[]; let mode='validation', posts=0, saved=null, pending, access=true, failRead=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations',route=>{
   if(route.request().method()==='GET')return route.fulfill(failRead?{status:500,json:{error:{message:'Read unavailable'}}}:{json:{data:{tasks:[],maintenance:[],products:[],storagePackages:[],notes:[],dailyCloses:saved?[{...saved,facility:{name:'Synthetic close facility'}}]:[],facilities:[{id:'c2222222222222222222222222',name:'Synthetic close facility',units:[]},{id:'c3333333333333333333333333',name:'Other facility',units:[]}],dailyCloseFacilityIds:access?['c2222222222222222222222222']:[]}}});
   posts++;const body=route.request().postDataJSON();assert.equal(body.kind,'dailyClose');const input=body.payload;
   assert.equal(input.facilityId,'c2222222222222222222222222');assert.ok(input.checks.every(c=>c.complete));
   if(mode==='hold'){pending=route;return;}
   if(mode==='validation')return route.fulfill({status:422,json:{error:{message:'Please review the cash inputs.'}}});
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Denied'}}});
   if(mode==='signed-out')return route.fulfill({status:401,json:{error:{message:'Sign in'}}});
   if(mode==='conflict')return route.fulfill({status:409,json:{error:{message:'This day is already closed.'}}});
   if(mode==='server')return route.fulfill({status:500,json:{error:{message:'Unavailable'}}});
   const record={...input,id:'synthetic-close',status:'CLOSED',businessDate:input.businessDate+'T00:00:00.000Z',expectedCash:String(input.expectedCash),countedCash:String(input.countedCash),variance:((Math.round(input.countedCash*100)-Math.round(input.expectedCash*100))/100).toFixed(2)};
   if(mode==='lost'){saved=record;return route.abort();}
   if(mode==='malformed')return route.fulfill({json:{data:{id:'close'}}});
   const mismatches={facilityId:'other',businessDate:'2025-01-01T00:00:00.000Z',expectedCash:'99',countedCash:'99',variance:'99',notes:'different',checks:[],status:'OPEN'};
   if(mode in mismatches)return route.fulfill({status:201,json:{data:{...record,[mode]:mismatches[mode]}}});
   saved=record;if(mode==='refresh-fail')failRead=true;return route.fulfill({status:201,json:{data:record}});
  });
  const form=page.getByRole('form',{name:'Daily close'}), submit=page.getByRole('button',{name:'Confirm daily close',exact:true});
  async function open(){await page.getByRole('button',{name:'Record daily close',exact:true}).click();await form.getByLabel('Close facility').selectOption('c2222222222222222222222222');await expect(form.getByLabel('Close facility').locator('option')).toHaveCount(2);await form.getByLabel('Business date').fill('2026-09-26');await form.getByLabel('Expected cash (R)').fill('0.29');await form.getByLabel('Counted cash (R)').fill('1.15');await form.getByLabel('Close notes').fill('Synthetic receipt source');await form.getByRole('checkbox').nth(0).check();await expect(submit).toBeDisabled();await form.getByRole('checkbox').nth(1).check();}
  await page.goto(`http://127.0.0.1:${server.address().port}`);await open();await expect(form.getByText('Cash variance: R 0.86',{exact:true})).toBeVisible();await submit.click();await expect(page.getByRole('alert')).toContainText('cash inputs');await expect(form.getByLabel('Counted cash (R)')).toHaveValue('1.15');await expect(form.getByLabel('Close notes')).toHaveValue('Synthetic receipt source');
  for(const failure of ['denied','signed-out','conflict']){mode=failure;await submit.click();await expect(page.getByRole('alert')).toContainText(failure==='denied'?'administrator':failure==='signed-out'?'Sign in':'already closed');await expect(submit).toBeEnabled();}
  mode='hold';await page.clock.install();await form.evaluate(el=>{el.requestSubmit();el.requestSubmit();});await expect(page.getByRole('button',{name:'Recording…',exact:true})).toBeDisabled();await expect.poll(()=>posts).toBe(5);await page.clock.fastForward(21000);await expect(page.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();await pending.abort().catch(()=>{});
  await page.getByRole('button',{name:'Hide close form'}).click();await page.getByRole('button',{name:'Record daily close',exact:true}).click();await expect(submit).toBeDisabled();assert.equal(posts,5);
  await page.getByRole('button',{name:'Reload close records',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'Reload close records',exact:true})).toBeInViewport();await page.screenshot({path:`output/daily-close-form/recovery-${width}.png`,fullPage:true});
  for(const failure of ['malformed','facilityId','businessDate','expectedCash','countedCash','variance','notes','checks','status','server','lost']){await page.reload();await open();mode=failure;await submit.click();await expect(page.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();}
  const before=posts;await page.getByRole('button',{name:'Reload close records',exact:true}).click();await expect(page.locator('.daily-close-history').getByText('CLOSED',{exact:true})).toBeVisible();assert.equal(posts,before);
  saved=null;mode='success';await page.reload();await open();await submit.click();await expect(page.getByRole('status')).toContainText('Daily close recorded');await expect(submit).toBeDisabled();await page.getByRole('button',{name:'Refresh close records',exact:true}).click();await expect(page.locator('.daily-close-history').getByText('CLOSED',{exact:true})).toBeVisible();assert.equal(posts,before+1);
  await page.screenshot({path:`output/daily-close-form/success-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  await page.getByRole('button',{name:'Record another day',exact:true}).click();await expect(form.getByLabel('Business date')).toHaveValue('');await expect(submit).toBeDisabled();
  await page.locator('.daily-close-panel').screenshot({path:`output/daily-close-form/panel-${width}.png`});
  for(const [expected,counted,variance] of [['0','0','0.00'],['1.15','0.29','-0.86']]){saved=null;mode='success';await page.reload();await open();await form.getByLabel('Expected cash (R)').fill(expected);await form.getByLabel('Counted cash (R)').fill(counted);await submit.click();await expect(page.getByRole('status')).toContainText(`Cash variance: R ${variance}`);await expect(submit).toBeDisabled();}
  saved=null;mode='refresh-fail';await page.reload();await open();await submit.click();await page.getByRole('button',{name:'Refresh close records',exact:true}).click();await expect(page.getByRole('status')).toContainText('Daily close recorded');await expect(page.getByRole('alert')).toContainText('may be out of date');await expect(submit).toBeDisabled();
  failRead=false;access=false;await page.reload();await expect(page.getByRole('button',{name:'Record daily close',exact:true})).toBeDisabled();await expect(page.getByText(/Daily-close access is unavailable/)).toContainText('administrator');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: scoped daily-close form, exact cash variance, retained inputs, denied/conflict recovery, duplicate guard, timeout/mismatched/lost result, reopened block, GET-only recovery and desktop/mobile success.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
