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
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/inventory-removal-recovery",{recursive:true});
try {for(const width of [1440,390,320]) for(const action of ["unit","type","type-force"]) {
 const page=await browser.newPage({viewport:{width,height:900}});let mode="network",writes=0,pending,removed=false;const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
 await page.route("**/api/v1/leasing/**",route=>{
  const req=route.request(),url=new URL(req.url()),resource=url.pathname.split("/").at(-1);
  if(req.method()==="GET")return mode==="refresh-fail"?route.abort():route.fulfill({json:{data:resource==="facilities"?[facility]:resource==="unit-types"?(removed&&action!=="unit"?[]:[type]):(removed?[]:[unit])}});
  writes++;assert.equal(req.method(),"DELETE");assert.equal(url.searchParams.get("id"),action==="unit"?"unit":"type");
  if(action==="unit")assert.equal(url.searchParams.get("force"),"true");
  if(mode==="inuse")return route.fulfill({status:409,json:{error:{message:"Synthetic assigned units",canForceDelete:true,assigned:1}}});
  if(mode==="network")return route.abort();if(mode==="hold"){pending=route;return;}
  if(["401","403","409","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic restriction"}}});
  if(mode==="wrong")return route.fulfill({status:200,json:{data:{id:"other"}}});
  removed=true;return route.fulfill({status:204});
 });
 const prepare=async()=>{removed=false;await page.goto(`http://127.0.0.1:${server.address().port}`);if(action==="unit"){await page.getByRole("button",{name:"Edit unit T01",exact:true}).click();await page.getByRole("button",{name:"Delete unit permanently",exact:true}).click();}else if(action==="type-force"){mode="inuse";await page.locator(".inventory-type-actions").getByRole("button",{name:"Delete",exact:true}).click();await expect(page.getByRole("button",{name:"Delete type and 1 unused unit",exact:true})).toBeVisible();}};
 const button=()=>action==="unit"?page.getByRole("button",{name:"Confirm permanent deletion of unit T01",exact:true}):action==="type-force"?page.getByRole("button",{name:"Delete type and 1 unused unit",exact:true}):page.locator(".inventory-type-actions").getByRole("button",{name:"Delete",exact:true});
 await prepare();mode="network";await button().click();
 if(process.env.REPRO_ONLY){await page.waitForTimeout(500);assert.ok(errors.length);console.log("REPRO: inventory removal network failure throws and leaves controls busy");await page.close();break;}
 await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(button()).toBeDisabled();
 mode="ok";await page.getByRole("button",{name:"Review inventory",exact:true}).last().click();const before=writes;await page.getByRole("button",{name:"Edit unit T01",exact:true}).click();await expect(page.getByRole("button",{name:"Delete unit permanently",exact:true})).toBeDisabled();assert.equal(writes,before);
 for(const failure of ["409","401","403","500","wrong","hold","ok","refresh-fail"]){await prepare();mode=failure;const count=writes;if(failure==="hold")await page.clock.install();await button().evaluate(b=>{b.click();b.click();});await expect.poll(()=>writes).toBe(count+1);
  if(failure==="hold"){await page.clock.fastForward(20_001);await pending.abort().catch(()=>{});await page.clock.resume();}
  if(failure==="409"){await expect(page.getByRole("alert")).toContainText("Synthetic restriction");await expect(action==="type-force"?page.getByRole("button",{name:"Delete type",exact:true}):button()).toBeEnabled();}
  else if(["401","403"].includes(failure)){await expect(page.getByRole("alert")).toContainText(failure==="401"?"Sign in":"administrator");await expect(page.getByRole("button",{name:"Edit unit T01",exact:true})).toHaveCount(0);}
  else if(["ok","refresh-fail"].includes(failure)){await expect(page.getByText(action==="unit"?"Unit T01 permanently deleted.":"Unit type deleted.",{exact:true})).toBeVisible();if(failure==="refresh-fail")await expect(page.getByRole("alert")).toContainText("could not be refreshed");}
  else {await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(button()).toBeDisabled();}
 }
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`output/inventory-removal-recovery/${action}-${width}.png`,fullPage:true});await page.close();console.log(`PASS inventory removal ${action} ${width}`);
}}finally{await browser.close();server.close();}
