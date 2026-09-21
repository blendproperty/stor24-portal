import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({entryPoints:["tests/browser/collections-fixture.jsx"],bundle:true,write:false,format:"esm",jsx:"automatic"});
const css=(await readFile("src/app/globals.css","utf8")).replace('@import "tailwindcss";',"");
const server=createServer(async(req,res)=>{
  if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");return res.end(bundle.outputFiles[0].text);}
  if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");return res.end(css);}
  if(req.url?.startsWith("/brand/")){try{return res.end(await readFile(`public${req.url}`));}catch{res.writeHead(404);return res.end();}}
  res.setHeader("Content-Type","text/html");res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{});
const errors=[],calls=[];
const row={id:"cmaccountfixture000001",accountNumber:"CI-101",name:"Training tenant",facilityId:"store1",facility:"Training store with a deliberately long descriptive name",currentBalance:"100",ageing:{buckets:[0,0,0,0,10000],overdue:10000,credit:0,balance:10000,oldestDays:100,charges:[{id:"source1",description:"Original rent",dueDate:"2026-06-01",remaining:10000,days:100}],issue:null},hold:null,revision:0,ownerId:null,nextFollowUp:null,disputed:false,disputeReason:null,terms:{dueDays:0,allocation:"OLDEST_DUE_FIRST",approvalReference:"CI approved",overrides:[]},promises:[],activities:[],owners:[{id:"cmownerfixture0000001",name:"CI collector"}],sources:[{id:"source1",description:"Original rent",date:"2026-06-01"}]};
const data={asOf:"2026-09-21",today:"2026-09-21",userId:"cmownerfixture0000001",rows:[row,{...row,id:"cmaccountfixture000002",accountNumber:"CI-102",ageing:{...row.ageing,overdue:0,buckets:[0,0,0,0,0],issue:"Approved due dates and allocation terms are missing."}}]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/collections**",async route=>{
  const req=route.request();if(req.method()==="GET"){const asOf=new URL(req.url()).searchParams.get("asOf")||data.today;return route.fulfill({json:{...data,asOf}});}
  const body=req.postDataJSON();calls.push(body);row.revision++;
  if(body.action==="follow-up"){row.ownerId=body.ownerId;row.nextFollowUp=body.nextFollowUp;}
  else if(body.action==="dispute"){row.disputed=body.disputed;row.hold=body.disputed?"Dispute hold":null;}
  else if(body.action==="promise")row.promises=[{id:"cmpromisefixture00001",amount:body.amount,dueDate:body.dueDate,status:"OPEN",createdAt:new Date().toISOString(),progress:{label:"Awaiting receipt",received:0,onTime:0,covered:false}}];
  else if(body.action==="terms")row.terms=body.terms;else throw new Error("Unexpected action "+body.action);
  row.activities.unshift({id:`action${calls.length}`,action:body.action,note:body.note,actorId:data.userId,createdAt:new Date().toISOString()});return route.fulfill({json:{id:`action${calls.length}`}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await expect(page.getByRole("button",{name:"Review CI-102",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Open next follow-up"}).click();assert.equal(calls.length,0);
 await expect(page.getByRole("heading",{name:"CI-101 · Training tenant"})).toBeVisible();
 await expect(page.getByRole("button",{name:"Save follow-up",exact:true})).toBeDisabled();
 await page.getByText("Review charge ageing and approved terms",{exact:true}).click();
 await page.getByLabel("Case note / evidence reference").fill("CI terms approval evidence");
 await expect(page.getByRole("button",{name:"Save approved ageing terms"})).toBeDisabled();
 await page.getByLabel("Finance approved these due dates").check();
 await page.getByLabel("Approved days after charge").fill("7");
 await expect(page.getByLabel("Finance approved these due dates")).not.toBeChecked();
 await page.getByLabel("Finance approved these due dates").check();await page.getByRole("button",{name:"Save approved ageing terms"}).click();
 await expect(page.getByText("CI terms approval evidence",{exact:true})).toBeVisible();
 await page.getByLabel("Case note / evidence reference").fill("CI actual contact outcome");
 await page.getByLabel("Follow-up owner").selectOption("cmownerfixture0000001");await page.getByLabel("Next follow-up",{exact:true}).fill(data.today);
 await page.getByRole("button",{name:"Save follow-up",exact:true}).click();await expect(page.getByText("CI actual contact outcome",{exact:true})).toBeVisible();
 await page.getByLabel("Case note / evidence reference").fill("CI dispute evidence");await page.getByRole("button",{name:"Place dispute hold"}).click();
 await expect(page.getByRole("button",{name:"Open next follow-up"})).toBeDisabled();
 await page.getByLabel("Case note / evidence reference").fill("CI resolution evidence");await page.getByRole("button",{name:"Resolve dispute hold"}).click();
 await page.getByLabel("Case note / evidence reference").fill("CI customer agreed promise");await page.getByLabel("Promised amount").fill("50");await page.getByLabel("Promise due date").fill(data.today);
 await expect(page.getByRole("button",{name:"Record agreed promise"})).toBeDisabled();await page.getByLabel("The customer agreed").check();await page.getByRole("button",{name:"Record agreed promise"}).click();
 await expect(page.getByRole("button",{name:"Confirm promise kept"})).toBeDisabled();
 await page.getByLabel("Show",{exact:true}).selectOption("review");await expect(page.getByRole("button",{name:"Review CI-101",exact:true})).toHaveCount(0);await expect(page.getByRole("link",{name:"Export filtered CSV"})).toHaveAttribute("href",/mode=review/);
 await page.getByLabel("Show",{exact:true}).selectOption("all");
 await page.getByLabel("As of (South Africa)").fill("2026-09-20");await page.getByRole("button",{name:"Review CI-101",exact:true}).click();await expect(page.getByLabel("Case note / evidence reference")).toBeDisabled();
 await page.getByLabel("As of (South Africa)").fill(data.today);await page.getByRole("button",{name:"Review CI-101",exact:true}).click();
 await mkdir("output/collections",{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`output/collections/${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);}
 assert.equal(errors.length,0);assert.deepEqual(calls.map(c=>c.action),["terms","follow-up","dispute","dispute","promise"]);
 console.log("Collections browser checks passed: scoped filters, queue selection without contact, evidenced follow-up, dispute hold, promise gating, historical read-only mode and 1440/390px bounds.");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
