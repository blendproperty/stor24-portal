import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/maintenance-create-recovery",{recursive:true});
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];let mode='validation',posts=0,saved=false,savedUnit='synthetic-unit',pending,readFail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations',route=>{
   if(route.request().method()==='GET')return readFail?route.abort():route.fulfill({json:{data:{tasks:[],maintenance:saved?[{id:'synthetic-request',title:'Synthetic inspection',status:'OPEN',priority:'NORMAL',facility:{name:'Synthetic facility'},unit:savedUnit?{number:'TEST'}:null}]:[],products:[],storagePackages:[],dailyCloses:[],notes:[],facilities:[{id:'synthetic-facility',name:'Synthetic facility',units:[{id:'synthetic-unit',number:'TEST',status:saved?'SERVICE':'AVAILABLE'}]}]}}});
   assert.equal(route.request().method(),'POST');posts++;const input=route.request().postDataJSON();assert.equal(input.kind,'maintenance');assert.equal(input.payload.facilityId,'synthetic-facility');
   if(mode==='hold'){pending=route;return;}
   if(mode==='validation')return route.fulfill({status:400,json:{error:{message:'Please check the due date.'}}});
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Access denied.'}}});
   const result={id:'synthetic-request',title:'Synthetic inspection',facilityId:input.payload.facilityId,unitId:input.payload.unitId??null};
   if(mode==='malformed')return route.fulfill({json:{data:{id:'synthetic-request'}}});
   if(mode==='facility')return route.fulfill({json:{data:{...result,facilityId:'wrong'}}});
   if(mode==='unit')return route.fulfill({json:{data:{...result,unitId:'wrong'}}});
   if(mode==='server')return route.fulfill({status:500,json:{error:{message:'Unavailable'}}});
   saved=true;savedUnit=result.unitId;if(mode==='lost')return route.abort();if(mode==='read-fail')readFail=true;
   return route.fulfill({status:201,json:{data:result}});
  });
  const dialog=page.getByRole('dialog');const submit=dialog.getByRole('button',{name:'Create request',exact:true});
  async function open(unit=true){await page.getByRole('button',{name:'New request',exact:true}).click();await dialog.locator('select[name=facilityId]').selectOption('synthetic-facility');if(unit)await dialog.locator('select[name=unitId]').selectOption('synthetic-unit');await dialog.getByLabel('Title',{exact:true}).fill('Synthetic inspection');await dialog.getByLabel('Description',{exact:true}).fill('Keep this entered detail.');}
  await page.goto(`http://127.0.0.1:${server.address().port}`);await open();await submit.click();await expect(dialog.getByRole('alert')).toContainText('due date');await expect(submit).toBeEnabled();await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('Synthetic inspection');await expect(dialog.getByLabel('Description',{exact:true})).toHaveValue('Keep this entered detail.');await expect(dialog.locator('select[name=unitId]')).toHaveValue('synthetic-unit');
  mode='denied';await submit.click();await expect(dialog.getByRole('alert')).toContainText('Access denied');await expect(submit).toBeEnabled();
  mode='hold';await page.clock.install();await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await expect(dialog.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();await expect.poll(()=>posts).toBe(3);await page.clock.fastForward(21000);await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();await pending.abort().catch(()=>{});assert.equal(posts,3);
  await page.screenshot({path:`output/maintenance-create-recovery/${width}.png`,fullPage:true});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'New request',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Reload maintenance status',exact:true})).toBeVisible();
  for(const uncertain of ['malformed','facility','unit','server','lost']){await page.reload();await open();mode=uncertain;await submit.click();await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();}
  assert.equal(posts,8);await dialog.getByRole('button',{name:'Reload maintenance status',exact:true}).click();await expect(page.getByText('Synthetic inspection',{exact:true})).toBeVisible();assert.equal(posts,8);
  for(const unit of [true,false]){saved=false;mode='success';await page.reload();await open(unit);await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByText('Synthetic inspection',{exact:true})).toBeVisible();assert.equal(savedUnit,unit?'synthetic-unit':null);}
  saved=false;mode='read-fail';await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('may be out of date');readFail=false;await page.getByRole('button',{name:'Retry loading',exact:true}).click();await expect(page.getByText('Synthetic inspection',{exact:true})).toBeVisible();assert.equal(posts,11);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: maintenance creation retains details/unit after rejection, blocks duplicate/timeout/mismatched/malformed/500/lost confirmation, preserves block after close, and recovers unit/facility-level success and failed refresh at1440/390/320px without mutation retry.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
