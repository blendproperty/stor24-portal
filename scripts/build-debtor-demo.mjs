/** Portable, offline preview of the real Accounts component. No database/config loaded. */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const output = resolve("output/faeez-debtor-demo");
await mkdir(output, { recursive: true });
const bundle = await build({
  entryPoints: ["tests/browser/debtor-demo-fixture.jsx"], bundle: true, write: false,
  format: "iife", jsx: "automatic", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "offline-link", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: "preview" }));
    builder.onLoad({ filter: /.*/, namespace: "preview" }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: "jsx", resolveDir: process.cwd() }));
  } }],
});
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(file => readFile(file, "utf8")))).join("\n").replaceAll('@import "tailwindcss";', "");
const previewCss = `body{margin:0;font-family:Arial,sans-serif;background:#f5f6f8}.demo-container{max-width:1400px;padding:24px;margin:auto}.demo-banner{background:#fff5e9;border:2px solid #ff6c02;border-radius:14px;padding:20px;margin-bottom:24px;color:#222}.demo-banner p{line-height:1.5}.demo-banner label{display:block;font-weight:bold;margin-bottom:8px}.demo-banner select{max-width:100%;width:100%;padding:12px;background:white;color:#222;border:1px solid #777;border-radius:8px;font-size:15px}.account-actions,.page-header a{display:none!important}.account-balance strong{white-space:nowrap}.demo-container .data-table{min-width:600px}@media(max-width:600px){.demo-container{padding:12px}.demo-banner{padding:14px}.demo-container .account-detail .panel-heading{flex-wrap:wrap;gap:18px}.demo-container .account-balance{align-items:flex-start;text-align:left}}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>STOR24 · Test customer outstanding balance demonstration</title><style>${css}\n${previewCss}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
const file = resolve(output, "STOR24-Test-Customer-Balance.html");
await writeFile(file, html);
console.log(`Created ${file}`);

if (process.argv.includes("--verify")) {
  const { chromium, expect } = await import("@playwright/test");
  const browser = await chromium.launch();
  const evidence = [];
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      const errors = [], network = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
      await page.goto(pathToFileURL(file).href);
      const formatted = await page.evaluate(() => Object.fromEntries([0, 400, 600, 1000].map(value => [value, `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`])));
      for (const [scenario, due, paid] of [["partial", 600, 400], ["unpaid", 1000, null], ["settled", 0, 1000]]) {
        await page.getByLabel("Choose a balance scenario").selectOption(scenario);
        const details = page.getByRole("article", { name: "Selected account details" });
        await expect(details.getByRole("heading", { name: "Test Customer", exact: true })).toBeVisible();
        await expect(details.locator(".account-balance strong")).toHaveText(formatted[due]);
        await expect(details.locator(".account-balance")).toContainText(scenario === "settled" ? "No amount due" : "Amount due");
        await expect(details.getByRole("row").filter({ hasText: "Demonstration rental charge" })).toContainText(formatted[1000]);
        const receipt = details.getByRole("row").filter({ hasText: "Illustrative payment" });
        if (paid) await expect(receipt).toContainText(`− ${formatted[paid]}`); else await expect(receipt).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Take payment", exact: true })).not.toBeVisible();
        await page.screenshot({ path: resolve(output, `${scenario}-${width}.png`), fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow: ${scenario}/${width}`);
        evidence.push({ width, scenario, displayedDue: formatted[due], result: "PASS" });
      }
      const denied = await page.evaluate(async () => ({ post: (await fetch("/api/v1/accounts", { method: "POST" })).status, external: (await fetch("https://example.invalid/")).status }));
      assert.deepEqual(denied, { post: 403, external: 403 });
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      await page.close();
    }
    await writeFile(resolve(output, "verification.json"), JSON.stringify({ date: "2026-10-16", scope: "Offline display fixture; no database or production validation", cases: evidence, mutationRequests: "rejected", externalRequests: 0, browserErrors: 0 }, null, 2));
    console.log("PASS: six balance/status/ledger/viewport cases; writes rejected; zero external requests or browser errors.");
  } finally { await browser.close(); }
}
