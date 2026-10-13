import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints: ["tests/browser/mri-mapping-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic" });
const css = await readFile("src/styles/mri-mapping.css", "utf8");
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
  res.setHeader("content-type", "text/html"); res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f4f6f8;font-family:Arial,sans-serif}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
const movements = ["CHARGE", "PAYMENT", "CREDIT", "REFUND", "REVERSAL", "WRITE_OFF"];
let canManage = true, independent = false;
let review = { revision: null, status: "DRAFT", mapping: { entityCode: "", propertyCode: "", basis: "UNDECIDED", scopeNotes: "", rules: movements.map(movement => ({ movement, category: movement.toLowerCase(), debitAccount: "", creditAccount: "", taxAccount: "", taxCode: "", taxTreatment: "UNDECIDED", rationale: "" })) }, blockers: [], canApprove: false, approvedAt: null, approvalReference: null, postingEnabled: false };
const actions = [];
try {
  const page = await browser.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/v1/billing/mri/mapping", async route => {
    const command = route.request().postDataJSON();
    if (command) {
      actions.push(command);
      if (command.action === "save") review = { ...review, mapping: command.mapping, status: "DRAFT", approvedAt: null, approvalReference: null };
      if (command.action === "submit") review = { ...review, status: "IN_REVIEW", canApprove: independent };
      if (command.action === "approve") review = { ...review, status: "APPROVED", approvedAt: "2026-10-13T08:00:00Z", approvalReference: command.approvalReference };
      review.revision = "00000000-0000-4000-8000-000000000001";
    }
    await route.fulfill({ json: { review: { ...review, canApprove: review.status === "IN_REVIEW" && independent }, canManage } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole("heading", { name: "MRI finance mappings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  await page.getByLabel("MRI entity code", { exact: true }).fill("CI-ONLY");
  await page.getByLabel("MRI property code", { exact: true }).fill("CI-PROPERTY");
  await page.getByLabel("Accounting basis", { exact: true }).selectOption("ACCRUAL");
  await page.getByLabel("Source coverage and classification plan", { exact: true }).fill("Synthetic classification, signs and exclusions plan");
  for (let i = 0; i < 6; i++) {
    await page.getByLabel("Debit GL account", { exact: true }).nth(i).fill("CI-DEBIT");
    await page.getByLabel("Credit GL account", { exact: true }).nth(i).fill("CI-CREDIT");
    await page.getByLabel("Tax treatment", { exact: true }).nth(i).selectOption("NO_TAX");
    await page.getByLabel("Classification and accounting rationale", { exact: true }).nth(i).fill("Synthetic identification, signs, tax and reversals");
  }
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("An independent finance reviewer must sign in", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve mapping" })).toHaveCount(0);
  independent = true; await page.reload();
  await page.getByLabel("Finance approval reference", { exact: true }).fill("CI-reviewed");
  await page.getByRole("button", { name: "Approve mapping", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Mapping approved");
  await expect(page.getByText("Reference: CI-reviewed", { exact: false })).toBeVisible();
  await mkdir("output/mri-mapping", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    await page.screenshot({ path: `output/mri-mapping/${width}.png`, fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `output/mri-mapping/${width}-top.png` });
    await page.getByRole("heading", { name: "Finance review", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/mri-mapping/${width}-review.png` });
  }
  await page.getByLabel("MRI property code", { exact: true }).fill("CI-CHANGED");
  await expect(page.getByRole("link", { name: "Download saved mapping review CSV" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Reference: CI-reviewed", { exact: false })).toHaveCount(0);
  canManage = false; await page.reload();
  await expect(page.getByLabel("MRI entity code", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  assert.deepEqual(actions.map(a => a.action), ["save", "submit", "approve", "save"]); assert.deepEqual(errors, []);
  console.log("MRI mapping browser checks passed: draft/review/approval, stale approval clearing, read-only and 1440/390/320 layouts. API replies are fixtures, not database or provider proof.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
