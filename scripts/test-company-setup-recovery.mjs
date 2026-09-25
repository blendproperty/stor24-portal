/** Actual Company setup component; invented configuration and intercepted requests only. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyWorkspace} from './src/components/company-workspace';createRoot(document.getElementById('root')).render(<CompanyWorkspace/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "link-stub", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: "jsx", resolveDir: process.cwd() }));
} }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const font = await readFile("public/brand/Satoshi-Variable.ttf");
const server = createServer((req, res) => { if (req.url === "/font.ttf") { res.setHeader("content-type", "font/ttf"); res.end(font); return; } res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:SatoshiFixture;src:url(/font.ttf)}:root{--font-satoshi:SatoshiFixture}${css}</style></head><body class="app-shell" style="display:block"><div class="content" id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(); await mkdir("output/company-setup-recovery", { recursive: true });
const facility = { id: "facility-1", name: "Synthetic store", code: "SYNTHETIC", timezone: "Africa/Johannesburg", active: true, publicSlug: "synthetic", publicBookingEnabled: false };
const data = { profiles: [{ id: "profile", facilityId: facility.id, domain: "STORE_INFORMATION", name: "Default", status: "READY", config: { officeWeekdayClosed: false, dbaName: "Original store", address1: "Synthetic address", province: "Gauteng", city: "Randburg", postalCode: "2194", country: "South Africa" } }], integrations: [], facilities: [facility], roles: [], users: [] };
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], writes = []; let mode = "initial-failure", reads = 0;
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/v1/configuration", async route => {
      if (route.request().method() === "GET") {
        reads++;
        if (mode === "initial-failure" || mode === "reload-failure") return route.abort("failed");
        return route.fulfill({ json: { data } });
      }
      writes.push(route.request().postDataJSON());
      if (mode === "save-failure") return route.abort("failed");
      return route.fulfill({ json: { data: { id: "profile" } } });
    });
    await page.route("**/api/v1/leasing/facilities", async route => {
      writes.push(route.request().postDataJSON());
      if (mode === "add-failure") return route.abort("failed");
      if (mode === "partial" && "publicSlug" in route.request().postDataJSON().data) return route.fulfill({ status: 422, json: { error: { message: "Synthetic public address rejected" } } });
      return route.fulfill({ json: { data: { id: "facility-2", name: "New synthetic store" } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole("alert")).toContainText("could not be loaded");
    mode = "ok"; await page.getByRole("button", { name: "Refresh setup", exact: true }).click();
    await expect(page.getByLabel("Store name (DBA)")).toHaveValue("Original store");
    mode = "save-failure";
    await page.getByLabel("Store name (DBA)").fill("Keep this edited name");
    await page.getByRole("button", { name: "Save setup", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not confirm");
    await expect(page.getByRole("button", { name: "Save setup", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Store name (DBA)")).toHaveValue("Keep this edited name");
    await expect(page.getByRole("alert")).toBeFocused();
    assert.equal(writes.length, 1);
    mode = "partial"; writes.length = 0;
    await page.getByRole("button", { name: "Save setup", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Store details saved");
    await expect(page.getByRole("alert")).toContainText("Synthetic public address rejected");
    assert.equal(writes.length, 2); assert.ok(!writes.some(x => x.data && "publicBookingEnabled" in x.data));
    await expect(page.getByLabel("Store name (DBA)")).toHaveValue("Keep this edited name");
    mode = "ok"; await page.getByRole("button", { name: "Refresh setup", exact: true }).click();
    await expect(page.getByLabel("Store name (DBA)")).toHaveValue("Original store");
    writes.length = 0;
    await page.getByRole("button", { name: "Save setup", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Store setup saved.");
    await expect(page.getByRole("button", { name: "Save setup", exact: true })).toBeEnabled();
    assert.equal(writes.length, 3); assert.equal(writes[2].data.publicBookingEnabled, false);
    mode = "save-failure";
    await page.getByRole("button", { name: /Program defaults/ }).click();
    await page.getByRole("button", { name: "Save program defaults", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not confirm");
    await expect(page.getByRole("button", { name: "Save program defaults", exact: true })).toBeEnabled();
    const availability = page.getByRole("note", { name: "Settings availability" });
    await expect(availability).toContainText("Planning preferences");
    await page.getByRole("tab", { name: "Move Out", exact: true }).click();
    await expect(availability).toContainText("Date rules are connected");
    await page.getByLabel("Maximum backdating days (blank or 0 = unlimited)").fill("5");
    await page.getByRole("tab", { name: "Refunds", exact: true }).click();
    await expect(availability).toContainText("Refund limits are connected");
    await page.getByRole("tab", { name: "Move In", exact: true }).click();
    await expect(availability).toContainText("company authorisation");
    await page.getByRole("tab", { name: "Daily Close", exact: true }).click();
    await expect(availability).toContainText("not connected to operational workflows");
    await page.getByRole("tab", { name: "Move Out", exact: true }).click();
    await expect(page.getByLabel("Maximum backdating days (blank or 0 = unlimited)")).toHaveValue("5");
    await page.screenshot({ path: `output/company-setup-recovery/settings-availability-${width}.png`, fullPage: true });
    mode = "reload-failure";
    await page.getByRole("button", { name: "Save program defaults", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Setup saved");
    await expect(page.getByRole("alert")).toContainText("could not be loaded");
    mode = "ok"; await page.getByRole("button", { name: "Refresh setup", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Add store", exact: true }).click();
    const form = page.locator(".add-store-form");
    await form.getByLabel("Store name", { exact: true }).fill("New synthetic store");
    await form.getByLabel("Store code", { exact: true }).fill("SYNTHETIC-NEW");
    mode = "add-failure";
    await form.getByRole("button", { name: "Add store", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Refresh setup before adding it again");
    await expect(form.getByLabel("Store name", { exact: true })).toHaveValue("New synthetic store");
    await expect(form.getByRole("button", { name: "Add store", exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `output/company-setup-recovery/recovery-${width}.png`, fullPage: true });
    assert.ok(reads >= 4); assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: company setup load, save, partial-save and add-store failures recover without losing fields or automatic repeated mutations; desktop/mobile.");
} finally { await browser.close(); await new Promise(r => server.close(r)); }
