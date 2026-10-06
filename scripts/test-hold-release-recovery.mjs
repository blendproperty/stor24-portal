import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const type={id:"type",facilityId:"store",name:"Synthetic type",widthMetres:null,lengthMetres:null,areaSqMetres:"9",features:[]};
const unit={id:"unit",facilityId:"store",unitTypeId:"type",number:"T01",floor:"First",zone:null,status:"RESERVED",monthlyRate:"100",taxRate:"0.15",accountId:"account",unitType:type,mapElements:[]};
const facility={id:"store",name:"Synthetic store",code:"SYN",closedFloors:["First"],maps:[],unitTypes:[type],units:[unit]};
const css=(await Promise.all(["src/app/globals.css","src/styles/stor24-brand.css","src/styles/staff-workspace.css"].map(p=>readFile(p,"utf8")))).join("\n").replace('@import "tailwindcss";',"");
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UnitInventoryWorkspace} from './src/components/unit-inventory-workspace';createRoot(document.getElementById('root')).render(<UnitInventoryWorkspace initialFacilities={${JSON.stringify([facility])}}/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/hold-release-recovery",{recursive:true});
try {for(const width of [1440,390,320]) for(const action of ["store","unit"]) {
 const page=await browser.newPage({viewport:{width,height:900}});let mode="network",writes=0,pending,released=false;const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
 await page.route("**/api/v1/facility-map?*",route=>route.fulfill({json:{data:[]}}));
 await page.route("**/api/v1/leasing/**",route=>{
  const req=route.request(),resource=new URL(req.url()).pathname.split("/").at(-1);
  if(req.method()==="GET")return mode==="refresh-fail"?route.abort():route.fulfill({json:{data:resource==="facilities"?[facility]:resource==="unit-types"?[type]:[{...unit,status:released?"AVAILABLE":"RESERVED"}]}});
  assert.equal(resource,"release-orphans");assert.deepEqual(req.postDataJSON(),action==="unit"?{facilityId:"store",unitId:"unit"}:{facilityId:"store"});writes++;
  if(mode==="network")return route.abort();if(mode==="hold"){pending=route;return;}
  if(["401","403","409","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic rejection"}}});
  const data={facilityId:"store",checked:1,released:["T01"],blocked:[]};
  if(mode==="malformed")return route.fulfill({json:{data:{}}});
  if(mode==="wrong-facility")data.facilityId="other";
  if(mode==="wrong-unit")data.released=["OTHER"];
  if(mode==="duplicate")data.released=["T01","T01"];
  if(mode==="overlap")data.blocked=[{unit:"T01",reasons:["Protected"]}];
  if(mode==="count")data.checked=0;
  if(mode==="protected"){data.released=[];data.blocked=[{unit:"T01",reasons:["active reservation"]}];}
  if(mode==="empty"){data.released=[];data.checked=0;}
  if(["ok","refresh-fail","lost"].includes(mode))released=true;
  if(mode==="lost")return route.abort();return route.fulfill({json:{data}});
 });
 const prepare=async()=>{released=false;await page.goto(`http://127.0.0.1:${server.address().port}`);if(action==="unit")await page.getByRole("button",{name:"Edit unit T01",exact:true}).click();else await page.getByRole("button",{name:"Release cancelled holds",exact:true}).click();};
 const button=()=>page.getByRole("button",{name:action==="unit"?"Check and release cancelled hold":"Confirm safe release",exact:true});
 const alert=()=>action==="unit"?page.getByRole("dialog").getByRole("alert"):page.getByRole("alert");
 await prepare();await button().click();
 if(process.env.REPRO_ONLY){await page.waitForTimeout(500);assert.ok(errors.length);console.log("REPRO: hold release network failure throws and leaves controls busy");await page.close();break;}
 await expect(alert()).toContainText("could not confirm");mode="ok";const before=writes;await page.getByRole("button",{name:"Review inventory",exact:true}).last().click();await expect(page.getByRole("button",{name:"Release cancelled holds",exact:true})).toBeDisabled();assert.equal(writes,before);
 for(const failure of ["409","401","403","500","malformed","wrong-facility","wrong-unit","duplicate","overlap","count","hold","lost","protected","empty","ok","refresh-fail"]){
  await prepare();mode=failure;const count=writes;if(failure==="hold")await page.clock.install();await button().evaluate(b=>{b.click();b.click();});await expect.poll(()=>writes).toBe(count+1);
  if(failure==="hold"){await page.clock.fastForward(20_001);await pending.abort().catch(()=>{});await page.clock.resume();}
  if(["401","403"].includes(failure)){await expect(page.getByRole("alert")).toContainText(failure==="401"?"Sign in":"administrator");await expect(page.getByRole("button",{name:/Edit unit/})).toHaveCount(0);}
  else if(failure==="409")await expect(alert()).toContainText("Synthetic rejection");
  else if(["ok","refresh-fail"].includes(failure)){await expect(page.getByText(/1 orphaned reserved unit released: T01/)).toBeVisible();if(failure==="refresh-fail")await expect(page.getByRole("alert")).toContainText("could not be refreshed");}
  else if(failure==="protected")await expect(page.getByText(/Nothing released.*active reservation/)).toBeVisible();
  else if(failure==="empty")await expect(page.getByText("No orphaned reserved units were found.",{exact:true})).toBeVisible();
  else await expect(alert()).toContainText("could not confirm");
 }
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`output/hold-release-recovery/${action}-${width}.png`,fullPage:true});await page.close();console.log(`PASS hold release ${action} ${width}`);
}}finally{await browser.close();server.close();}
