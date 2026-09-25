/** Actual login component; synthetic login/MFA/setup responses, no external navigation. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PortalAuthForm} from './src/components/portal-auth-form';const setup=new URLSearchParams(location.search).has('setup');createRoot(document.getElementById('root')).render(<PortalAuthForm {...(setup?{mode:'setup',token:'synthetic-only'}:{mode:'login'})}/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "navigation-fixture", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/link") ? "import React from 'react';export default function Link(p){return React.createElement('a',p)}" : "export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({replace:href=>{window.__destination=href;window.__origin=new URL(href,location.href).origin},refresh:()=>{}});", loader: "jsx", resolveDir: process.cwd() }));
} }] });
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : '<html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
try {
  for (const mode of ["password", "mfa", "setup"]) {
    const page = await browser.newPage(), errors = []; let reject = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/auth/**", route => reject ? route.fulfill({ status: 401, json: { error: "Synthetic authentication rejected" } }) : route.fulfill({ json: { data: mode === "mfa" && route.request().url().endsWith("/login") ? { mfaRequired: true } : { name: "Synthetic" } } }));
    for (const [next, expected] of [["//outside.example.invalid/path", "/"], ["/\\outside.example.invalid", "/"], ["/\t/outside.example.invalid", "/"], ["/\n/outside.example.invalid", "/"], ["/a/..//outside.example.invalid", "/"], ["https://outside.example.invalid", "/"], ["/operations/move-in?reservation=synthetic#checks", "/operations/move-in?reservation=synthetic#checks"]]) {
      const query = new URLSearchParams({ next, ...(mode === "setup" ? { setup: "1" } : {}) });
      await page.goto(`${origin}/login?${query}`);
      if (mode === "setup") await page.getByLabel("Full name").fill("Synthetic Staff");
      await page.getByLabel("Work email").fill("staff@example.invalid");
      await page.getByLabel("Password", { exact: true }).fill("Synthetic-Password-2026!");
      await page.getByRole("button", { name: mode === "setup" ? "Create owner account" : "Sign in to portal" }).click();
      if (mode === "mfa") { await page.getByLabel("Verification code").fill("123456"); await page.getByRole("button", { name: "Verify and sign in" }).click(); }
      await expect.poll(() => page.evaluate(() => window.__destination)).toBe(mode === "setup" ? "/" : expected);
      assert.equal(await page.evaluate(() => window.__origin), origin);
    }
    reject = true;
    await page.goto(`${origin}/login?next=%2Fcustomers${mode === "setup" ? "&setup=1" : ""}`);
    if (mode === "setup") await page.getByLabel("Full name").fill("Synthetic Staff");
    await page.getByLabel("Work email").fill("staff@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("Synthetic-Password-2026!");
    await page.getByRole("button", { name: mode === "setup" ? "Create owner account" : "Sign in to portal" }).click();
    await expect(page.getByRole("alert")).toContainText("Synthetic authentication rejected");
    assert.equal(await page.evaluate(() => window.__destination), undefined);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log("PASS: actual password/MFA/setup component rejects external and normalized redirect variants; local query/hash destination preserved.");
} finally { await browser.close(); await new Promise(r => server.close(r)); }
