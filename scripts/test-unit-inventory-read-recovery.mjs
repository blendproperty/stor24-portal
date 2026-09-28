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
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/unit-inventory-read-recovery",{recursive:true});
try{for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:900}});let mode="network";const errors=[],methods=[],pending=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/leasing/**",route=>{
  const resource=new URL(route.request().url()).pathname.split("/").at(-1);methods.push(route.request().method());
  if(route.request().method()==="POST")return route.fulfill({status:201,json:{data:{...type,id:"new-type",name:"New synthetic type"}}});
  if(mode==="network")return route.abort();
  if(mode==="hold"){pending.push(route);return;}
  if(["401","403","500"].includes(mode)&&resource==="units")return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic"}}});
  if(mode==="json"&&resource==="units")return route.fulfill({body:"broken",contentType:"application/json"});
  let data=resource==="facilities"?[facility]:resource==="unit-types"?[type]:[unit];
  if(mode==="shape"&&resource==="units")data=[{...unit,unitType:null}];
  if(mode==="empty")data=[];
  return route.fulfill({json:{data}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await expect(page.getByRole("button",{name:"Edit unit T01"})).toBeVisible();assert.equal(methods.length,0,"initial server props need no read");
 await page.getByRole("button",{name:"Unit type",exact:true}).click();await page.locator('input[name="name"]').fill("New synthetic type");await page.locator('input[name="areaSqMetres"]').fill("9");await page.getByRole("button",{name:"Save",exact:true}).click();
 if(process.env.REPRO_ONLY){await page.waitForTimeout(500);assert.ok(errors.length);await expect(page.getByText("Unit type added.", {exact:true})).toHaveCount(0);console.log("REPRO: confirmed save loses confirmation and throws on failed inventory refresh");await page.close();break;}
 const refresh=page.getByRole("button",{name:"Refresh inventory",exact:true});
 await expect(page.getByRole("alert")).toContainText("could not be refreshed");await expect(page.getByText("Unit type added.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Edit unit T01"})).toHaveCount(0);
 mode="ok";await refresh.click();await expect(page.getByRole("link",{name:"T01 Open account"})).toHaveAttribute("href","/operations/accounts?accountId=account");
 for(const failure of ["500","json","shape"]){mode=failure;await refresh.click();await expect(page.getByRole("alert")).toContainText("could not be refreshed");}
 for(const denied of ["401","403"]){mode="ok";await refresh.click();await expect(page.getByRole("button",{name:"Edit unit T01"})).toBeVisible();mode=denied;await refresh.click();await expect(page.getByRole("alert")).toContainText(denied==="401"?"Sign in":"administrator");await expect(page.getByText("Synthetic store",{exact:true})).toHaveCount(0);await expect(page.getByText("Unit type added.",{exact:true})).toHaveCount(0);}
 mode="hold";await page.clock.install();await refresh.click();await expect.poll(()=>pending.length).toBe(3);await page.clock.fastForward(20_001);await expect(page.getByRole("alert")).toContainText("could not be refreshed");for(const r of pending)await r.abort().catch(()=>{});await page.clock.resume();
 mode="empty";await refresh.click();await expect(page.getByText("No units match these filters.")).toBeVisible();
 mode="ok";await refresh.click();await expect(page.getByRole("button",{name:"Edit unit T01"})).toBeVisible();await expect(page.getByRole("table").getByText("Floor under construction",{exact:true})).toBeVisible();
 assert.equal(methods.filter(m=>m!=="GET").length,1);assert.deepEqual(errors,[]);
 mode="network";await refresh.click();await expect(page.getByRole("alert")).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`output/unit-inventory-read-recovery/${width}.png`,fullPage:true});await page.close();console.log(`PASS inventory read recovery ${width}`);
}}finally{await browser.close();server.close();}


