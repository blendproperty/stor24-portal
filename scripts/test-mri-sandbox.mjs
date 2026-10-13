import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints: ["tests/browser/mri-sandbox-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic" });
const css = await readFile("src/styles/mri-mapping.css", "utf8");
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
  res.setHeader("content-type", "text/html"); res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f4f6f8;font-family:Arial,sans-serif}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
let canManage = true, fail = false;
let workspace = { sourceRevision: "2026-10-13T07:00:00.000Z", storedTestAvailable: true, target: "BlendTest", postingEnabled: false, configuration: { revision: null, credentialsStored: false, environment: "test", databaseLabel: "BlendTest", authenticated: false, databaseReadable: false, checkedAt: null, propertyCount: null, failureCode: null } };
const commands = [];
try {
  const page = await browser.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/v1/billing/mri/sandbox", async route => {
    const command = route.request().postDataJSON();
    if (command) {
      commands.push(command);
      if (command.action === "prepare") workspace.configuration = { ...workspace.configuration, revision: "2026-10-13T07:01:00.000Z", credentialsStored: true };
      if (command.action === "check") workspace.configuration = { ...workspace.configuration, revision: "2026-10-13T07:02:00.000Z", authenticated: !fail, databaseReadable: !fail, checkedAt: "2026-10-13T07:02:00.000Z", propertyCount: fail ? null : 0, failureCode: fail ? "MRI_SANDBOX_TARGET" : "MRI_JOURNAL_NOT_ENABLED" };
    }
    await route.fulfill({ json: { ...workspace, canManage } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole("heading", { name: "MRI sandbox testing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run sandbox check" })).toBeDisabled();
  await page.getByRole("button", { name: "Use stored test connection", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Separate sandbox settings saved");
  await page.getByRole("button", { name: "Run sandbox check" }).click();
  await expect(page.getByText("Sandbox read access verified", { exact: true })).toBeVisible();
  await expect(page.getByText("MRI returned no accessible properties", { exact: false })).toBeVisible();
  await expect(page.getByText("Journal submission is not available yet.", { exact: true })).toBeVisible();
  await mkdir("output/mri-sandbox", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    await page.screenshot({ path: `output/mri-sandbox/${width}.png`, fullPage: true });
  }
  fail = true; await page.getByRole("button", { name: "Run sandbox check" }).click();
  await expect(page.getByText("Sandbox read access verified", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Current MRI discovery did not verify", { exact: false })).toBeVisible();
  canManage = false; await page.reload();
  await expect(page.getByRole("button", { name: "Run sandbox check" })).toHaveCount(0);
  assert.deepEqual(commands.map(c => c.action), ["prepare", "check", "check"]); assert.deepEqual(errors, []);
  console.log("MRI sandbox browser checks passed: separate preparation/check, zero-property blocker, stale-proof clearing, read-only and 1440/390/320 layouts. Provider responses are fixtures.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
