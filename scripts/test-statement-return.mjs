/** Actual Accounts component; invented data and intercepted requests only. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AccountStatementWorkspace} from './src/components/account-statement-workspace';createRoot(document.getElementById('root')).render(<AccountStatementWorkspace accountId="account-1" moveInReservationId="reservation-55"/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "link-stub", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: "jsx", resolveDir: process.cwd() }));
} }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(); await mkdir("output/statement-return", { recursive: true });
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const back=page.getByRole('link',{name:'← Back to move-in checks',exact:true});
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute('href','/operations/move-in?reservation=reservation-55');
  await expect(page.getByRole('link',{name:'← Back to accounts',exact:true})).toHaveAttribute('href','/operations/accounts?accountId=account-1');
  const box=await back.boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width);
  await page.screenshot({path:`output/statement-return/${width}.png`});
  await back.click(); await expect(page).toHaveURL(/\/operations\/move-in\?reservation=reservation-55$/);
  await page.close();
 }
 console.log('PASS statement return keeps selected reservation; account fallback retained at1440/390/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}