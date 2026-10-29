/** Actual staff shell with synthetic responses; no database or provider access. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = process.cwd();
const navigation = `import React from 'react';
export const usePathname=()=>'/';
export const useRouter=()=>({replace:path=>{window.__destination=path},refresh:()=>{window.__refreshed=true}});
export const Link=({children,...props})=>React.createElement('a',props,children);
export const Image=({priority,unoptimized,...props})=>React.createElement('img',props);`;
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AppShell} from './src/components/app-shell';createRoot(document.getElementById('root')).render(<AppShell session={{userId:'synthetic',name:'Synthetic',email:'staff@example.invalid',role:'Organisation owner',sessionVersion:1}} access={{owner:true,permissions:['*']}}><p>Synthetic workspace</p></AppShell>);`, resolveDir: root, loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "isolated-shell", setup(b) {
  b.onResolve({ filter: /^next\/(navigation|link|image)$/ }, a => ({ path: a.path, namespace: "navigation" }));
  b.onLoad({ filter: /.*/, namespace: "navigation" }, a => ({ contents: navigation + (a.path === "next/link" ? "export default Link;" : a.path === "next/image" ? "export default Image;" : ""), resolveDir: root }));
  b.onResolve({ filter: /^@\/components\/(connectivity-status|brand-corner|guided-help)$/ }, a => ({ path: a.path, namespace: "static" }));
  b.onLoad({ filter: /.*/, namespace: "static" }, () => ({ contents: "export const ConnectivityStatus=()=>null,BrandCorner=()=>null,GuidedHelp=()=>null;" }));
} }] });
const style = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(file => readFile(file, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server = createServer((request, response) => {
  if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
  response.setHeader("content-type", "text/html");
  response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style><div id="root"></div><script type="module" src="/bundle.js"></script>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  let mode = 500;
  await page.route("**/api/auth/logout", route => mode === "network" ? route.abort() : route.fulfill({ status: mode, contentType: "application/json", body: JSON.stringify(mode === 200 ? { data: { signedOut: true } } : { error: { code: "SYNTHETIC_FAILURE" } }) }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (mode of [500, 403, "network", 401, 200]) {
      await page.goto(origin);
      await page.getByRole("button", { name: "Sign out on all devices", exact: true }).click();
      if (mode === 200 || mode === 401) {
        await expect.poll(() => page.evaluate(() => window.__destination)).toBe("/login");
        assert.equal(await page.evaluate(() => window.__refreshed), true);
      } else {
        await expect(page.getByRole("alert")).toContainText("Could not sign out");
        assert.equal(await page.evaluate(() => window.__destination), undefined);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      }
    }
  }
  console.log("Staff sign-out: 10 desktop/mobile success, expired-session and failure cases passed.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
