import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const ids = Array.from({length:5},(_,i)=>`cm0000000000000000000000${i}`), [store,cso,manager,cover,runId] = ids;
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {OperationalChecklists} from './src/components/operational-checklists';createRoot(document.getElementById('root')).render(<OperationalChecklists/>);`, resolveDir:process.cwd(), loader:"jsx" }, bundle:true,write:false,format:"esm",jsx:"automatic",outfile:"output/checklist-browser/app.js", plugins:[{name:"next-fixture",setup(b){b.onResolve({filter:/^next\/link$/},a=>({path:a.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}] });
const compiled=await postcss([tailwindcss()]).process(await readFile("src/app/globals.css","utf8"),{from:resolve("src/app/globals.css")});
const css = compiled.css + (await Promise.all(["src/styles/stor24-brand.css","src/styles/staff-workspace.css"].map(p=>readFile(p,"utf8")))).join("\n") + bundle.outputFiles.find(f=>f.path.endsWith(".css")).text + '\n@font-face{font-family:Satoshi;src:url(/font.ttf);font-weight:300 900}:root{--font-satoshi:Satoshi}.app-shell{display:block;min-height:100vh}';
const font=await readFile("public/brand/Satoshi-Variable.ttf");
const server=createServer((req,res)=>{if(req.url==="/font.ttf"){res.setHeader("content-type","font/ttf");return res.end(font);}res.setHeader("content-type",req.url==="/app.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/app.js"?bundle.outputFiles.find(f=>f.path.endsWith(".js")).text:req.url==="/style.css"?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div class="app-shell"><main class="content"><div id="root"></div></main></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,"127.0.0.1",r));await mkdir("output/checklist-browser",{recursive:true});const browser=await chromium.launch();
try {for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}}), errors=[];page.on("pageerror",e=>errors.push(e.message));
  let actor=manager,writes=0,mode="ok",version=0;
  const makeRow=(id,label,expected="PASS")=>({id,label,expected,state:"PENDING",notes:"",evidence:"",lockCount:null,overlockTask:false});
  let record={version:1,template:"CLOSING",reviewerId:manager,rows:[],sourceAt:null,sourceHash:null,summary:"",comparisonReference:"",submittedAt:null,submittedBy:null,reviewedAt:null,reviewedBy:null,reviewNote:""};
  let task={id:runId,title:"Closing checklist",facilityId:store,assigneeId:cso,coverId:cover,status:"OPEN",startAt:"2026-10-23T06:00:00.000Z",dueAt:"2026-10-23T08:00:00.000Z",updatedAt:"2026-10-23T06:00:00.000Z",completedAt:null,facility:{name:"Synthetic Midpoint"},assignee:{name:"Synthetic CSO"},cover:{name:"Synthetic cover"}};
  const metadata=()=>({actorId:actor,facilities:[{id:store,name:"Synthetic Midpoint"}],managerFacilityIds:actor===manager?[store]:[],staff:[{id:cso,name:"Synthetic CSO",facilityIds:[store],reviewerFacilityIds:[]},{id:manager,name:"Synthetic manager",facilityIds:[store],reviewerFacilityIds:[store]},{id:cover,name:"Synthetic cover",facilityIds:[store],reviewerFacilityIds:[]}]});
  await page.route("**/api/v1/operations/checklists*",route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==="GET"){
      if(mode==="denied")return route.fulfill({status:403,json:{error:{message:"Forbidden"}}});
      return route.fulfill({json:{data:{...metadata(),...(url.searchParams.has("id")?{task:{...task,operationalChecklist:record}}:{tasks:[task],nextCursor:null})}}});
    }
    writes++;const body=req.postDataJSON();
    if(mode==="lost")return route.abort();
    if(mode==="stale")return route.fulfill({status:409,json:{error:{message:"This record changed. Reload before acting."}}});
    if(req.method()==="POST"){
      assert.equal(body.template,"CLOSING");assert.equal(body.assigneeId,cso);assert.equal(body.reviewerId,manager);assert.equal(body.coverId,cover);assert.equal(new Date(body.startAt).getUTCHours(),6);assert.equal(body.occurrences,2);
    } else {
      assert.equal(body.expectedUpdatedAt,task.updatedAt);
      if(body.action==="START"){task.status="IN_PROGRESS";record.rows=[makeRow("0","Evening · Check all doors are locked"),makeRow("1","Evening · Count ground floor trolleys")];record.sourceAt="2026-10-23T06:10:00.000Z";}
      if(["SAVE","SUBMIT"].includes(body.action)){record.rows=record.rows.map(r=>({...r,...body.rows.find(b=>b.id===r.id)}));record.summary=body.summary;record.comparisonReference=body.comparisonReference;if(body.action==="SUBMIT"){task.status="WAITING";record.submittedAt="2026-10-23T07:00:00.000Z";record.submittedBy=actor;}}
      if(body.action==="RETURN"){record.reviewNote=body.note;task.status="IN_PROGRESS";record.submittedAt=null;}
      if(body.action==="APPROVE"){record.reviewNote=body.note;record.reviewedAt="2026-10-23T08:10:00.000Z";record.reviewedBy=actor;task.status="COMPLETED";task.completedAt=record.reviewedAt;}
    }
    task.updatedAt=new Date(Date.parse("2026-10-23T06:00:00.000Z")+(++version)*1000).toISOString();return route.fulfill({json:{data:{id:runId,count:2}}});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);await page.getByRole("button",{name:"Plan checklist",exact:true}).click();const form=page.getByRole("form",{name:"Plan checklist"});
  await form.getByLabel("Checklist",{exact:true}).selectOption("CLOSING");await form.getByLabel("First date (SAST)").fill("2026-10-23");await form.getByLabel("Responsible staff").selectOption(cso);await form.getByLabel("Absence cover").selectOption(cover);await form.getByLabel("Manager / GM reviewer").selectOption(manager);await form.getByLabel("Repeat",{exact:true}).selectOption("DAILY");await form.getByLabel("Total occurrences").fill("2");await form.getByRole("button",{name:"Create planned runs"}).click();await expect(page.getByRole("region",{name:"Checklist record"})).toBeVisible();
  actor=cso;await page.getByRole("button",{name:"Reload saved records"}).click();await page.getByRole("button",{name:"Start inspection"}).click();await expect(page.getByLabel("Result")).toHaveCount(2);
  await expect(page.getByRole("button",{name:"Submit for manager review"})).toBeDisabled();await page.getByLabel("Result",{exact:true}).first().selectOption("ISSUE");await page.getByLabel("Finding / reason / count").first().fill("Office door latch sticks; manager notified");await page.getByLabel("Evidence reference").first().fill("Maintenance photograph reference 23 Oct");await page.getByLabel("Result",{exact:true}).nth(1).selectOption("PASS");await page.getByLabel("Trolleys counted").fill("3");await page.getByLabel("Summary and escalation to reviewer").fill("Door repair requires manager review");
  await page.getByRole("button",{name:"Save progress"}).click();await expect(page.getByLabel("Finding / reason / count").first()).toHaveValue("Office door latch sticks; manager notified");await page.getByRole("button",{name:"Submit for manager review"}).click();await expect(page.getByRole("button",{name:"Save progress"})).toHaveCount(0);
  actor=manager;await page.getByRole("button",{name:"Reload saved records"}).click();await page.getByLabel("Review and action note").fill("Please add the maintenance reference");await page.getByRole("button",{name:"Return for correction"}).click();await expect(page.getByText("Please add the maintenance reference")).toBeVisible();
  actor=cso;await page.getByRole("button",{name:"Reload saved records"}).click();await page.getByRole("button",{name:"Submit for manager review"}).click();actor=manager;await page.getByRole("button",{name:"Reload saved records"}).click();await page.getByLabel("Review and action note").fill("Reviewed evidence; repair assigned separately");await page.getByRole("button",{name:"Sign off review"}).click();await expect(page.getByLabel("Result").first()).toBeDisabled();await page.screenshot({path:`output/checklist-browser/reviewed-${width}.png`,fullPage:true});
  // Reuse the same rendered editor for a padlock run and verify discrepancies/counts and stale/lost-response recovery.
  actor=cso;task.status="IN_PROGRESS";task.title="Weekly padlock walkthrough";task.completedAt=null;record={...record,template:"PADLOCK",rows:[makeRow("unit1","Unit 01","VACANT"),makeRow("unit2","Unit 02","REVIEW")],submittedAt:null,submittedBy:null,reviewedAt:null,reviewedBy:null,reviewNote:""};
  await page.getByRole("button",{name:"Reload saved records"}).click();await page.getByLabel("Result",{exact:true}).first().selectOption("OVERLOCKED");await page.getByLabel("Result",{exact:true}).nth(1).selectOption("OCCUPIED");await page.getByLabel("Locks counted").first().fill("2");await page.getByLabel("Locks counted").nth(1).fill("1");await page.getByLabel("Finding / reason / count").first().fill("Unexpected overlock; manager to investigate");await page.getByLabel("Finding / reason / count").nth(1).fill("Service unit occupied; needs review");await page.getByLabel("Rent roll and collections comparison reference").fill("Rent roll and approved collections list 23 October");await page.getByLabel("Show findings only").check();await expect(page.getByLabel("Result")).toHaveCount(2);
  await page.screenshot({path:`output/checklist-browser/padlocks-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  mode="stale";await page.getByRole("button",{name:"Submit for manager review"}).click();await expect(page.getByRole("alert")).toContainText("Reload");await expect(page.getByRole("button",{name:"Save progress"})).toBeDisabled();
  mode="ok";page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Reload saved records"}).click();mode="lost";const before=writes;await page.getByRole("button",{name:"Save progress"}).click();await expect(page.getByRole("alert")).toContainText("could not be confirmed");await expect(page.getByRole("button",{name:"Save progress"})).toBeDisabled();assert.equal(writes,before+1);
  mode="denied";await page.getByRole("button",{name:"Reload saved records"}).click();await expect(page.getByRole("region",{name:"Checklist record"})).toHaveCount(0);await expect(page.getByText("Unexpected overlock; manager to investigate")).toHaveCount(0);
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS planner, assigned results/counts, review/return/history, padlocks, stale/lost response and access clearing ${width}`);
}} finally { await browser.close();server.close(); }
