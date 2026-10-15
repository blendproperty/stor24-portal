/** Synthetic intercepted UI only. No provider, financial or customer writes. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const compiled = await build({ stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{UnidentifiedReceiptWorkspace}from'./src/components/unidentified-receipt-workspace';createRoot(document.getElementById('root')).render(<UnidentifiedReceiptWorkspace/>);", resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, outdir: "output/unidentified-receipts", format: "esm", jsx: "automatic" });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(path => readFile(path, "utf8")))).join("\n").replace('@import "tailwindcss";', "") + "\nbody{margin:0;padding:20px;background:#f2f5f1;font-family:Arial,sans-serif}main{max-width:1400px;margin:auto;min-width:0}" + (compiled.outputFiles.find(file => file.path.endsWith(".css"))?.text || "");
let user, rows, writes, failedRead, failedSave, canManage, nextPage;
const manual = () => ({ id: "manual", facilityId: "store", sourceType: "MANUAL_REPORTED", sourceEnvironment: "REPORTED_UNVERIFIED", receiptDate: "2026-10-14", amount: "100.20", currency: "ZAR", status: "OPEN", revision: 0, capturedById: "capturer", reference: "manual-original-001", note: "Reported evidence remains unverified", issue: null, proposals: [], proposalsTruncated: false });
const workspace = () => ({ userId: user, canImportSources: canManage, facilities: [{ id: "store", name: "Fixture store", canCapture: canManage, canPropose: canManage, canReview: canManage }, { id: "other", name: "Excluded store", canCapture: false, canPropose: false, canReview: false }], rows, nextCursor: nextPage ? "fixture-next" : null });
const server = createServer(async (req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(compiled.outputFiles.find(file => file.path.endsWith(".js")).text); }
  if (req.url === "/fixture.css") { res.setHeader("content-type", "text/css"); return res.end(css); }
  if (req.url.startsWith("/api/")) {
    res.setHeader("content-type", "application/json"); const url = new URL(req.url, "http://fixture.invalid");
    if (req.method === "POST") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw); writes.push(input);
      if (failedSave) { res.statusCode = 503; return res.end(JSON.stringify({ error: "Synthetic uncertain save. Reload saved reviews." })); }
      if (input.action === "capture") rows = [{ ...manual(), id: "captured", reference: input.source.evidenceReference, capturedById: user }, ...rows];
      else {
        const row = rows.find(item => item.id === input.id); assert.equal(input.revision, row.revision); row.revision++;
        if (input.action === "propose") { row.status = "PROPOSED"; row.proposals = [{ id: "proposal", status: "PROPOSED", proposedById: user, reviewedById: null, reviewedAt: null, reviewReference: null, accountLabel: "FIXTURE-100 · Synthetic tenant", reason: input.reason }]; }
        if (input.action === "review") { row.status = input.decision; row.proposals[0] = { ...row.proposals[0], status: input.decision, reviewedById: user, reviewedAt: "2026-10-15T08:00:00Z", reviewReference: input.reference }; }
      }
      if (input.reference === "synthetic-refresh-failure") failedRead = true;
      return res.end(JSON.stringify({ id: "fixture-saved" }));
    }
    if (failedRead) { res.statusCode = 503; return res.end(JSON.stringify({ error: "Synthetic read outage" })); }
    if (url.searchParams.get("mode") === "accounts") return res.end(JSON.stringify({ rows: [{ id: "target", label: "FIXTURE-100 · Synthetic tenant" }], truncated: false }));
    if (url.searchParams.get("mode") === "sources") return res.end(JSON.stringify({ rows: [{ sourceType: "BANK_IMPORT_ENTRY", sourceId: "bank-source", sourceFingerprint: "a".repeat(64), label: "Bank · 2026-10-14 · 123.45 (verify original currency) · ref bank-txn" }], truncated: false, note: "Original currency remains subject to review." }));
    const data = workspace();
    if (url.searchParams.get("facilityId") === "other") data.rows = [];
    if (url.searchParams.has("cursor")) { data.rows = [{ ...manual(), id: "next", reference: "next-original-002" }]; data.nextCursor = null; nextPage = false; }
    return res.end(JSON.stringify(data));
  }
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main><div id="root"></div></main><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(); await mkdir("output/unidentified-receipts", { recursive: true });
try {
  for (const width of [1440, 768, 390, 320]) {
    user = "capturer"; rows = [manual(), { ...manual(), id: "bank", sourceType: "BANK_IMPORT_ENTRY", sourceEnvironment: "live", reference: "bank-original-001", note: "Original currency requires separate review" }, { ...manual(), id: "test", sourceEnvironment: "sandbox", reference: "test-original-001" }]; writes = []; failedRead = true; failedSave = false; canManage = true; nextPage = true;
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole("alert")).toContainText("Synthetic read outage"); await expect(page.getByText("No retained evidence in this selection.")).toHaveCount(0);
    failedRead = false; await page.getByRole("button", { name: "Reload saved reviews" }).click(); await expect(page.getByRole("heading", { name: "Retained evidence", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Load more evidence" }).click(); await expect(page.getByRole("button", { name: "Open review next-original-002" })).toBeVisible();
    const intake = page.locator(".receipt-intake");
    await intake.getByLabel("Evidence review store").selectOption("store"); await intake.getByLabel("Original evidence reference").fill("new-original-003"); await intake.getByLabel("Reported receipt date").fill("2026-10-14"); await intake.getByLabel("Reported amount (ZAR)").fill("100.20"); await intake.getByLabel("Investigation note").fill("Synthetic retained investigation note");
    await intake.getByRole("button", { name: "Retain evidence for review" }).click(); await expect(page.getByRole("button", { name: "Open review new-original-003" })).toBeVisible(); assert.equal(writes[0].action, "capture"); assert.equal(writes[0].source.sourceType, "MANUAL_REPORTED"); assert.match(writes[0].requestKey, /^[a-f0-9-]{36}$/);
    await page.getByRole("button", { name: "Open review test-original-001" }).click(); await expect(page.getByText("Test evidence is retained separately and cannot be matched to customer accounts here.")).toBeVisible(); await expect(page.getByRole("heading", { name: "Suggest an account" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open review bank-original-001" }).click(); await expect(page.locator(".receipt-match-detail")).toContainText("original currency requires review");
    await page.getByRole("button", { name: "Open review manual-original-001" }).click(); await page.getByLabel("Find account in this store").fill("FIXTURE"); await page.getByRole("button", { name: "Find matching accounts" }).click(); await page.getByLabel("Suggested account").selectOption("target"); await page.getByLabel("Why does this evidence suggest this account?").fill("Synthetic original reference matches this exact account"); await page.getByRole("checkbox", { name: /matching suggestion only/ }).check(); await page.getByRole("button", { name: "Save matching suggestion" }).click();
    await expect(page.getByRole("button", { name: "Record independent matching review" })).toBeDisabled();
    user = "reviewer"; await page.getByRole("button", { name: "Reload saved reviews" }).click(); await expect(page.getByRole("button", { name: "Record independent matching review" })).toBeEnabled();
    await page.getByLabel("Independent review reference").fill("synthetic-refresh-failure"); await page.getByRole("checkbox", { name: /independently checked/ }).check(); await page.getByRole("button", { name: "Record independent matching review" }).click();
    await expect(page.getByText("Saved, but the list could not refresh.", { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Record independent matching review" })).toBeDisabled();
    failedRead = false; await page.getByRole("button", { name: "Reload saved reviews" }).click(); await expect(page.locator(".receipt-match-history")).toContainText("REVIEWED");
    await page.locator(".receipt-match-history").scrollIntoViewIfNeeded(); await page.screenshot({ path: `output/unidentified-receipts/review-${width}.png`, fullPage: false });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(writes.map(item => item.action), ["capture", "propose", "review"]); assert.ok(writes.every(item => item.action !== "post" && item.execute === undefined));
    canManage = false; await page.getByRole("button", { name: "Reload saved reviews" }).click(); await expect(intake.getByRole("button", { name: "Retain evidence for review" })).toBeDisabled(); await expect(page.getByRole("heading", { name: "Suggest an account" })).toHaveCount(0);
    await page.getByLabel("Review store", { exact: true }).selectOption("other"); await expect(page.getByText("No retained evidence in this selection.")).toBeVisible(); await expect(page.getByRole("button", { name: "Open review manual-original-001" })).toHaveCount(0);
    assert.deepEqual(errors, []); await page.close(); console.log(`${width}px: evidence, exact suggestion, independent review, failure recovery, permissions, source holds and pagination passed`);
  }
} finally { await browser.close(); server.close(); }
