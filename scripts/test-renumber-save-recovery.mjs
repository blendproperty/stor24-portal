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
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/renumber-save-recovery",{recursive:true});
try {for(const width of [1440,390,320]) for(const action of ["apply","undo"]) {
 const page=await browser.newPage({viewport:{width,height:900}});let mode="ok",writes=0,pending,current="T01",readFailed=false;const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/facility-map?*",route=>route.fulfill({json:{data:[]}}));
 await page.route("**/api/v1/leasing/**",route=>{
  const req=route.request(),resource=new URL(req.url()).pathname.split("/").at(-1);
  if(req.method()==="GET"){const live={...unit,number:current};return readFailed?route.abort():route.fulfill({json:{data:resource==="facilities"?[facility]:resource==="unit-types"?[type]:[live]}});}
  assert.equal(resource,"renumber");const body=req.postDataJSON();assert.equal(body.facilityId,"store");const changes=body.changes.map(c=>({...c,oldNumber:current}));
  if(body.action==="preview")return route.fulfill({json:{data:{changes,mappedCount:1,unitCount:changes.length}}});
  assert.equal(body.action,"apply");writes++;
  if(mode==="network")return route.abort();if(mode==="hold"){pending=route;return;}
  if(["401","403","409","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic collision"}}});
  const data={changes,syncedMapLabels:1,auditEventId:"synthetic-audit",undoChanges:changes.map(c=>({unitId:c.unitId,newNumber:c.oldNumber}))};
  if(mode==="malformed")return route.fulfill({json:{data:{}}});
  if(mode==="wrong-id")data.changes[0].unitId="other";
  if(mode==="wrong-old")data.changes[0].oldNumber="other";
  if(mode==="wrong-new")data.changes[0].newNumber="other";
  if(mode==="wrong-undo")data.undoChanges[0].newNumber="other";
  if(mode==="no-audit")data.auditEventId="";
  if(mode==="negative-map")data.syncedMapLabels=-1;
  if(mode==="duplicate")data.changes.push(data.changes[0]);
  if(["ok","refresh-fail","lost"].includes(mode))current=body.changes[0].newNumber;
  if(mode==="lost")return route.abort();
  readFailed=mode==="refresh-fail";return route.fulfill({json:{data}});
 });
 const open=()=>page.getByRole("button",{name:"Renumber units",exact:true}).click();
 const prepare=async()=>{mode="ok";current="T01";readFailed=false;await page.goto(`http://127.0.0.1:${server.address().port}`);await open();await page.getByRole("textbox",{name:"New number for unit T01",exact:true}).fill("T02");await page.getByRole("button",{name:"Preview changes",exact:true}).click();await expect(page.getByRole("button",{name:"Apply renumbering",exact:true})).toBeEnabled();if(action==="undo"){await page.getByRole("button",{name:"Apply renumbering",exact:true}).click();await expect(page.getByRole("button",{name:"Edit unit T02",exact:true})).toBeVisible();await open();await expect(page.getByRole("button",{name:"Undo last renumbering",exact:true})).toBeVisible();}};
 const button=()=>page.getByRole("button",{name:action==="undo"?"Undo last renumbering":"Apply renumbering",exact:true});
 await prepare();mode="network";await button().click();
 if(process.env.REPRO_ONLY){await page.waitForTimeout(500);assert.ok(errors.length);console.log("REPRO: renumber apply network failure throws and leaves controls busy");await page.close();break;}
 await expect(page.locator(".renumber-modal").getByRole("alert")).toContainText("could not confirm");await expect(button()).toBeDisabled();
 mode="ok";const before=writes;await page.locator(".renumber-modal").getByRole("button",{name:"Review inventory",exact:true}).click();await expect(page.getByRole("button",{name:"Renumber units",exact:true})).toBeDisabled();assert.equal(writes,before);
 for(const failure of ["409","401","403","500","malformed","wrong-id","wrong-old","wrong-new","wrong-undo","no-audit","negative-map","duplicate","hold","lost","ok","refresh-fail"]){
  await prepare();mode=failure;const count=writes;if(failure==="hold")await page.clock.install();await button().evaluate(b=>{b.click();b.click();});await expect.poll(()=>writes).toBe(count+1);
  if(failure==="hold"){await page.clock.fastForward(20_001);await pending.abort().catch(()=>{});await page.clock.resume();}
  if(["401","403"].includes(failure)){await expect(page.getByRole("alert")).toContainText(failure==="401"?"Sign in":"administrator");await expect(page.getByRole("button",{name:/Edit unit/})).toHaveCount(0);}
  else if(failure==="409"){await expect(page.locator(".renumber-modal").getByRole("alert")).toContainText("Synthetic collision");if(action==="apply")await expect(page.getByRole("textbox",{name:"New number for unit T01",exact:true})).toHaveValue("T02");}
  else if(["ok","refresh-fail"].includes(failure)){await expect(page.getByText("1 unit renumbered without changing the saved map layout.",{exact:true})).toBeVisible();if(failure==="refresh-fail")await expect(page.getByRole("alert")).toContainText("could not be refreshed");else await expect(page.getByRole("button",{name:`Edit unit ${action==="apply"?"T02":"T01"}`,exact:true})).toBeVisible();}
  else {await expect(page.locator(".renumber-modal").getByRole("alert")).toContainText("could not confirm");await expect(button()).toBeDisabled();}
 }
 await prepare();mode="network";await button().click();await expect(button()).toBeDisabled();assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator(".renumber-modal").evaluate(e=>e.scrollWidth<=e.clientWidth),true);for(const b of await page.locator(".renumber-modal .form-actions button").all()){await b.scrollIntoViewIfNeeded();const box=await b.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);}
 await page.screenshot({path:`output/renumber-save-recovery/${action}-${width}.png`,fullPage:true});await page.close();console.log(`PASS renumber ${action} ${width}`);
}}finally{await browser.close();server.close();}
