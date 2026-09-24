/** Actual Accounts component; invented data and intercepted requests only. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AccountsWorkspace} from './src/components/accounts-workspace';createRoot(document.getElementById('root')).render(<AccountsWorkspace initialAccountId="account-1"/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "link-stub", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: "jsx", resolveDir: process.cwd() }));
} }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(); await mkdir("output/account-payment-retry", { recursive: true });
const data = { facilities: [], accounts: [{ id: "account-1", accountNumber: "SYNTHETIC", balance: "1000", currency: "ZAR", customer: { firstName: "Synthetic", lastName: "Customer" }, tenancy: { id: "tenancy", status: "ACTIVE", facilityId: "facility", facility: { name: "Test store" }, documents: [], occupancies: [] }, ledgerEntries: [], payments: [] }] };
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const posts = [], errors = []; let loseResponse = true;
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/v1/accounts", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { data } });
      posts.push(route.request().postDataJSON());
      if (loseResponse) { loseResponse = false; return route.abort("failed"); }
      return route.fulfill({ status: 200, json: { data: { idempotent: true, notificationReviewRequired: true } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Take payment", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount", { exact: true }).fill("100");
    await dialog.locator('input[name="reference"]').fill("SYNTHETIC-RECEIPT");
    await dialog.getByRole("button", { name: "Post payment", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Retry this same form");
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("100");
    await expect(dialog.locator('input[name="reference"]')).toHaveValue("SYNTHETIC-RECEIPT");
    await expect(dialog.getByRole("button", { name: "Post payment", exact: true })).toBeEnabled();
    await page.screenshot({ path: `output/account-payment-retry/retry-${width}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Post payment", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Payment recorded. Its notification needs review in Communications.")).toBeVisible();
    assert.deepEqual(posts[0], posts[1]); assert.match(posts[0].requestId, /^[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Take payment", exact: true }).click();
    await dialog.getByRole("button", { name: "Post payment", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    assert.notEqual(posts[2].requestId, posts[0].requestId);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: lost-response retry retains payment fields and request ID; new form gets a new ID; desktop/mobile notification review visible.");
} finally { await browser.close(); await new Promise(r => server.close(r)); }

