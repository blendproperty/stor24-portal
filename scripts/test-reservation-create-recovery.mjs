import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ReservationsWorkspace} from './src/components/reservations-workspace';createRoot(document.getElementById('root')).render(<ReservationsWorkspace/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",plugins:[{name:"links",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch();
await mkdir("output/reservation-create-recovery",{recursive:true});
const customer={id:"customer",firstName:"Synthetic",lastName:"Customer",companyName:null,email:"synthetic@example.invalid",phone:null};
const unit={id:"unit",facilityId:"store",number:"T01",monthlyRate:"100.00",unitType:{name:"Small",areaSqMetres:"9"}};
const data={facilities:[{id:"store",name:"Synthetic store",units:[unit]}],customers:[customer],reservations:[{id:"reservation",status:"ACTIVE",quotedRate:"100.00",holdExpiresAt:"2030-10-01T00:00:00Z",intendedMoveIn:null,createdAt:"2026-09-01T00:00:00Z",facility:{id:"store",name:"Synthetic store"},customer,unit,lead:null,convertedTenancy:null}]};
try { for(const width of [1440,390,320]) {
 for(const mode of (process.env.REPRO_ONLY?["network"]:["422","409","401","403","network","500","malformed","facility","customer","unit","rate","date","timeout","success","refresh-fail"])) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[],methods=[];let pending,postCount=0,readFail=false;
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/v1/reservations*",route=>{
   const method=route.request().method();methods.push(method);
   if(method==="GET")return readFail?route.abort():route.fulfill({json:{data}});
   assert.equal(method,"POST");postCount++;const body=route.request().postDataJSON();
   if(mode==="network")return route.abort();
   if(mode==="timeout"){pending=route;return;}
   if(["422","409","401","403","500"].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:"Synthetic rejection"}}});
   if(mode==="malformed")return route.fulfill({json:{data:{}}});
   const result={...body,id:"saved",status:"ACTIVE",quotedRate:"125.50",holdExpiresAt:"2030-10-01T00:00:00.000Z",intendedMoveIn:"2030-10-02T00:00:00.000Z"};
   if(mode==="facility")result.facilityId="other";if(mode==="customer")result.customerId="other";if(mode==="unit")result.unitId="other";if(mode==="rate")result.quotedRate="99.00";if(mode==="date")result.intendedMoveIn="2030-10-03T00:00:00.000Z";
   if(mode==="refresh-fail")readFail=true;
   return route.fulfill({status:201,json:{data:result}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole("button",{name:"New reservation",exact:true}).click();
  const form=page.locator(".reservation-modal form");await form.locator('[name="customerId"]').selectOption("customer");await form.locator('[name="quotedRate"]').fill("125.50");await form.locator('[name="holdExpiresAt"]').fill("2030-10-01");await form.locator('[name="intendedMoveIn"]').fill("2030-10-02");
  if(mode==="timeout")await page.clock.install();
  await form.evaluate(f=>{f.requestSubmit();f.requestSubmit();});
  if(process.env.REPRO_ONLY){await page.waitForTimeout(300);assert.ok(errors.length);console.log("REPRO: create network failure raises unhandled page error");await page.close();break;}
  if(mode==="timeout"){await expect.poll(()=>Boolean(pending)).toBe(true);await page.clock.fastForward(20_001);await pending.abort().catch(()=>{});await page.clock.resume();}
  if(["success","refresh-fail"].includes(mode)){
   await expect(page.getByText("Reservation created and the unit is now held.")).toBeVisible();await expect(form).toHaveCount(0);
   if(readFail){await expect(page.getByRole("alert")).toContainText("could not be loaded");readFail=false;await page.getByRole("button",{name:"Refresh reservations",exact:true}).click();await expect(page.getByText("synthetic@example.invalid")).toBeVisible();}
  }else if(["401","403"].includes(mode)){
   await expect(form).toHaveCount(0);await expect(page.getByRole("alert")).toContainText(mode==="401"?"Sign in":"administrator");await expect(page.getByText("synthetic@example.invalid")).toHaveCount(0);
  }else{
   const uncertain=!["422","409"].includes(mode);
   await expect(form.getByRole("alert")).toContainText(uncertain?"could not confirm":mode==="409"?"no longer available":"Check the reservation");
   await expect(form.locator('[name="customerId"]')).toHaveValue("customer");await expect(form.locator('[name="quotedRate"]')).toHaveValue("125.50");await expect(form.locator('[name="intendedMoveIn"]')).toHaveValue("2030-10-02");
   if(uncertain){await expect(form.getByRole("button",{name:"Reserve unit",exact:true})).toBeDisabled();if(mode==="timeout"){const review=form.getByRole("button",{name:"Review reservations",exact:true});await review.scrollIntoViewIfNeeded();assert.equal(await page.locator(".reservation-modal").evaluate(el=>el.scrollWidth<=el.clientWidth),true,"modal horizontal overflow");const bounds=await review.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=900);await page.screenshot({path:`output/reservation-create-recovery/uncertain-${width}.png`,fullPage:true});}await form.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"New reservation",exact:true}).click();await expect(page.getByRole("button",{name:"Reserve unit",exact:true})).toBeDisabled();await page.getByRole("button",{name:"Review reservations",exact:true}).click();await expect(page.getByText("synthetic@example.invalid")).toBeVisible();}
  }
  assert.equal(postCount,1,`${width} ${mode} duplicate POST`);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(mode==="409")await page.screenshot({path:`output/reservation-create-recovery/${width}.png`,fullPage:true});
  await page.close();
 }
 if(process.env.REPRO_ONLY)break;console.log(`PASS reservation creation recovery ${width}`);
}}finally{await browser.close();server.close();}
