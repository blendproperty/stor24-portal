/** Actual inventory component, synthetic API only. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const unitType = { id: "type", facilityId: "midpoint", name: "Small storage", widthMetres: "2", lengthMetres: "3", areaSqMetres: "6", features: [] };
let closedFloors = ["first floor", "second floor"];
let failure = false;
let writes = 0;
const fixture = () => [{ id: "midpoint", name: "Midpoint", code: "MID", closedFloors, maps: ["Ground Floor", "First Floor", "Second Floor"].map(name => ({ name })), unitTypes: [unitType], units: ["Ground Floor", "First Floor", "Second Floor"].map((floor, index) => ({ id: `unit-${index}`, facilityId: "midpoint", unitTypeId: "type", number: `${index + 1}`, floor, zone: null, status: "AVAILABLE", monthlyRate: "600", taxRate: "0.15", accountId: null, unitType })) }];
const bundle = await build({ absWorkingDir: root, stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {UnitInventoryWorkspace} from './src/components/unit-inventory-workspace'; const facilities = await fetch('/fixture-data').then(r=>r.json()); createRoot(document.getElementById('root')).render(<main className="page-stack"><UnitInventoryWorkspace initialFacilities={facilities}/></main>);`, resolveDir: root, loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "next-link-fixture", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react'; export default function Link(props) { return React.createElement('a', props); }", loader: "jsx", resolveDir: root }));
} }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(file => readFile(file, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/fixture.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/fixture.css") { response.setHeader("content-type", "text/css"); response.end(css); return; }
  if (url.pathname === "/fixture-data") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(fixture())); return; }
  if (url.pathname === "/api/v1/floor-availability") {
    let body = ""; for await (const chunk of request) body += chunk;
    const input = JSON.parse(body); writes++;
    assert.equal(input.facilityId, "midpoint"); assert.equal(typeof input.expectedOperational, "boolean");
    response.setHeader("content-type", "application/json");
    if (failure) { response.writeHead(403); response.end(JSON.stringify({ error: { message: "You do not have permission to change this floor." } })); return; }
    closedFloors = closedFloors.filter(floor => floor !== input.floor); if (!input.operational) closedFloors.push(input.floor);
    response.end(JSON.stringify({ data: { closedFloors } })); return;
  }
  if (url.pathname.startsWith("/brand/")) { try { response.end(await readFile(path.join(root, "public", url.pathname))); } catch { response.writeHead(404); response.end(); } return; }
  response.setHeader("content-type", "text/html");
  response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>@font-face{font-family:Satoshi;font-weight:100 900;src:url(/brand/Satoshi-Variable.ttf)}body{font-family:Satoshi\ Handover,Arial,sans-serif;margin:0;padding:16px}main{max-width:1300px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
await mkdir("output/floor-availability", { recursive: true });
try {
  const page = await browser.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole("switch", { name: "Ground Floor operational" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "First Floor operational" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: "Second Floor operational" })).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".summary-cell").filter({ hasText: /^Available/ }).locator("strong")).toHaveText("1");
    const section = page.getByRole("region", { name: "Floor availability" });
    const bounds = await section.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.evaluate(() => document.fonts.ready);
    await section.screenshot({ path: `output/floor-availability/${width}.png` });
  }
  await page.locator(".inventory-toolbar select").nth(2).selectOption("AVAILABLE");
  await expect(page.locator(".data-table tbody tr")).toHaveCount(1);
  await page.locator(".inventory-toolbar select").nth(2).selectOption("UNDER_CONSTRUCTION");
  await expect(page.locator(".data-table tbody tr")).toHaveCount(2);
  await page.locator(".inventory-toolbar select").nth(2).selectOption("");
  const first = page.getByRole("switch", { name: "First Floor operational" });
  await first.focus(); await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".summary-cell").filter({ hasText: /^Available/ }).locator("strong")).toHaveText("2");
  await page.reload(); await expect(first).toHaveAttribute("aria-checked", "true");
  await first.click(); await expect(first).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: "Ground Floor operational" })).toHaveAttribute("aria-checked", "true");
  failure = true; await first.click();
  await expect(page.getByRole("alert")).toContainText("permission"); await expect(first).toHaveAttribute("aria-checked", "false");
  assert.equal(writes, 3); assert.deepEqual(errors, []);
  console.log("PASS: inventory floor switches, counts, independent floors, persistence, keyboard, denied-save state, 1440/390/320px. Synthetic API only.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
