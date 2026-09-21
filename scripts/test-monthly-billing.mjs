import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints: ["tests/browser/monthly-billing-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic" });
const css = (await readFile("src/app/globals.css", "utf8")).replace('@import "tailwindcss";', "");
const server = createServer(async (req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
  if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  if (req.url?.startsWith("/brand/")) { try { return res.end(await readFile(`public${req.url}`)); } catch { res.writeHead(404); return res.end(); } }
  res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const calls = [], errors = [];
let saved = { firstPeriod: "2026-02", proration: "ACTUAL_DAYS", taxPercent: 15, rentTaxable: true, insuranceEnabled: false, insuranceTaxable: false, charges: [], discount: null, approvalReference: "Fixture approval only" };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/v1/billing/monthly**", async route => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { data: req.url().includes("accountId=") ? { plan: saved, invoices: [] } : [{ id: "cmfixtureaccount000000000001", accountNumber: "CI-101", customer: { firstName: "Example", lastName: "Tenant", companyName: null }, tenancy: { status: "ACTIVE", facility: { name: "Training store with a deliberately long facility name" } } }] } });
    const body = req.postDataJSON(); calls.push(body);
    if (body.action === "plan") { saved = body.plan; return route.fulfill({ json: { data: saved } }); }
    if (body.action === "preview") return route.fulfill({ json: { data: { fingerprint: "a".repeat(64), customerName: "Example Tenant", total: 1150, taxTotal: 150, lines: [{ key: "rent", description: "Rent — unit 101", amount: 1150, taxAmount: 150, type: "CHARGE" }] } } });
    return route.fulfill({ json: { data: { documentId: "fixture-document", invoiceNumber: "INV-202602-CI-101" } } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel("Customer account").selectOption("cmfixtureaccount000000000001");
  await page.getByLabel("Billing month", { exact: true }).fill("2026-02");
  await page.getByRole("button", { name: "Preview monthly invoice" }).click();
  await expect(page.getByRole("button", { name: "Post charges and save invoice" })).toBeDisabled();
  assert.equal(calls.filter(c => c.action === "post").length, 0);
  await page.getByLabel("I have checked").check();
  await expect(page.getByRole("button", { name: "Post charges and save invoice" })).toBeEnabled();
  await page.getByLabel("Billing month", { exact: true }).fill("2026-03");
  await expect(page.locator(".monthly-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Add recurring charge" }).click();
  await expect(page.getByRole("button", { name: "Preview monthly invoice" })).toBeDisabled();
  await page.getByLabel("Charge code", { exact: true }).fill("ADMIN");
  await page.getByLabel("Description", { exact: true }).fill("Approved monthly admin");
  await page.getByLabel("Monthly amount (R)").fill("115");
  await page.getByRole("button", { name: "Save approved terms" }).click();
  await page.getByRole("button", { name: "Preview monthly invoice" }).click();
  await mkdir("output/monthly-billing", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Overflow at ${width}`);
    await page.screenshot({ path: `output/monthly-billing/${width}.png`, fullPage: true });
  }
  await page.getByLabel("I have checked").check();
  await page.getByRole("button", { name: "Post charges and save invoice" }).click();
  await expect(page.getByRole("status")).toContainText("INV-202602-CI-101");
  assert.equal(calls.filter(c => c.action === "post").length, 1);
  assert.equal(calls.find(c => c.action === "post").confirm, true);
  assert.deepEqual(errors, []);
  console.log("Monthly billing browser checks passed: review gate, edit invalidation, plan save, posting contract and desktop/mobile bounds. All data and financial writes were isolated fixtures.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
