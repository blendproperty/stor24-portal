import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({entryPoints:["tests/browser/settlements-fixture.jsx"],bundle:true,write:false,format:"esm",jsx:"automatic"});
const css=(await readFile("src/app/globals.css","utf8")).replace('@import "tailwindcss";',"");
const server=createServer((req,res)=>{
 if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");return res.end(bundle.outputFiles[0].text);}
 if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");return res.end(css);}
 res.setHeader("Content-Type","text/html");res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{});
const calls=[],errors=[];
const s={id:"cmstatementfixture00001",date:"2026-01-01",status:"DRAFT",revision:0,environment:"live",merchantLabel:"Training merchant with a deliberately long store description · …0000",opening:"0",closing:"100",source:"UPLOAD",sourceReference:"CI original",importedById:"preparer",editedById:"preparer",approvedById:null,approvalReference:null,lines:[{id:"cmlinereceiptfixture001",transactionId:"1234",code:"PNC",kind:"RECEIPT",description:"Training payment receipt",date:"2026-01-01",amount:"100",vat:"0",extras:["CI-101"],paymentId:null,adjustmentId:null,bankEntryId:null,reference:null,resolvedById:null,issue:"Unresolved"}],payments:[{id:"cmpaymentfixture00001",amount:"100",providerRef:"CI payment",providerMerchantKey:null,account:{accountNumber:"CI-101"}}],adjustments:[],bank:[],candidatesTruncated:false};
const data={userId:"preparer",today:"2026-09-21",merchants:[{id:"cmmerchantfixture00001",label:s.merchantLabel,environment:"live",canFetch:true}],statements:[],bankImports:[],observations:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/v1/billing/settlements**",async route=>{
  const r=route.request();if(r.method()==="GET")return route.fulfill({json:new URL(r.url()).searchParams.has("id")?s:data});
  const v=r.postDataJSON();calls.push(v);
  if(v.action==="preview")return route.fulfill({json:{date:v.date,merchantLabel:s.merchantLabel,environment:"live",opening:"0",closing:"100",movement:"100",lines:s.lines,fingerprint:"a".repeat(64)}});
  if(v.action==="import"){data.statements=[{...s,_count:{lines:1}}];return route.fulfill({json:{id:s.id}});}
  if(v.action==="resolve"){s.lines[0]={...s.lines[0],paymentId:v.targetId,reference:v.reference,resolvedById:data.userId,issue:null};s.revision++;s.editedById=data.userId;}
  else if(v.action==="approve"){assert.equal(data.userId,"reviewer");s.status="REVIEWED";s.approvalReference=v.reference;s.revision++;}
  else if(v.action==="reopen"){s.status="DRAFT";s.revision++;}
  else throw new Error("Unexpected write "+v.action);
  data.statements=[{...s,_count:{lines:1}}];return route.fulfill({json:{id:s.id}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await expect(page.getByText("No statements imported.")).toBeVisible();
 await page.getByLabel("Merchant",{exact:true}).selectOption(data.merchants[0].id);
 await page.getByLabel("Statement date",{exact:true}).fill("2026-01-01");
 await page.getByLabel("Original statement file").setInputFiles({name:"statement.tsv",mimeType:"text/plain",buffer:Buffer.from("invented source")});
 await page.getByLabel("Statement source / evidence reference").fill("CI original source");
 await page.getByRole("button",{name:"Preview statement",exact:true}).click();
 await expect(page.getByRole("button",{name:"Import reviewed source"})).toBeDisabled();
 await page.getByLabel("I checked the original statement").check();
 await page.getByLabel("Statement date",{exact:true}).fill("2026-01-02");
 await expect(page.getByRole("button",{name:"Import reviewed source"})).toHaveCount(0);
 await page.getByLabel("Statement date",{exact:true}).fill("2026-01-01");
 await page.getByRole("button",{name:"Preview statement",exact:true}).click();await page.getByLabel("I checked the original statement").check();
 await page.getByRole("button",{name:"Import reviewed source"}).click();
 await page.getByRole("button",{name:"Review 1234",exact:true}).click();
 await page.getByLabel("Exact source match").selectOption("cmpaymentfixture00001");
 await page.getByLabel("Match evidence / accounting reference").fill("CI evidence identifies merchant");
 await expect(page.getByRole("button",{name:"Save line evidence"})).toBeDisabled();
 await page.getByLabel("The original payment evidence").check();await page.getByRole("button",{name:"Save line evidence"}).click();
 await expect(page.getByRole("cell",{name:/Current evidence matched/})).toBeVisible();
 await page.getByLabel("Review / reopen / void reference").fill("CI final review");
 await page.getByLabel("I checked this statement").check();
 await expect(page.getByRole("button",{name:"Record independent review"})).toBeDisabled();
 data.userId="reviewer";await page.reload();
 await page.locator(".settlement-history button").click();
 await page.getByLabel("Review / reopen / void reference").fill("CI independent review");
 await page.getByLabel("I checked this statement").check();await page.getByRole("button",{name:"Record independent review"}).click();
 await expect(page.getByRole("button",{name:"Reopen for correction"})).toBeVisible();
 s.lines[0].issue="Source changed — rematch before approval";await page.getByRole("button",{name:"Refresh source checks"}).click();
 await expect(page.getByRole("cell",{name:/Source changed/})).toBeVisible();
 await expect(page.getByRole("link",{name:"Export this review"})).toHaveAttribute("href",new RegExp(s.id+".*export=csv"));
 await page.getByText("Import bank movements",{exact:true}).click();await expect(page.getByRole("button",{name:"Import bank evidence"})).toBeDisabled();
 await page.getByText("Record current and available funds",{exact:true}).click();await expect(page.getByRole("button",{name:"Record balance observation"})).toBeDisabled();
 await mkdir("output/settlement",{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`output/settlement/${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);}
 assert.equal(errors.length,0);assert.deepEqual(calls.map(c=>c.action),["preview","preview","import","resolve","approve"]);
 console.log("Settlement browser checks passed: source preview invalidation, explicit import, receipt evidence, independent review, stale source display, bank/balance gates, CSV scope and 1440/390px bounds.");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
