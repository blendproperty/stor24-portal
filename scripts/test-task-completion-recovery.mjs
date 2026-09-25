import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsWorkspace} from './src/components/operations-workspace';createRoot(document.getElementById('root')).render(<OperationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/task-completion-recovery",{recursive:true});
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let mode="reject",readMode="ok",patches=0,pending,status="OPEN";
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/v1/operations",route=>readMode==="fail"?route.abort():route.fulfill({json:{data:readMode==="malformed"?{tasks:{}}:{tasks:[{id:"task-test",title:"Synthetic inspection",status,priority:"NORMAL",dueAt:null}],maintenance:[],products:[],storagePackages:[],dailyCloses:[],notes:[],facilities:[]}}}));
  await page.route("**/api/v1/operations/tasks/task-test",route=>{
   patches++;assert.equal(route.request().method(),"PATCH");
   assert.deepEqual(route.request().postDataJSON(),{status:"COMPLETED"});
   if(mode==="hold"){pending=route;return;}
   if(mode==="lost"){status="COMPLETED";return route.abort();}
   if(mode==="malformed")return route.fulfill({json:{data:{id:"wrong",status:"COMPLETED"}}});
   if(mode==="reject")return route.fulfill({status:403,json:{error:{message:"Denied"}}});
   status="COMPLETED";return route.fulfill({json:{data:{id:"task-test",status}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const complete=page.getByRole("button",{name:"Complete",exact:true});const check=page.getByRole("button",{name:"Check task status",exact:true});
  await complete.click();await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(complete).toBeDisabled();assert.equal(patches,1);
  readMode="fail";await check.click();await expect(page.getByRole("alert")).toContainText("could not be checked");await expect(complete).toBeDisabled();assert.equal(patches,1);
  readMode="malformed";await check.click();await expect(page.getByRole("alert")).toContainText("could not be checked");await expect(complete).toBeDisabled();
  readMode="ok";status="WAITING";await check.click();await expect(complete).toBeEnabled();assert.equal(patches,1);
  mode="malformed";await complete.click();await expect(complete).toBeDisabled();await check.click();await expect(complete).toBeEnabled();
  mode="hold";await page.clock.install();await complete.evaluate(button=>{button.click();button.click();});await expect(page.getByRole("button",{name:"Please wait…",exact:true})).toBeDisabled();assert.equal(patches,3);
  await page.clock.fastForward(21000);await expect(page.getByRole("alert")).toContainText("could not confirm");assert.equal(patches,3);await pending.abort().catch(()=>{});
  await page.screenshot({path:`output/task-completion-recovery/${width}.png`,fullPage:true});
  await check.click();await expect(complete).toBeEnabled();mode="lost";await complete.click();await expect(complete).toBeDisabled();await check.click();await expect(complete).toHaveCount(0);assert.equal(patches,4);
  status="OPEN";mode="success";await page.reload();await complete.click();await expect(page.getByRole("status")).toContainText("Task completed.");await expect(complete).toHaveCount(0);assert.equal(patches,5);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log("PASS: task completion rejection, malformed result, duplicate clicks, timeout, lost success and read-only recovery at1440/390/320px; no automatic PATCH retry.");
} finally {await browser.close();await new Promise(r=>server.close(r));}
