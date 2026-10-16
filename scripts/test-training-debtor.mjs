import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const initial = { canCreate: true, facilities: [{ id: "midpoint", name: "Store 1 - Midpoint" }], rows: [] };
const saved = { ...initial, rows: [{ version: 1, trainingOnly: true, customerId: "test-customer", facilityId: "midpoint", reference: "TRAINING-DEBTOR-001", chargedCents: 100000, illustrativePaidCents: 40000, outstandingCents: 60000, name: "TEST Faeez debtor training", facility: "Store 1 - Midpoint", createdAt: "2026-10-16T10:00:00Z" }] };
const source = `import React from 'react';import {createRoot} from 'react-dom/client';import {TrainingDebtorWorkspace} from './src/components/training-debtor-workspace';createRoot(document.getElementById('root')).render(<TrainingDebtorWorkspace initial={${JSON.stringify(initial)}}/>);`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "link-stub", setup(b) { b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "fixture" })); b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: "jsx", resolveDir: process.cwd() })); } }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replaceAll('@import "tailwindcss";', "");
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="padding:20px"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(); await mkdir("output/training-debtor", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } }); let mode = "lost-create", posts = 0; const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/training/debtors", async route => {
      if (route.request().method() === "POST") { posts++; assert.deepEqual(route.request().postDataJSON(), { facilityId: "midpoint" }); if (mode === "lost-create") return route.abort(); }
      return mode === "denied" ? route.fulfill({ status: 403, json: { error: {} } }) : route.fulfill({ json: { data: saved } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Create or open test customer" }).click();
    await expect(page.getByRole("alert")).toContainText("could not be confirmed");
    await expect(page.getByRole("button", { name: "Create or open test customer" })).toBeDisabled();
    mode = "saved"; await page.getByRole("button", { name: "Refresh training balances" }).click();
    await expect(page.getByRole("heading", { name: "TEST Faeez debtor training" })).toBeVisible();
    await expect(page.getByText("Amount due · training", { exact: true })).toBeVisible();
    const due = page.locator(".summary-cell").filter({ hasText: "Outstanding training balance" });
    await expect(due).toContainText(/600[,.]00/);
    await expect(page.getByRole("link", { name: "Open test customer profile" })).toHaveAttribute("href", "/tenants?customer=test-customer");
    assert.equal(posts, 1); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `output/training-debtor/${width}.png`, fullPage: true });
    mode = "denied"; await page.getByRole("button", { name: "Refresh training balances" }).click();
    await expect(page.getByRole("alert")).toContainText("could not be loaded");
    await expect(page.getByRole("heading", { name: "TEST Faeez debtor training" })).toHaveCount(0);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log("PASS training debtor UI: uncertain-create recovery, refresh without replay, saved balance/status/profile link, denied refresh clears data, desktop/mobile bounds.");
} finally { await browser.close(); await new Promise(r => server.close(r)); }
