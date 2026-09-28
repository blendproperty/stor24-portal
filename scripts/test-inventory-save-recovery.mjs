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
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/inventory-save-recovery",{recursive:true});
try {for(const width of [1440,390,320]) for(const action of ["type-create","type-edit","unit-create","unit-edit"]) {
 const page=await browser.newPage({viewport:{width,height:900}});let mode="network",writes=0,pending;const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/leasing/**",route=>{
  const req=route.request(),resource=new URL(req.url()).pathname.split("/").at(-1);
  if(req.method()==="GET")return mode==="refresh-fail"?route.abort():route.fulfill({json:{data:resource==="facilities"?[facility]:resource==="unit-types"?[type]:[unit]}});
  writes++;if(mode==="network")return route.abort();if(mode==="hold"){pending=route;return;}
  if(["403","409","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic rejection"}}});
  const body=req.postDataJSON(),data=body.data??body,isType=resource==="unit-types";
  const saved={...(isType?type:unit),...data,id:body.id??"new-record"};
  if(mode==="wrong")saved.facilityId="other";
  if(mode==="value")saved[isType?"name":"monthlyRate"]=isType?"Other":"999";
  if(mode==="identity")saved.id="wrong-record";
  if(mode==="malformed")return route.fulfill({json:{data:null}});
  return route.fulfill({json:{data:saved}});
 });
 const open=async()=>{if(action==="type-create")await page.getByRole("button",{name:"Unit type",exact:true}).click();else if(action==="type-edit")await page.locator(".inventory-type-actions").getByRole("button",{name:"Edit",exact:true}).click();else await page.getByRole("button",{name:action==="unit-create"?"Add unit":"Edit unit T01",exact:true}).click();};
 const fill=async()=>{if(action.startsWith("type")){await page.locator('input[name="name"]').fill("Saved synthetic type");await page.locator('input[name="areaSqMetres"]').fill("12");}else{await page.locator('input[name="number"]').fill("T02");await page.locator('input[name="monthlyRate"]').fill("125");}};
 await page.goto(`http://127.0.0.1:${server.address().port}`);await open();await fill();
 if(process.env.REPRO_ONLY){await page.getByRole("button",{name:"Save",exact:true}).click();await page.waitForTimeout(500);assert.equal(writes,1);assert.ok(errors.length);console.log("REPRO: inventory save network failure throws and leaves saving stuck");await page.close();break;}
 mode="409";await page.getByRole("button",{name:"Save",exact:true}).click();await expect(page.getByRole("alert")).toContainText("Synthetic rejection");await expect(page.locator(action.startsWith("type")?'input[name="name"]':'input[name="number"]')).toHaveValue(action.startsWith("type")?"Saved synthetic type":"T02");
 mode="hold";await page.clock.install();await page.getByRole("button",{name:"Save",exact:true}).evaluate(b=>{b.click();b.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await expect.poll(()=>writes).toBe(2);await page.clock.fastForward(20_001);await expect(page.getByRole("alert")).toContainText("could not confirm");await pending.abort().catch(()=>{});await page.clock.resume();
 await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();
 await expect(page.getByRole("button",{name:"Review inventory",exact:true}).last()).toBeInViewport();assert.equal(await page.getByRole("dialog").evaluate(e=>e.scrollWidth<=e.clientWidth),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`page overflow ${action} ${width}`);await page.screenshot({path:`output/inventory-save-recovery/uncertain-${action}-${width}.png`,fullPage:true});mode="ok";await page.getByRole("button",{name:"Review inventory",exact:true}).last().click();await open();await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();assert.equal(writes,2);
 for(const failure of ["network","500","malformed","wrong","value",...(action.endsWith("edit")?["identity"]:[]),"403","ok","refresh-fail"]){await page.reload();await open();await fill();mode=failure;await page.getByRole("button",{name:"Save",exact:true}).click();if(failure==="403"){await expect(page.getByRole("alert")).toContainText("administrator");await expect(page.getByRole("button",{name:"Edit unit T01"})).toHaveCount(0);}else if(["ok","refresh-fail"].includes(failure)){await expect(page.getByText(action.startsWith("type")?(action.endsWith("edit")?"Unit type updated.":"Unit type added."):(action.endsWith("edit")?"Unit updated.":"Unit added."),{exact:true})).toBeVisible();if(failure==="refresh-fail")await expect(page.getByRole("alert")).toContainText("could not be refreshed");}else{await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();}}
 assert.deepEqual(errors,[]);await page.screenshot({path:`output/inventory-save-recovery/${action}-${width}.png`,fullPage:true});await page.close();console.log(`PASS inventory save ${action} ${width}`);
}}finally{await browser.close();server.close();}
