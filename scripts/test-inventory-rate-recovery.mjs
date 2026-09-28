import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const type={id:"type",facilityId:"store",name:"Synthetic type",widthMetres:null,lengthMetres:null,areaSqMetres:"9",features:[]};
const unit={id:"unit",facilityId:"store",unitTypeId:"type",number:"T01",floor:"First",zone:null,status:"AVAILABLE",monthlyRate:"100",taxRate:"0.15",accountId:"account",unitType:type,mapElements:[]};
const facility={id:"store",name:"Synthetic store",code:"SYN",closedFloors:["First"],maps:[],unitTypes:[type],units:[unit]};
const css=(await Promise.all(["src/app/globals.css","src/styles/stor24-brand.css","src/styles/staff-workspace.css"].map(p=>readFile(p,"utf8")))).join("\n").replace('@import "tailwindcss";',"");
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UnitInventoryWorkspace} from './src/components/unit-inventory-workspace';createRoot(document.getElementById('root')).render(<UnitInventoryWorkspace initialFacilities={${JSON.stringify([facility])}}/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/inventory-rate-recovery",{recursive:true});
try {for(const width of [1440,390,320]) {
 const page=await browser.newPage({viewport:{width,height:900}});let mode="network",writes=0,pending;const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
 await page.route("**/api/v1/leasing/**",route=>{
  const req=route.request(),resource=new URL(req.url()).pathname.split("/").at(-1);
  if(req.method()==="GET")return mode==="refresh-fail"?route.abort():route.fulfill({json:{data:resource==="facilities"?[facility]:resource==="unit-types"?[type]:[unit]}});
  assert.equal(resource,"unit-rates");assert.deepEqual(req.postDataJSON(),{facilityId:"store",modelVersion:"MIDRAND_2026_08_V1"});writes++;
  if(mode==="network")return route.abort();if(mode==="hold"){pending=route;return;}
  if(["401","403","409","422","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic rejection"}}});
  const data={facilityId:"store",facilityName:"Synthetic store",modelVersion:"MIDRAND_2026_08_V1",updated:1,skipped:0,minimumRate:100,maximumRate:100};
  if(mode==="malformed")return route.fulfill({json:{data:{}}});
  if(mode==="wrong-facility")data.facilityId="other";
  if(mode==="wrong-model")data.modelVersion="other";
  if(mode==="negative")data.updated=-1;
  if(mode==="fraction")data.skipped=0.5;
  if(mode==="range")data.maximumRate=99;
  if(mode==="lost")return route.abort();
  return route.fulfill({json:{data}});
 });
 const button=()=>page.getByRole("button",{name:"Apply Midrand rates",exact:true});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await button().click();
 if(process.env.REPRO_ONLY){await page.waitForTimeout(500);assert.ok(errors.length);console.log("REPRO: rate application network failure throws and leaves controls busy");await page.close();break;}
 await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(button()).toBeDisabled();mode="ok";const before=writes;await page.getByRole("button",{name:"Review inventory",exact:true}).click();await expect(button()).toBeDisabled();assert.equal(writes,before);
 for(const failure of ["409","422","401","403","500","malformed","wrong-facility","wrong-model","negative","fraction","range","hold","lost","ok","refresh-fail"]){
  await page.goto(`http://127.0.0.1:${server.address().port}`);mode=failure;const count=writes;if(failure==="hold")await page.clock.install();await button().evaluate(b=>{b.click();b.click();});await expect.poll(()=>writes).toBe(count+1);
  if(failure==="hold"){await page.clock.fastForward(20_001);await pending.abort().catch(()=>{});await page.clock.resume();}
  if(["401","403"].includes(failure)){await expect(page.getByRole("alert")).toContainText(failure==="401"?"Sign in":"administrator");await expect(page.getByRole("button",{name:/Edit unit/})).toHaveCount(0);}
  else if(["409","422"].includes(failure)){await expect(page.getByRole("alert")).toContainText("Synthetic rejection");await expect(button()).toBeEnabled();}
  else if(["ok","refresh-fail"].includes(failure)){await expect(page.getByText(/1 unit rates updated/)).toBeVisible();if(failure==="refresh-fail")await expect(page.getByRole("alert")).toContainText("could not be refreshed");}
  else {await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(button()).toBeDisabled();}
 }
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`output/inventory-rate-recovery/${width}.png`,fullPage:true});await page.close();console.log(`PASS inventory rate recovery ${width}`);
}}finally{await browser.close();server.close();}
