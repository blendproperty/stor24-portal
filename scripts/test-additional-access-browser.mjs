import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import assert from "node:assert/strict";

const bundle = await build({
  entryPoints: ["tests/browser/additional-access-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic",
  plugins: [{ name: "navigation-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useRouter = () => ({refresh: () => {}});", loader: "js" }));
  } }],
});
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
  res.setHeader("Content-Type", "text/html");
  res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const base = `http://127.0.0.1:${server.address().port}`, writes = [], errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/access/additional-people**", route => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMioAAAAASUVORK5CYII=", "base64") });
    writes.push(route.request().method());
    return route.fulfill({ json: { data: { ok: true } } });
  });
  await page.route("**/api/tenant/additional-access-people**", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: [] } });
    writes.push(route.request().method());
    return route.fulfill({ json: { data: { id: "test-person", name: "Second Person", status: "NOMINATED" } } });
  });
  await page.goto(base);
  await expect(page.getByText("Additional-person photo collection is unavailable", { exact: false })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.goto(base + "?policy&readonly");
  await expect(page.getByRole("button", { name: "View privately" })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.goto(base + "?policy");
  await expect(page.getByRole("button", { name: "Approve photo" })).toBeDisabled();
  await page.getByRole("button", { name: "View privately" }).click();
  await expect(page.getByRole("img", { name: "Private access photo" })).toBeVisible();
  await page.getByRole("button", { name: "Approve photo" }).click();
  await expect(page.getByText("Photo reviewed. Hikvision access is not active.")).toBeVisible();
  assert.deepEqual(writes, ["PATCH"]);
  const capture = page.locator("form").filter({ has: page.locator('input[name="image"]') });
  await capture.locator('input[name="image"]').setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await capture.getByRole("button", { name: "Capture photo" }).click();
  assert.equal(await capture.locator('input[name="consent"]').evaluate(element => element.validity.valueMissing), true);
  assert.deepEqual(writes, ["PATCH"]);
  await capture.locator('input[name="consent"]').check();
  await capture.getByRole("button", { name: "Capture photo" }).click();
  assert.equal(await capture.locator('input[name="identityConfirmed"]').evaluate(element => element.validity.valueMissing), true);
  assert.deepEqual(writes, ["PATCH"]);
  await capture.locator('input[name="identityConfirmed"]').check();
  await capture.getByRole("button", { name: "Capture photo" }).click();
  await expect(page.getByText("Photo saved for review. Access is not active.")).toBeVisible();
  assert.deepEqual(writes, ["PATCH", "POST"]);
  await page.goto(base + "?tenant");
  await page.getByLabel("Full name").fill("Second Person");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText("Second Person", { exact: false })).toBeVisible();
  assert.deepEqual(writes, ["PATCH", "POST", "POST"]);
  assert.deepEqual(errors, []);
  console.log("Additional access browser fixture: default-off, scoped controls, review and nomination passed.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
