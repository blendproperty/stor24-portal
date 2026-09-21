import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints:["tests/browser/mri-fixture.jsx"], bundle:true, write:false, format:"esm", jsx:"automatic" });
const css = (await readFile("src/app/globals.css", "utf8")).replace('@import "tailwindcss";', "");
const server = createServer((req,res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
  if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const errors = [], writes = [];
let canManage = true, failSave = false;
let configuration = { revision:null, databaseLabel:"", environment:"unknown", credentialsStored:false, databaseIdentifierStored:false, encryptionReady:true, authenticated:false, postingEnabled:false };
try {
  const page = await browser.newPage({ viewport:{ width:1440,height:1000 } }); page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/v1/billing/mri**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "POST") {
      writes.push(request.postDataJSON());
      if (failSave) return route.fulfill({ status:409, json:{ error:"The settings changed. Reload before saving again." } });
      configuration = { ...configuration, revision:"2026-09-21T00:00:00.000Z", databaseLabel:writes.at(-1).databaseLabel, credentialsStored:true };
      return route.fulfill({ json:{ configuration } });
    }
    if (url.searchParams.has("month")) return route.fulfill({ json:{ month:url.searchParams.get("month"), partial:false, rowCount:3, excluded:1, unassigned:0, quarantinedAccounts:1, legacyQueue:2, fingerprint:"b".repeat(64), generatedAt:"2026-09-21T00:00:00Z", postingEnabled:false, groups:[{ facility:"Training store with a long description", type:"CHARGE", count:2, amount:"230.00", tax:"30.00" }] } });
    return route.fulfill({ json:{ configuration, canManage } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByText("Posting is not yet available", { exact:true })).toBeVisible();
  await page.getByLabel("Database label", { exact:true }).fill("CI Blend");
  await page.getByLabel("API login", { exact:true }).fill("ci@example.invalid");
  await page.getByLabel("API password", { exact:true }).fill("ci-password-only");
  await page.getByRole("button", { name:"Save encrypted settings" }).click();
  await expect(page.getByRole("status")).toContainText("has not been tested");
  await expect(page.getByLabel("API password", { exact:true })).toHaveValue("");
  failSave = true;
  await page.getByLabel("API login", { exact:true }).fill("ci@example.invalid");
  await page.getByLabel("API password", { exact:true }).fill("ci-password-again");
  await page.getByRole("button", { name:"Save encrypted settings" }).click();
  await expect(page.getByRole("alert")).toContainText("settings changed");
  await expect(page.getByLabel("API password", { exact:true })).toHaveValue("");
  await page.getByLabel("Month", { exact:true }).fill("2026-01");
  await page.getByRole("button", { name:"Review source movements" }).click();
  await expect(page.getByRole("cell", { name:"230.00", exact:true })).toBeVisible();
  await mkdir("output/mri", { recursive:true });
  for (const width of [1440,390]) {
    await page.setViewportSize({ width,height:1000 });
    await page.screenshot({ path:`output/mri/${width}.png`, fullPage:true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
  }
  await page.getByLabel("Month", { exact:true }).fill("");
  await expect(page.getByRole("button", { name:"Review source movements" })).toBeDisabled();
  await expect(page.getByRole("cell", { name:"230.00", exact:true })).toHaveCount(0);
  canManage = false; await page.reload();
  await expect(page.getByText("You have read-only access to MRI preparation.")).toBeVisible();
  await expect(page.getByRole("button", { name:"Save encrypted settings" })).toHaveCount(0);
  assert.equal(writes.length, 2); assert.equal(errors.length, 0);
  console.log("MRI browser checks passed: secret clearing on success/failure, stale-save feedback, month invalidation, view-only controls, desktop/mobile bounds; no journal submission controls.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
