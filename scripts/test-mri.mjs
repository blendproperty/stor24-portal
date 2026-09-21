import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints:["tests/browser/mri-fixture.jsx"], bundle:true, write:false, format:"esm", jsx:"automatic" });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/mri-workspace.css"].map(file => readFile(file, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const fontPaths = new Set(["/brand/Satoshi-Handover-400.woff2", "/brand/Satoshi-Handover-500.woff2", "/brand/Satoshi-Handover-700.woff2"]);
const server = createServer(async (req,res) => {
  if (fontPaths.has(req.url)) { res.setHeader("Content-Type", "font/woff2"); return res.end(await readFile(`public${req.url}`)); }
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
  if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const errors = [], writes = [];
let canManage = true, failSave = false;
let configuration = { revision:null, databaseLabel:"", environment:"unknown", credentialsStored:false, databaseIdentifierStored:false, encryptionReady:true, authenticated:false, databaseReadable:false, databases:[], checkedAt:null, failureCode:null, discoveryAvailable:false, propertyCount:null, postingEnabled:false };
try {
  const page = await browser.newPage({ viewport:{ width:1440,height:1000 } }); page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/v1/billing/mri**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "POST") {
      writes.push(request.postDataJSON());
      if (writes.at(-1).action === "check") { configuration = { ...configuration, authenticated:true, discoveryAvailable:true, checkedAt:"2026-09-21T00:00:00.000Z", databases:[{key:"ci-key",label:"CI Blend"}] }; return route.fulfill({ json:{configuration} }); }
      if (failSave) return route.fulfill({ status:409, json:{ error:"The settings changed. Reload before saving again." } });
      configuration = { ...configuration, revision:"2026-09-21T00:00:00.000Z", databaseLabel:writes.at(-1).databaseLabel, credentialsStored:true };
      return route.fulfill({ json:{ configuration } });
    }
    if (url.searchParams.has("month")) return route.fulfill({ json:{ month:url.searchParams.get("month"), partial:true, rowCount:18, excluded:17, unassigned:0, quarantinedAccounts:17, legacyQueue:18, fingerprint:"b".repeat(64), generatedAt:"2026-09-21T00:00:00Z", postingEnabled:false, groups:[{ facility:"Store 1 — Training", type:"PAYMENT", count:1, amount:"10.00", tax:"0.00" }] } });
    return route.fulfill({ json:{ configuration, canManage } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByText("Posting off", { exact:true })).toBeVisible();
  await expect(page.getByLabel("API password", { exact:true })).toBeVisible();
  assert.equal(writes.length, 0, "Loading cannot perform a provider check or save");
  await page.getByLabel("Database label", { exact:true }).fill("CI Blend");
  await page.getByLabel("API login", { exact:true }).fill("ci@example.invalid");
  await page.getByLabel("API password", { exact:true }).fill("ci-password-only");
  await page.getByRole("button", { name:"Save settings", exact:true }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await expect(page.getByLabel("API password", { exact:true })).toHaveValue("");
  await page.getByRole("button", {name:"Check connection",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Sign-in verified");
  await expect(page.getByLabel("Databases returned by MRI")).toBeVisible();
  failSave = true;
  await page.getByLabel("API login", { exact:true }).fill("ci@example.invalid");
  await page.getByLabel("API password", { exact:true }).fill("ci-password-again");
  await page.getByRole("button", { name:"Save settings",exact:true }).click();
  await expect(page.getByRole("alert")).toContainText("settings changed");
  await expect(page.getByLabel("API password", { exact:true })).toHaveValue("");
  configuration = { ...configuration, databaseLabel:"Blend", authenticated:true, databaseReadable:true, databaseIdentifierStored:true, propertyCount:0, failureCode:"MRI_JOURNAL_NOT_ENABLED" };
  await page.reload();
  await expect(page.getByRole("heading", {name:"Connected to Blend"})).toBeVisible();
  await expect(page.getByText("No properties returned by MRI.", {exact:false})).toBeVisible();
  await expect(page.getByRole("button", {name:"Connection settings",exact:true})).toHaveAttribute("aria-expanded","false");
  await expect(page.getByLabel("API password", { exact:true })).toHaveCount(0);
  await page.getByRole("button", { name:"Review movements",exact:true }).click();
  await expect(page.getByRole("cell", { name:/10\.00$/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.fonts.check('400 14px "Satoshi Handover"')), "Real regular font must load");
  assert.equal(await page.locator('.mri-subtitle').evaluate(el => getComputedStyle(el).fontWeight), "400");
  assert.equal(await page.getByRole("cell", { name:/10\.00$/ }).evaluate(el => getComputedStyle(el).textAlign), "right");
  await mkdir("output/mri-design", { recursive:true });
  for (const width of [1440,768,390]) {
    await page.setViewportSize({ width,height:1000 });
    await page.screenshot({ path:`output/mri-design/${width}.png`, fullPage:true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    const moneyBounds = await page.getByRole("cell",{name:/10\.00$/}).boundingBox();
    assert.ok(moneyBounds.x >= 0 && moneyBounds.x + moneyBounds.width <= width, "Amount must be visible without horizontal scrolling");
  }
  await page.getByText("Exclusions & review notes",{exact:true}).click();
  await expect(page.getByText("18 historical payment queue records remain held.",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Connection settings",exact:true}).click();
  await expect(page.getByLabel("API password",{exact:true})).toBeVisible();
  await page.getByLabel("API password",{exact:true}).fill("discard-on-close");
  await page.getByRole("button",{name:"Connection settings",exact:true}).click();
  await page.getByRole("button",{name:"Connection settings",exact:true}).click();
  await expect(page.getByLabel("API password",{exact:true})).toHaveValue("");
  await page.getByText("Enter a database identifier manually",{exact:true}).click();
  await expect(page.getByLabel("Database identifier",{exact:true})).toBeVisible();
  await page.screenshot({path:"output/mri-design/mobile-settings.png",fullPage:true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Settings overflow on mobile");
  await page.getByLabel("Month", { exact:true }).fill("");
  await expect(page.getByRole("button", { name:"Review movements",exact:true })).toBeDisabled();
  await expect(page.getByRole("cell", { name:/10\.00$/ })).toHaveCount(0);
  configuration = { ...configuration, authenticated:false, databaseReadable:false, failureCode:"MRI_AUTH_REJECTED" };
  await page.reload();
  await expect(page.getByRole("heading",{name:"Connection needs a check"})).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("MRI rejected");
  await expect(page.getByText("Read access verified",{exact:true})).toHaveCount(0);
  canManage = false; await page.reload();
  await expect(page.getByText("Read-only access",{exact:true})).toBeVisible();
  await expect(page.getByRole("button", { name:"Save settings",exact:true })).toHaveCount(0);
  await expect(page.getByRole("button", { name:"Check connection",exact:true })).toHaveCount(0);
  assert.equal(writes.length, 3); assert.equal(errors.length, 0);
  console.log("MRI browser checks passed: real regular font, collapsed settings, secret clearing/discard, safe writes, failed-check status, zero-property message, month invalidation, view-only controls and 1440/768/390px bounds.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
