import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {WhatsAppRetryButton} from './src/components/whatsapp-retry-button';createRoot(document.getElementById('root')).render(<WhatsAppRetryButton logId="synthetic-log"/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic" });
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(); await mkdir("output/whatsapp-retry", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    const errors = [], posts = []; let scenario = "false-success";
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/communications/retry-whatsapp", route => {
      posts.push(route.request().postDataJSON());
      if (scenario === "network") return route.abort("failed");
      if (scenario === "review") return route.fulfill({ status: 409, json: { error: "Review delivery with the provider before sending again." } });
      return route.fulfill({ status: scenario === "success" ? 202 : 200, json: { data: { ok: scenario === "success" } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("not confirmed");
    await expect(page.getByRole("button", { name: "Retry queued", exact: true })).toHaveCount(0);
    scenario = "network";
    await page.getByRole("button", { name: "Check retry" }).click();
    await expect(page.getByRole("alert")).toContainText("Confirmation was lost");
    await expect(page.getByRole("button", { name: "Check retry" })).toBeEnabled();
    scenario = "review";
    await page.getByRole("button", { name: "Check retry" }).click();
    await expect(page.getByRole("alert")).toContainText("Review delivery with the provider");
    await page.screenshot({ path: `output/whatsapp-retry/review-${width}.png`, fullPage: true });
    scenario = "success";
    await page.getByRole("button", { name: "Check retry" }).click();
    await expect(page.getByRole("button", { name: "Retry queued" })).toBeDisabled();
    assert.equal(posts.length, 4); assert.ok(posts.every(post => post.logId === "synthetic-log")); assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.close();
  }
  console.log("PASS: failed/uncertain/lost replies never show queued; same-log retry recovers; desktop/mobile controls usable.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
