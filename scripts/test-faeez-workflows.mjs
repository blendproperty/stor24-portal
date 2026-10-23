import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import {resolve} from "node:path";

const store="cm00000000000000000000001",person="cm00000000000000000000002";
const type={id:"type5",facilityId:store,name:"5 sqm",widthMetres:null,lengthMetres:null,areaSqMetres:"5",features:[]};
const units=["G1","G2","G10","G11"].map((number,i)=>({id:`unit${i}`,facilityId:store,unitTypeId:type.id,number,floor:"Ground",zone:null,status:"AVAILABLE",monthlyRate:"100",taxRate:"0.15",accountId:null,unitType:{...type,areaSqMetres:i===3?"10":"5"},mapElements:[]}));
const facility={id:store,name:"Synthetic Midpoint",code:"SYN",closedFloors:[],maps:[],unitTypes:[type],units};
const compiled=await postcss([tailwindcss()]).process(await readFile("src/app/globals.css","utf8"),{from:resolve("src/app/globals.css")});
const css=compiled.css+(await Promise.all(["src/styles/stor24-brand.css","src/styles/staff-workspace.css"].map(p=>readFile(p,"utf8")))).join("\n")+'\n@font-face{font-family:Satoshi;src:url(/font.ttf);font-weight:300 900}:root{--font-satoshi:Satoshi}.app-shell{display:block;min-height:100vh}';
const font=await readFile("public/brand/Satoshi-Variable.ttf");
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UnitInventoryWorkspace} from './src/components/unit-inventory-workspace';import {ScheduledWork} from './src/components/scheduled-work';createRoot(document.getElementById('root')).render(location.pathname==='/calendar'?<ScheduledWork/>:<UnitInventoryWorkspace initialFacilities={${JSON.stringify([facility])}}/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"next-fixture",setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("navigation")?"export const useRouter=()=>({refresh(){}});":"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{if(req.url==="/font.ttf"){res.setHeader("content-type","font/ttf");return res.end(font);}res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div class="app-shell"><main class="content"><div id="root"></div></main></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch();await mkdir("output/faeez-workflows",{recursive:true});
try {for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on("pageerror",e=>errors.push(e.message));let mode="ok",writes=0,lastPreview,rateReads=0;
  await page.route("**/api/v1/facility-map?*",r=>r.fulfill({json:{data:[]}}));
  await page.route("**/api/v1/leasing/**",route=>{
    const req=route.request(),resource=new URL(req.url()).pathname.split("/").at(-1);
    if(req.method()==="GET"){rateReads++;return route.fulfill({json:{data:resource==="facilities"?[facility]:resource==="unit-types"?[type]:units}});}
    assert.equal(resource,"pricing");const input=req.postDataJSON();assert.equal(input.facilityId,store);assert.deepEqual(input.unitIds,["unit1","unit2"]);
    if(input.action==="preview"){
      lastPreview={facilityId:store,action:"preview",token:"a".repeat(64),changes:input.unitIds.map(id=>({unitId:id,number:units.find(u=>u.id===id).number,currentRate:"100.00",proposedRate:"110.00"}))};
      return route.fulfill({json:{data:lastPreview}});
    }
    writes++;assert.equal(input.expectedToken,lastPreview.token);
    if(mode==="lost")return route.abort();
    if(mode==="stale")return route.fulfill({status:409,json:{error:{message:"The selection or rates changed. Preview again before saving."}}});
    return route.fulfill({json:{data:{...lastPreview,action:"apply"}}});
  });
  const openPricing=async()=>{
    await page.goto(`http://127.0.0.1:${server.address().port}/units`);await page.getByRole("button",{name:"Adjust selected unit prices",exact:true}).click();
    const dialog=page.getByRole("dialog");await expect(dialog.getByRole("button",{name:"Preview prices",exact:true})).toBeDisabled();
    await dialog.getByLabel("Size (m²)",{exact:true}).selectOption("5");await dialog.getByLabel("From unit",{exact:true}).fill("G2");await dialog.getByLabel("To unit",{exact:true}).fill("G10");
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);await dialog.getByRole("button",{name:"Select matching units (2)",exact:true}).click();
    await dialog.getByLabel("Percentage",{exact:true}).fill("10");await dialog.getByRole("button",{name:"Preview prices",exact:true}).click();await expect(dialog.getByRole("button",{name:"Confirm 2 price changes",exact:true})).toBeVisible();return dialog;
  };
  let dialog=await openPricing();await dialog.evaluate(e=>e.scrollTop=0);await page.screenshot({path:`output/faeez-workflows/pricing-${width}.png`});await dialog.getByRole("button",{name:"Confirm 2 price changes",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`output/faeez-workflows/pricing-review-${width}.png`});
  await dialog.getByLabel("Percentage",{exact:true}).fill("11");await expect(dialog.getByRole("button",{name:"Confirm 2 price changes",exact:true})).toHaveCount(0);
  await dialog.getByLabel("Percentage",{exact:true}).fill("10");await dialog.getByRole("button",{name:"Preview prices",exact:true}).click();mode="stale";
  await dialog.getByRole("button",{name:"Confirm 2 price changes",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("Preview again");await expect(dialog.getByRole("button",{name:"Confirm 2 price changes",exact:true})).toHaveCount(0);
  mode="ok";await dialog.getByRole("button",{name:"Preview prices",exact:true}).click();await dialog.getByRole("button",{name:"Confirm 2 price changes",exact:true}).click();await expect(page.getByText(/2 selected unit rates updated/)).toBeVisible();assert.ok(rateReads>=3);
  mode="lost";dialog=await openPricing();await dialog.getByRole("button",{name:"Confirm 2 price changes",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("could not confirm");await expect(dialog.getByRole("button",{name:"Preview prices",exact:true})).toBeDisabled();const before=writes;await dialog.getByRole("button",{name:"Close",exact:true}).click();await expect(page.getByRole("button",{name:"Adjust selected unit prices",exact:true})).toBeDisabled();assert.equal(writes,before);

  let tasks=[],scheduleWrites=0,scheduleMode="ok";
  const scheduleFacility={id:store,name:facility.name,timezone:"Africa/Johannesburg",units:units.map(u=>({id:u.id,number:u.number}))};
  await page.route("**/api/v1/calendar/work*",route=>{
    const req=route.request();if(req.method()==="GET")return route.fulfill({json:{data:{tasks,truncated:false,facilities:[scheduleFacility],staff:[{id:person,name:"Synthetic manager",facilityIds:[store]}]}}});
    scheduleWrites++;const body=req.postDataJSON(),input=body.input;assert.equal(input.facilityId,store);assert.equal(input.assigneeId,person);
    if(scheduleMode==="lost")return route.abort();
    if(req.method()==="POST"){
      assert.equal(input.repeat,"DAILY");assert.equal(input.occurrences,3);assert.equal(new Date(input.startAt).getUTCHours(),8);
      tasks=Array.from({length:3},(_,i)=>({id:`cm0000000000000000000001${i}`,facilityId:store,unitId:null,assigneeId:person,purpose:input.purpose,title:input.title,description:input.description,startAt:new Date(new Date(input.startAt).getTime()+i*86400000).toISOString(),endAt:new Date(new Date(input.endAt).getTime()+i*86400000).toISOString(),status:"OPEN",updatedAt:"2026-10-23T08:00:00.000Z",completedAt:null,assignee:{id:person,name:"Synthetic manager"},unit:null,facility:{id:store,name:facility.name}}));
      return route.fulfill({json:{data:{id:tasks[0].id,count:3}}});
    }
    const index=tasks.findIndex(t=>t.id===body.id);assert.ok(index>=0);tasks[index]={...tasks[index],...input,status:body.status,updatedAt:"2026-10-23T08:01:00.000Z",completedAt:body.status==="COMPLETED"?"2026-10-23T08:01:00.000Z":null};return route.fulfill({json:{data:tasks[index]}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/calendar`);await page.getByRole("button",{name:"New scheduled work",exact:true}).click();
  const form=page.getByRole("form",{name:"Scheduled work editor"});await form.getByLabel("Activity",{exact:true}).selectOption("CHECKLIST");await form.getByLabel("Responsible staff",{exact:true}).selectOption(person);await form.getByLabel("Title",{exact:true}).fill("Daily facility walkthrough");await form.getByLabel("Repeat",{exact:true}).selectOption("DAILY");await form.getByLabel("Total occurrences",{exact:true}).fill("3");
  await form.getByRole("button",{name:"Review schedule",exact:true}).click();await expect(form.getByRole("status")).toContainText("3 occurrence");await form.getByRole("button",{name:"Confirm schedule",exact:true}).click();await expect(page.getByRole("button",{name:"Edit / complete",exact:true})).toHaveCount(3);
  await page.getByRole("button",{name:"Edit / complete",exact:true}).first().click();await form.getByLabel("Status",{exact:true}).selectOption("COMPLETED");await form.getByLabel("Instructions / completion notes",{exact:true}).fill("Walkthrough completed; no snags.");await form.getByRole("button",{name:"Review schedule",exact:true}).click();await form.getByRole("button",{name:"Confirm schedule",exact:true}).click();await expect(page.getByRole("button",{name:"View record",exact:true})).toHaveCount(1);await expect(page.getByRole("button",{name:"Edit / complete",exact:true})).toHaveCount(2);
  await page.getByRole("button",{name:"View record",exact:true}).click();await expect(form.getByLabel("Title",{exact:true})).toBeDisabled();await form.getByRole("button",{name:"Close editor",exact:true}).click();
  await page.screenshot({path:`output/faeez-workflows/schedule-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  scheduleMode="lost";await page.getByRole("button",{name:"Edit / complete",exact:true}).first().click();await form.getByRole("button",{name:"Review schedule",exact:true}).click();await form.getByRole("button",{name:"Confirm schedule",exact:true}).click();await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(form.getByRole("button",{name:"Review schedule",exact:true})).toBeDisabled();assert.equal(scheduleWrites,3);
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS bulk selection/preview/stale/save/lost response and recurring schedule/completion/history/recovery ${width}`);
}}finally{await browser.close();server.close();}
