import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({entryPoints:["tests/browser/adjustments-fixture.jsx"],bundle:true,write:false,format:"esm",jsx:"automatic"});
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
const data={userId:"requester",accounts:[{id:"cmaccountfixture000001",accountNumber:"CI-101",balance:"115",tenancy:{facility:{name:"Training store"}}}],requests:[]};
let saved;
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/v1/adjustments**",async route=>{
    const req=route.request();
    if(req.method()==="GET") return route.fulfill({json:req.url().includes("accountId=")?{balance:"115",entries:[{id:"cmsourcefixture000001",type:"CHARGE",description:"Original monthly rent",amount:"115",taxAmount:"15"}]}:data});
    const body=req.postDataJSON();calls.push(body);
    if(body.action==="preview"){saved={input:body.input,fingerprint:"a".repeat(64),accountNumber:"CI-101",facilityName:"Training store",balanceBefore:"115",balanceAfter:"57.50",amount:"57.50",taxAmount:"7.50",source:{description:"Original monthly rent",amount:"115"}};return route.fulfill({json:saved});}
    if(body.action==="request"){data.requests=[{id:"cmrequestfixture000001",kind:"CREDIT",status:"PENDING_APPROVAL",amount:"57.50",taxAmount:"7.50",reason:body.input.reason,evidenceReference:body.input.evidenceReference,requestedById:"requester",snapshot:saved}];return route.fulfill({json:data.requests[0]});}
    if(body.action==="approve"){data.requests[0].status=data.requests[0].kind==="REFUND"?"APPROVED":"POSTED";data.requests[0].reviewedById="reviewer";return route.fulfill({json:data.requests[0]});}
    if(body.action==="record-payout"){data.requests[0].status="POSTED";data.requests[0].payoutReference=body.reference;return route.fulfill({json:data.requests[0]});}
    throw new Error(`Unexpected action ${body.action}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel("Account",{exact:true}).selectOption("cmaccountfixture000001");
  await page.getByLabel("Original entry").selectOption("cmsourcefixture000001");
  await page.getByLabel("Amount (including tax)").fill("57.50");
  await page.getByLabel("Reason",{exact:true}).fill("Agreed correction for CI only");
  await page.getByLabel("Supporting evidence reference").fill("CI-source-document");
  await page.getByRole("button",{name:"Preview adjustment"}).click();
  await expect(page.getByRole("button",{name:"Request independent approval"})).toBeDisabled();
  await page.getByLabel("I checked the source").check();
  await page.getByLabel("Amount (including tax)").fill("50");
  await expect(page.locator(".adjustment-preview")).toHaveCount(0);
  await page.getByLabel("Amount (including tax)").fill("57.50");
  await page.getByRole("button",{name:"Preview adjustment"}).click();await page.getByLabel("I checked the source").check();
  await page.getByRole("button",{name:"Request independent approval"}).click();
  await expect(page.getByRole("button",{name:"Approve and post correction"})).toBeDisabled();
  data.userId="reviewer";await page.reload();
  await page.getByLabel("Reference for cmrequestfixture000001").fill("CI reviewed evidence");
  await page.getByLabel("I reviewed the saved source").check();
  await page.getByRole("button",{name:"Approve and post correction"}).click();
  await expect(page.getByText("Posted to account",{exact:true})).toBeVisible();
  data.requests[0]={...data.requests[0],kind:"REFUND",status:"PENDING_APPROVAL",reason:"Return CI overpayment",amount:"25"};await page.reload();
  await page.getByLabel("Reference for cmrequestfixture000001").fill("CI refund approval");await page.getByLabel("I reviewed the saved source").check();await page.getByRole("button",{name:"Approve refund request"}).click();
  await expect(page.getByText("Refund approved · payout not recorded",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Record completed external refund"})).toBeDisabled();
  await page.getByLabel("Completed payout date").fill("2026-09-21");
  await page.getByLabel("Reference for cmrequestfixture000001").fill("CI-completed-payout");
  await page.getByLabel("I verified the authorised external").check();
  await mkdir("output/adjustments",{recursive:true});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);await page.screenshot({path:`output/adjustments/${width}.png`,fullPage:true});}
  await page.getByRole("button",{name:"Record completed external refund"}).click();await expect(page.getByText("Posted to account",{exact:true})).toBeVisible();
  assert.equal(calls.filter(c=>c.action==="request").length,1);assert.equal(calls.filter(c=>c.action==="record-payout").length,1);assert.equal(calls.find(c=>c.action==="record-payout").paidConfirmed,true);assert.deepEqual(errors,[]);
  console.log("Adjustment browser checks passed: source selection, preview invalidation, request confirmation, self-approval disabled, independent posting, separate refund approval/payout, 1440/390px bounds; fixtures only.");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
