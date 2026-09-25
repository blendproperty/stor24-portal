import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/task-create-recovery",{recursive:true});
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let mode='validation',posts=0,saved=false,pending;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations',route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{data:{tasks:saved?[{id:'synthetic-task',title:'Synthetic inspection',status:'OPEN',priority:'NORMAL',dueAt:null}]:[],maintenance:[],products:[],storagePackages:[],dailyCloses:[],notes:[],facilities:[{id:'synthetic-facility',name:'Synthetic facility',units:[]}]}}});
   assert.equal(route.request().method(),'POST');posts++;assert.equal(route.request().postDataJSON().kind,'task');
   if(mode==='hold'){pending=route;return;}
   if(mode==='validation')return route.fulfill({status:400,json:{error:{message:'Please check the due date.'}}});
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Access denied.'}}});
   if(mode==='lost'){saved=true;return route.abort();}
   if(mode==='malformed')return route.fulfill({json:{data:{id:'synthetic-task'}}});
   if(mode==='server')return route.fulfill({status:500,json:{error:{message:'Unavailable'}}});
   saved=true;return route.fulfill({status:201,json:{data:{id:'synthetic-task',title:'Synthetic inspection'}}});
  });
  const dialog=page.getByRole('dialog');const submit=dialog.getByRole('button',{name:'Create task',exact:true});
  async function open(){await page.getByRole('button',{name:'New task',exact:true}).click();await dialog.locator('select[name=facilityId]').selectOption('synthetic-facility');await dialog.getByLabel('Title',{exact:true}).fill('Synthetic inspection');await dialog.getByLabel('Description',{exact:true}).fill('Keep this entered detail.');}
  await page.goto(`http://127.0.0.1:${server.address().port}`);await open();await submit.click();await expect(dialog.getByRole('alert')).toContainText('due date');await expect(submit).toBeEnabled();await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('Synthetic inspection');await expect(dialog.getByLabel('Description',{exact:true})).toHaveValue('Keep this entered detail.');
  mode='denied';await submit.click();await expect(dialog.getByRole('alert')).toContainText('Access denied');await expect(submit).toBeEnabled();
  mode='hold';await page.clock.install();await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await expect(dialog.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();await expect.poll(()=>posts).toBe(3);await page.clock.fastForward(21000);await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();await pending.abort().catch(()=>{});assert.equal(posts,3);
  await page.screenshot({path:`output/task-create-recovery/${width}.png`,fullPage:true});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();await expect(submit).toBeDisabled();assert.equal(posts,3);
  for(const uncertain of ['malformed','server','lost']){await page.reload();await open();mode=uncertain;await submit.click();await expect(dialog.getByRole('alert')).toContainText('could not confirm');await expect(submit).toBeDisabled();}
  assert.equal(posts,6);await dialog.getByRole('button',{name:'Reload task list',exact:true}).click();await expect(page.getByText('Synthetic inspection',{exact:true})).toBeVisible();assert.equal(posts,6);
  saved=false;mode='success';await page.reload();await open();await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByText('Synthetic inspection',{exact:true})).toBeVisible();assert.equal(posts,7);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: task creation preserves validation input, handles access denial, blocks duplicate/timeout/malformed/500/lost confirmations, persists block after modal reopen and recovers through GET-only reload at1440/390/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
