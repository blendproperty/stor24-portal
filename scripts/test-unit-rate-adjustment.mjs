import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const type = { id: "type", facilityId: "store", name: "Self storage 9 m²", widthMetres: "3", lengthMetres: "3", areaSqMetres: "9", features: [] };
const units = ["A01", "A02"].map((number, i) => ({ id: `unit-${i}`, facilityId: "store", unitTypeId: "type", number, floor: i ? "First" : "Ground", zone: null,
  status: i ? "OCCUPIED" : "AVAILABLE", monthlyRate: i ? "1200.00" : "1000.00", taxRate: "0.15", accountId: null, unitType: type, mapElements: [] }));
const facility = { id: "store", name: "Midpoint test store", code: "SYN", closedFloors: [], maps: [], unitTypes: [type], units };
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(path => readFile(path, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {UnitInventoryWorkspace} from './src/components/unit-inventory-workspace';createRoot(document.getElementById('root')).render(<UnitInventoryWorkspace initialFacilities={${JSON.stringify([facility])}}/>);`, resolveDir: process.cwd(), loader: "jsx" },
  bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "links", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: "jsx", resolveDir: process.cwd() }));
  } }] });
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html");
  res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : req.url === "/style.css" ? css : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
await mkdir("output/unit-rate-adjustment", { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    let mode = "ok", previews = 0, writes = 0, pending;
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/facility-map?*", route => route.fulfill({ json: { data: [] } }));
    await page.route("**/api/v1/leasing/**", route => {
      const request = route.request(), body = request.postDataJSON();
      if (request.method() === "GET") return mode === "refresh-fail" ? route.abort() : route.fulfill({ json: { data: request.url().endsWith("facilities") ? [facility] : request.url().endsWith("unit-types") ? [type] : units } });
      assert.ok(request.url().endsWith("unit-rates/adjust"));
      if (body.action === "preview") previews++; else writes++;
      if (["401", "403"].includes(mode)) return route.fulfill({ status: Number(mode), json: { error: { message: "Access denied" } } });
      if (body.action === "apply" && mode === "hold") { pending = route; return; }
      if (body.action === "apply" && mode === "network") return route.abort();
      if (body.action === "apply" && mode === "stale") return route.fulfill({ status: 409, json: { error: { message: "The units or prices changed. Preview again." } } });
      const data = { facilityId: "store", areaSqMetres: body.areaSqMetres, direction: body.direction, mode: body.mode, value: body.value, previewHash: "a".repeat(64), updated: 2,
        oldTotal: "2200.00", newTotal: "2300.00", changes: units.map(unit => ({ unitId: unit.id, number: unit.number, floor: unit.floor, status: unit.status, type: type.name, oldRate: unit.monthlyRate, newRate: String(Number(unit.monthlyRate) + 50) + ".00" })),
        ...(body.action === "apply" ? { auditEventId: "audit-test" } : {}) };
      if (body.action === "apply") assert.equal(body.previewHash, "a".repeat(64));
      if (body.action === "apply" && mode === "wrong-facility") data.facilityId = "other";
      return route.fulfill({ json: mode === "malformed" ? { data: {} } : { data } });
    });
    const dialog = page.getByRole("dialog", { name: "Adjust prices by size" });
    const confirm = () => dialog.getByRole("button", { name: "Confirm 2 price changes" });
    async function open() {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole("button", { name: "Adjust prices by size", exact: true }).click();
      await dialog.getByLabel("Unit size", { exact: true }).selectOption("9");
      await dialog.getByLabel("Amount per unit (R)", { exact: true }).fill("50");
    }
    await open(); assert.equal(await confirm().count(), 0);
    const before = writes;
    await dialog.getByRole("button", { name: "Preview prices" }).click();
    await expect(confirm()).toBeVisible(); assert.equal(writes, before);
    await expect(dialog.getByText("Unit A01", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Unit A02", { exact: true })).toBeVisible();
    await page.evaluate(() => { document.body.style.minHeight = "3000px"; window.scrollTo(0, 250); });
    assert.equal(await dialog.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.top >= 0 && bounds.bottom <= innerHeight; }), true);
    await page.screenshot({ path: `output/unit-rate-adjustment/preview-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await dialog.getByLabel("Amount per unit (R)", { exact: true }).fill("60"); await expect(confirm()).toHaveCount(0);
    await dialog.getByLabel("Direction", { exact: true }).selectOption("REDUCE");
    await dialog.getByLabel("Adjustment type", { exact: true }).selectOption("PERCENT");
    await expect(dialog.getByLabel("Percentage (%)", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); assert.equal(writes, before);
    for (const failure of ["malformed", "stale", "network", "wrong-facility", "hold", "401", "403", "refresh-fail", "ok"]) {
      mode = "ok"; await open();
      if (failure === "malformed") mode = failure;
      await dialog.getByRole("button", { name: "Preview prices" }).click();
      if (failure === "malformed") { await expect(dialog.getByRole("alert")).toContainText("No prices were changed"); await expect(confirm()).toHaveCount(0); continue; }
      await expect(confirm()).toBeVisible(); mode = failure;
      if (failure === "hold") await page.clock.install();
      const count = writes;
      await confirm().evaluate(button => { button.click(); button.click(); });
      await expect.poll(() => writes).toBe(count + 1);
      if (failure === "hold") { await page.clock.fastForward(25001); await pending.abort().catch(() => {}); await page.clock.resume(); }
      if (["network", "hold", "wrong-facility"].includes(failure)) {
        await expect(dialog.getByRole("alert")).toContainText("could not confirm");
        await expect(dialog.getByRole("button", { name: "Preview prices" })).toBeDisabled();
        mode = "ok"; const current = writes; await dialog.getByRole("button", { name: "Review inventory" }).click();
        await expect(page.getByRole("button", { name: "Adjust prices by size", exact: true })).toBeDisabled(); assert.equal(writes, current);
      } else if (failure === "stale") { await expect(dialog.getByRole("alert")).toContainText("changed"); await expect(confirm()).toHaveCount(0); }
      else if (["401", "403"].includes(failure)) { await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: /Edit unit/ })).toHaveCount(0); }
      else {
        await expect(page.getByText(/2 unit prices updated for 9 m²/)).toBeVisible();
        if (failure === "ok") { await expect(dialog).toHaveCount(0); await expect(confirm()).toHaveCount(0); }
        else await expect(page.getByRole("alert")).toContainText("could not be refreshed");
      }
    }
    assert.deepEqual(errors, []); assert.ok(previews > 0); await page.close(); console.log(`PASS size price adjustment ${width}`);
  }
} finally { await browser.close(); server.close(); }
