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
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();await mkdir("output/uat-reset",{recursive:true});
const counts={customers:61,reservations:62,tenancies:7,occupancies:8,documents:7,paymentSessions:4,unitsReleased:22,payments:9,ledgerEntries:12,merchandiseOrders:3,merchandiseRequests:2,collectionCases:1,financialAdjustments:1,debitInstructions:2};
try { for (const width of [1440,390,320]) {
 const page=await browser.newPage({viewport:{width,height:1000}});let mode="preview",resets=0;const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/facility-map?*",r=>r.fulfill({json:{data:[]}}));
 await page.route("**/api/v1/leasing/**",r=>r.fulfill({json:{data:r.request().url().endsWith("facilities")?[facility]:r.request().url().endsWith("unit-types")?[type]:[unit]}}));
 await page.route("**/api/v1/admin/uat-reset",r=>{
  const body=r.request().postDataJSON();
  if(body.action==="preview")return r.fulfill({json:{data:counts}});
  assert.equal(body.confirmation,"RESET TEST CUSTOMERS");resets++;
  if(mode==="network")return r.abort();
  if(mode==="conflict")return r.fulfill({status:409,json:{error:{message:"Nothing was cleared. Review the stock holds before resetting."}}});
  return r.fulfill({json:{data:counts}});
 });
 const prepare=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole("button",{name:"Reset UAT customers",exact:true}).click();};
 const confirm=()=>page.getByRole("button",{name:"Delete test customers and release units",exact:true});
 await prepare();await expect(page.getByRole("heading",{name:"All 61 customers in your organisation will be removed"})).toBeVisible();
 await expect(confirm()).toBeDisabled();await page.getByRole("textbox",{name:/Type RESET TEST CUSTOMERS/}).fill("RESET TEST CUSTOMERS");await expect(confirm()).toBeEnabled();
 await expect(page.getByText(/3 merchandise orders/)).toBeVisible();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:`output/uat-reset/preview-${width}.png`,fullPage:true});
 mode="conflict";await confirm().click();await expect(page.getByRole("alert")).toContainText("Nothing was cleared");await expect(confirm()).toBeEnabled();
 mode="success";await confirm().click();await expect(page.getByText(/61 test customers removed and 22 units released/)).toBeVisible();
 mode="network";await prepare();await page.getByRole("textbox",{name:/Type RESET TEST CUSTOMERS/}).fill("RESET TEST CUSTOMERS");await confirm().click();
 await expect(page.getByRole("alert")).toContainText("could not confirm");
 await expect(page.getByRole("button",{name:"Reset UAT customers",exact:true})).toBeDisabled();
 assert.equal(resets,3);assert.deepEqual(errors,[]);await page.close();console.log(`PASS UAT reset preview, confirmation, success and failure at ${width}px`);
}} finally {await browser.close();server.close();}
