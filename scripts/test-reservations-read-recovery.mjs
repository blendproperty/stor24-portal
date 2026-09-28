import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ReservationsWorkspace} from './src/components/reservations-workspace';createRoot(document.getElementById('root')).render(<ReservationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/reservations-read-recovery",{recursive:true});
const customer={id:"customer",firstName:"Synthetic",lastName:"Customer",companyName:null,email:"synthetic@example.invalid",phone:null};
const unit={id:"unit",facilityId:"store",number:"T01",monthlyRate:"100.00",unitType:{name:"Small",areaSqMetres:"9"}};
const data={facilities:[{id:"store",name:"Synthetic store",units:[unit]}],customers:[customer],reservations:[{id:"reservation",status:"ACTIVE",quotedRate:"100.00",holdExpiresAt:"2030-10-01T00:00:00Z",intendedMoveIn:null,createdAt:"2026-09-01T00:00:00Z",facility:{id:"store",name:"Synthetic store"},customer,unit,lead:null,convertedTenancy:null}]};
try {for(const width of [1440,390,320]) {
 const page=await browser.newPage({viewport:{width,height:900}});let mode="network",pending;const errors=[],methods=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/reservations*",route=>{
  methods.push(route.request().method());
  if(route.request().method()==="DELETE"){mode="network";return route.fulfill({json:{data:{id:"reservation",facilityId:"store",unitId:"unit",status:"CANCELLED",unitReleased:true}}});}
  if(mode==="network")return route.abort();
  if(mode==="hold"){pending=route;return;}
  if(mode==="401"||mode==="403"||mode==="500")return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic"}}});
  if(mode==="json")return route.fulfill({body:"broken",contentType:"application/json"});
  if(mode==="shape")return route.fulfill({json:{data:{...data,reservations:[{...data.reservations[0],unit:null}]}}});
  return route.fulfill({json:{data:mode==="empty"?{facilities:[],customers:[],reservations:[]}:data}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 if(process.env.REPRO_ONLY){await page.waitForTimeout(400);assert.ok(errors.length);await expect(page.getByText("No reservations match these filters.")).toBeVisible();console.log("REPRO: network read leaves false empty state and unhandled page error");await page.close();break;}
 const refresh=page.getByRole("button",{name:"Refresh reservations",exact:true});
 await expect(page.getByRole("alert")).toContainText("could not be loaded");
 await expect(page.getByText("No reservations match these filters.")).toHaveCount(0);
 await expect(page.getByRole("button",{name:"New reservation",exact:true})).toBeDisabled();
 for(const failure of ["500","json","shape"]){mode=failure;await refresh.click();await expect(page.getByRole("alert")).toContainText("could not be loaded");}
 for(const denied of ["401","403"]){mode="ok";await refresh.click();await expect(page.getByText("synthetic@example.invalid")).toBeVisible();mode=denied;await refresh.click();await expect(page.getByRole("alert")).toContainText(denied==="401"?"Sign in":"administrator");await expect(page.getByText("synthetic@example.invalid")).toHaveCount(0);await expect(page.getByRole("button",{name:"New reservation",exact:true})).toBeDisabled();}
 mode="hold";await page.clock.install();await refresh.click();await expect.poll(()=>Boolean(pending)).toBe(true);await expect(page.getByRole("status")).toContainText("Loading");await page.clock.fastForward(20_001);await expect(page.getByRole("alert")).toContainText("could not be loaded");await pending.abort().catch(()=>{});await page.clock.resume();
 mode="empty";await refresh.click();await expect(page.getByText("No reservations match these filters.")).toBeVisible();
 mode="ok";await refresh.click();await expect(page.getByText("synthetic@example.invalid")).toBeVisible();await expect(page.getByRole("link",{name:"Move in",exact:true})).toHaveAttribute("href","/operations/move-in?reservation=reservation");
 page.on("dialog",d=>d.accept());await page.getByRole("button",{name:"Cancel",exact:true}).click();await expect(page.getByText(/Reservation cancelled. Unit T01/)).toBeVisible();await expect(page.getByRole("alert")).toContainText("could not be loaded");
 mode="empty";await refresh.click();await expect(page.getByText("No reservations match these filters.")).toBeVisible();assert.equal(methods.filter(m=>m!=="GET").length,1);assert.equal(methods.filter(m=>m==="DELETE").length,1);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);await page.screenshot({path:`output/reservations-read-recovery/${width}.png`,fullPage:true});await page.close();console.log(`PASS reservations read and GET-only recovery ${width}`);
}}finally{await browser.close();server.close();}
