import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints:["tests/browser/debit-orders-fixture.jsx"], bundle:true, write:false, format:"esm", jsx:"automatic" });
const css = (await readFile("src/app/globals.css", "utf8")).replace('@import "tailwindcss";', "");
const server = createServer(async (req,res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
  if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  if (req.url?.startsWith("/brand/")) { try { return res.end(await readFile(`public${req.url}`)); } catch { res.writeHead(404); return res.end(); } }
  res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel:process.env.PLAYWRIGHT_CHANNEL } : {});
const calls = [], errors = [];
const workspace = { facilities:[{ id:"cmfacilityfixture000001", name:"Training store with a deliberately long facility name" }], accounts:[{ id:"cmaccountfixture000001", accountNumber:"CI-101", tenancy:{ facilityId:"cmfacilityfixture000001" } }], runs:[], submissionEnabled:false };
const preview = { fingerprint:"a".repeat(64), total:1150, rows:[{ accountId:"cmaccountfixture000001", accountNumber:"CI-101", amount:1150, reference:"ST24-example-mandate" }, { accountId:"cmaccountfixture000002", accountNumber:"CI-102", amount:0, blocker:"DEBIT_SIGNED_MANDATE_REQUIRED" }] };
try {
  const page = await browser.newPage({ viewport:{ width:1440,height:1000 } }); page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/v1/billing/debit-orders**",async route => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json:req.url().includes("accountId=") ? { plan:null,mandate:null } : req.url().includes("runId=") ? preview : workspace });
    const body = req.postDataJSON(); calls.push(body);
    if (body.action === "preview") return route.fulfill({ json:preview });
    if (body.action === "prepare") { workspace.runs = [{ id:"cmrunfixture000001", batchName:"ST24-209902-1234567890123456", period:"2099-02", actionDate:"2099-02-14",status:"PREPARED",total:"1150",failureCode:null,_count:{instructions:1} }]; return route.fulfill({ json:{ id:"cmrunfixture000001" } }); }
    if (body.action === "cancel") { workspace.runs[0].status="CANCELLED"; return route.fulfill({ json:{ok:true} }); }
    throw new Error(`Unexpected submission ${body.action}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel("Store",{exact:true}).selectOption("cmfacilityfixture000001").catch(async error => { console.log({ errors, page:await page.locator("body").innerText() }); throw error; });
  await page.getByLabel("Billing month",{exact:true}).fill("2099-02");
  await page.getByLabel("Collection date",{exact:true}).fill("2099-02-14");
  await page.getByRole("button",{name:"Preview collection run"}).click();
  await expect(page.getByRole("button",{name:"Save prepared run"})).toBeDisabled();
  await expect(page.getByRole("cell",{name:"A provider-verified signed mandate and its PDF are required."})).toBeVisible();
  await page.getByLabel("I reviewed the ready").check();
  await page.getByLabel("Collection date",{exact:true}).fill("2099-02-15");
  await expect(page.locator(".debit-preview")).toHaveCount(0);
  await page.getByLabel("Collection date",{exact:true}).fill("2099-02-14");
  await page.getByRole("button",{name:"Preview collection run"}).click();
  await page.getByLabel("I reviewed the ready").check();
  await page.getByRole("button",{name:"Save prepared run"}).click();
  await expect(page.getByRole("button",{name:"Submit test batch"})).toBeDisabled();
  await page.getByRole("button",{name:"View saved accounts and exclusions"}).click();
  await expect(page.locator(".debit-run li")).toHaveCount(2);
  await page.getByText("Account collection terms",{exact:true}).click();
  await page.getByLabel("Account",{exact:true}).selectOption("cmaccountfixture000001");
  await expect(page.getByText(/No hosted mandate is attached/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Save collection terms"})).toBeDisabled();
  await mkdir("output/debit-orders",{recursive:true});
  for (const width of [1440,390]) { await page.setViewportSize({width,height:1000}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`); await page.screenshot({path:`output/debit-orders/${width}.png`,fullPage:true}); }
  await page.getByRole("button",{name:"Cancel unsent run"}).click();
  await expect(page.getByText(/Cancelled before upload/)).toBeVisible();
  assert.equal(calls.filter(c=>c.action==="prepare").length,1); assert.equal(calls.find(c=>c.action==="prepare").confirm,true);
  assert.equal(calls.filter(c=>c.action==="submit").length,0); assert.deepEqual(errors,[]);
  console.log("Debit-order browser checks passed: readiness explanations, review gate, date invalidation, saved review, disabled submission, missing mandate, unsent cancellation, 1440/390px bounds; invented fixtures only.");
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
