/** Actual staff password form; local synthetic requests only. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ChangePasswordForm} from './src/components/change-password-form';createRoot(document.getElementById('root')).render(<section className="panel panel-spacious"><h2>Account password</h2><ChangePasswordForm/></section>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "navigation-fixture", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/link") ? "import React from 'react';export default function Link(p){return React.createElement('a',p)}" : "export const useRouter=()=>({replace:href=>{window.__destination=href},refresh:()=>{}});", loader: "jsx", resolveDir: process.cwd() }));
} }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const font = await readFile("public/brand/Satoshi-Variable.ttf");
const server = createServer((req, res) => {
  if (req.url === "/font.ttf") { res.setHeader("content-type", "font/ttf"); res.end(font); return; }
  res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:SatoshiFixture;src:url(/font.ttf)}:root{--font-satoshi:SatoshiFixture}${css}</style></head><body class="app-shell" style="display:block"><div class="content" id="root"></div><script type="module" src="/app.js"></script></body></html>`);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch();
await mkdir("output/password-form-recovery", { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; let mode = "network", requests = 0, pending;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/change-password", async route => {
      requests++;
      if (mode === "network") return route.abort("failed");
      if (mode === "timeout") { pending = route; return; }
      if (mode === "invalid-json") return route.fulfill({ status: 502, contentType: "text/html", body: "upstream unavailable" });
      if (mode === "missing-confirmation") return route.fulfill({ json: { data: {} } });
      if (mode === "validation") return route.fulfill({ status: 422, json: { error: "Synthetic password rejected." } });
      if (mode === "revoked") return route.fulfill({ status: 401, json: { error: "Your account changed. Sign in again." } });
      return route.fulfill({ json: { data: { changed: true } } });
    });
    const open = async () => { await page.goto(`http://127.0.0.1:${server.address().port}`); };
    const fill = async (confirmation = "New-Synthetic-Password-2026!") => {
      await page.getByLabel("Current password", { exact: true }).fill("Old-Synthetic-Password-2026!");
      await page.getByLabel("New password", { exact: true }).fill("New-Synthetic-Password-2026!");
      await page.getByLabel("Confirm new password", { exact: true }).fill(confirmation);
    };
    for (mode of ["network", "invalid-json", "missing-confirmation"]) {
      await open(); await fill(); const before = requests;
      await page.getByRole("button", { name: "Change password", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("could not confirm");
      await expect(page.getByRole("alert")).toBeFocused();
      await expect(page.getByRole("button", { name: "Change password", exact: true })).toBeDisabled();
      await expect(page.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
      assert.equal(requests, before + 1);
      assert.equal(await page.evaluate(() => window.__destination), undefined);
    }
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.screenshot({ path: `output/password-form-recovery/recovery-${width}.png`, fullPage: true });
    mode = "timeout"; await open(); await page.clock.install(); await fill();
    const beforeTimeout = requests;
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect.poll(() => requests).toBe(beforeTimeout + 1);
    await page.clock.fastForward(21_000);
    await expect(page.getByRole("alert")).toContainText("could not confirm");
    assert.equal(requests, beforeTimeout + 1); await pending.abort().catch(() => {});
    mode = "validation"; await open(); await fill("Different-Synthetic-Password-2026!");
    const beforeMismatch = requests;
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("do not match"); assert.equal(requests, beforeMismatch);
    await fill(); await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Synthetic password rejected");
    await expect(page.getByRole("button", { name: "Change password", exact: true })).toBeEnabled();
    mode = "revoked"; await fill(); await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Sign in again");
    await expect(page.getByRole("link", { name: "Go to sign in" })).toBeVisible();
    mode = "success"; await open(); await fill();
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__destination)).toBe("/login?password=changed");
    assert.deepEqual(errors, []); await page.close();
  }
  console.log("PASS: actual password form network/timeout/uncertain/revoked/validation/success at 1440, 390 and 320px; no repeated writes or page errors.");
} finally { await browser.close(); await new Promise(r => server.close(r)); }
