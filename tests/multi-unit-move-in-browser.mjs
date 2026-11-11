import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MultiUnitMoveIn} from './src/components/multi-unit-move-in';createRoot(document.getElementById('root')).render(<MultiUnitMoveIn facilities={[{id:'f',name:'Store'}]} units={[{id:'u1',facilityId:'f',number:'101',rate:1000,type:'Storage'},{id:'u2',facilityId:'f',number:'102',rate:2000,type:'Storage'}]} customers={[{id:'c',name:'Test customer',email:'test@example.invalid'}]}/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic" });
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : '<div id="root"></div><script type="module" src="/app.js"></script>'); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const requests = [];
    await page.route("**/api/v1/move-in-batch", async route => { const payload = route.request().postDataJSON(); requests.push(payload); if (requests.length === 1) return route.abort(); return route.fulfill({ json: { data: { documents: payload.units.map((u, i) => ({ unitId: u.unitId, unitNumber: `${101 + i}`, documentId: `doc${i}`, accountId: `acc${i}` })) } } }); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel(/101 ·/).check(); await page.getByLabel(/102 ·/).check();
    await page.getByRole("button", { name: "Review 2 selected units" }).click();
    await page.locator("form select").first().selectOption("c"); await page.locator("form select").nth(1).selectOption("EFT");
    await page.locator("fieldset").nth(1).getByLabel("Monthly rent").fill("1900");
    await page.getByLabel(/I have reviewed/).check();
    await page.getByRole("button", { name: "Confirm and save all units" }).click();
    await expect(page.getByRole("heading", { name: "Review save status" })).toBeVisible();
    await page.reload(); await expect(page.getByRole("button", { name: "Retry / recover saved batch" })).toBeVisible();
    await page.getByRole("button", { name: "Retry / recover saved batch" }).click();
    await expect(page.getByRole("heading", { name: "Units saved for agreement signing" })).toBeVisible();
    assert.deepEqual(requests[0], requests[1]); assert.equal(requests[0].units[1].monthlyRate, 1900);
    assert.equal(await page.getByRole("link", { name: "Open agreement" }).count(), 2);
    await page.close();
  }
  console.log("PASS multi-unit review, uncertain save and identical recovery at 1440/390/320");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
