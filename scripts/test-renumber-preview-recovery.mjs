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
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/renumber-preview-recovery",{recursive:true});
try {for(const width of [1440,390,320]) {
 const page=await browser.newPage({viewport:{width,height:900}});let mode="network",requests=0,pending;const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/leasing/units/renumber",route=>{
  const body=route.request().postDataJSON();assert.equal(body.action,"preview");assert.equal(body.facilityId,"store");requests++;
  if(mode==="network")return route.abort();if(mode==="hold"){pending=route;return;}
  if(["401","403","409","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic collision"}}});
  const data={changes:[{unitId:"unit",oldNumber:"T01",newNumber:body.changes[0].newNumber}],mappedCount:0,unitCount:1};
  if(mode==="malformed")return route.fulfill({json:{data:{}}});
  if(mode==="wrong-id")data.changes[0].unitId="other";
  if(mode==="wrong-old")data.changes[0].oldNumber="other";
  if(mode==="wrong-new")data.changes[0].newNumber="other";
  if(mode==="wrong-count")data.unitCount=2;
  if(mode==="negative-map")data.mappedCount=-1;
  if(mode==="duplicate")data.changes.push(data.changes[0]);
  return route.fulfill({json:{data}});
 });
 const prepare=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole("button",{name:"Renumber units",exact:true}).click();await page.getByRole("textbox",{name:"New number for unit T01",exact:true}).fill("T02");};
 await prepare();await page.getByRole("button",{name:"Preview changes",exact:true}).click();
 if(process.env.REPRO_ONLY){await page.waitForTimeout(500);assert.ok(errors.length);console.log("REPRO: renumber preview network failure throws and leaves controls busy");await page.close();break;}
 await expect(page.getByRole("alert")).toContainText("could not be checked");
 for(const failure of ["409","500","malformed","wrong-id","wrong-old","wrong-new","wrong-count","negative-map","duplicate","hold","401","403","ok"]){
  await prepare();mode=failure;const count=requests;if(failure==="hold")await page.clock.install();await page.getByRole("button",{name:"Preview changes",exact:true}).evaluate(b=>{b.click();b.click();});await expect.poll(()=>requests).toBe(count+1);
  if(failure==="hold"){await expect(page.getByRole("textbox",{name:"New number for unit T01",exact:true})).toBeDisabled();await page.clock.fastForward(20_001);await pending.abort().catch(()=>{});await page.clock.resume();}
  if(["401","403"].includes(failure)){await expect(page.getByRole("alert")).toContainText(failure==="401"?"Sign in":"administrator");await expect(page.getByRole("button",{name:"Edit unit T01",exact:true})).toHaveCount(0);}
  else if(failure==="ok"){
   await expect(page.getByRole("button",{name:"Apply renumbering",exact:true})).toBeEnabled();
   mode="network";await page.getByRole("button",{name:"Preview changes",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByRole("button",{name:"Apply renumbering",exact:true})).toBeDisabled();
  }else{
   await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByRole("textbox",{name:"New number for unit T01",exact:true})).toHaveValue("T02");await expect(page.getByRole("button",{name:"Preview changes",exact:true})).toBeEnabled();await expect(page.getByRole("button",{name:"Apply renumbering",exact:true})).toBeDisabled();
  }
 }
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator(".renumber-modal").evaluate(e=>e.scrollWidth<=e.clientWidth),true);
 await page.getByRole("button",{name:"Preview changes",exact:true}).scrollIntoViewIfNeeded();const bounds=await page.getByRole("button",{name:"Preview changes",exact:true}).boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
 for(const button of await page.locator(".renumber-modal .form-actions button").all()){const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);}
 await page.screenshot({path:`output/renumber-preview-recovery/${width}.png`,fullPage:true});await page.close();console.log(`PASS renumber preview ${width}`);
}}finally{await browser.close();server.close();}
