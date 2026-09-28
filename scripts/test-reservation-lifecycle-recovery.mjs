import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ReservationsWorkspace} from './src/components/reservations-workspace';createRoot(document.getElementById('root')).render(<ReservationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/reservation-lifecycle-recovery",{recursive:true});
const customer={id:"customer",firstName:"Synthetic",lastName:"Customer",companyName:null,email:"synthetic@example.invalid",phone:null};
const unit={id:"unit",facilityId:"store",number:"T01",monthlyRate:"100.00",unitType:{name:"Small",areaSqMetres:"9"}};
const data={facilities:[{id:"store",name:"Synthetic store",units:[unit]}],customers:[customer],reservations:[{id:"reservation",status:"ACTIVE",quotedRate:"100.00",holdExpiresAt:"2020-10-01T00:00:00Z",intendedMoveIn:null,createdAt:"2026-09-01T00:00:00Z",facility:{id:"store",name:"Synthetic store"},customer,unit,lead:null,convertedTenancy:null}]};
try {for(const width of [1440,390,320]){for(const action of ["Cancel","Extend","Expire"]){for(const mode of(process.env.REPRO_ONLY?["network"]:["409","403","network","500","malformed","identity","unit","status","detail","timeout","success","retained","refresh-fail"])){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[],methods=[];let pending,readFail=false;
 page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept(d.message().includes("YYYY-MM-DD")?"2030-10-01":"Synthetic reason"));
 await page.route("**/api/v1/reservations*",route=>{
  const method=route.request().method();methods.push(method);
  if(method==="GET")return readFail?route.abort():route.fulfill({json:{data}});
  assert.equal(method,action==="Cancel"?"DELETE":"PATCH");
  if(mode==="network")return route.abort();if(mode==="timeout"){pending=route;return;}
  if(["409","403","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic"}}});
  if(mode==="malformed")return route.fulfill({json:{data:{}}});
  const result={id:"reservation",unitId:"unit",facilityId:"store",status:action==="Cancel"?"CANCELLED":action==="Expire"?"EXPIRED":"ACTIVE",unitReleased:mode!=="retained",holdExpiresAt:"2030-10-01T21:59:59.999Z"};
  if(mode==="identity")result.id="wrong";if(mode==="unit")result.unitId="wrong";if(mode==="status")result.status="WRONG";if(mode==="detail"){result.unitReleased="yes";result.holdExpiresAt="2030-10-02T21:59:59.999Z";}
  if(mode==="refresh-fail")readFail=true;return route.fulfill({json:{data:result}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);const button=page.getByRole("button",{name:action,exact:true});await expect(button).toBeVisible();if(mode==="timeout")await page.clock.install();
 await button.evaluate(b=>{b.click();b.click();});
 if(process.env.REPRO_ONLY){await page.waitForTimeout(400);assert.ok(errors.length);console.log("REPRO: lifecycle network failure produced unhandled error");await page.close();break;}
 if(mode==="timeout"){await expect.poll(()=>Boolean(pending)).toBe(true);await page.clock.fastForward(20_001);await pending.abort().catch(()=>{});await page.clock.resume();}
 if(["success","retained","refresh-fail"].includes(mode)){
  await expect(page.getByRole("status").filter({hasText:/Reservation (cancelled|expired|for unit)/})).toBeVisible();if(mode==="retained"&&action!=="Extend")await expect(page.getByRole("status").filter({hasText:"remains protected"})).toBeVisible();
  if(readFail){await expect(page.getByRole("alert")).toContainText("could not be loaded");readFail=false;await page.getByRole("button",{name:"Refresh reservations",exact:true}).click();}
 }else if(mode==="403"){await expect(page.getByRole("alert")).toContainText("administrator");await expect(page.getByText("synthetic@example.invalid")).toHaveCount(0);}
 else if(mode==="409"){await expect(page.getByRole("alert")).toBeVisible();await expect(button).toBeEnabled();}
 else{await expect(page.getByRole("alert")).toContainText("could not confirm");await expect(button).toBeDisabled();await page.getByRole("button",{name:"Review reservation status",exact:true}).click();await expect(page.getByText("synthetic@example.invalid")).toBeVisible();await expect(button).toBeDisabled();}
 assert.equal(methods.filter(m=>m!=="GET").length,1,`${action} ${mode} repeated write`);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(mode==="timeout"&&action==="Cancel")await page.screenshot({path:`output/reservation-lifecycle-recovery/${width}.png`,fullPage:true});await page.close();
 }if(process.env.REPRO_ONLY)break;}if(process.env.REPRO_ONLY)break;console.log(`PASS lifecycle recovery ${width}`);}}finally{await browser.close();server.close();}
