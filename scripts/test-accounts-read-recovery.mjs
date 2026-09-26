/** Actual Accounts component; invented data and intercepted requests only. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AccountsWorkspace} from './src/components/accounts-workspace';createRoot(document.getElementById('root')).render(<AccountsWorkspace initialAccountId="account-1"/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "link-stub", setup(b) {
  b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: "jsx", resolveDir: process.cwd() }));
} }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(); await mkdir("output/accounts-read-recovery", { recursive: true });
const data = { facilities: [], accounts: [{ id: "account-1", accountNumber: "SYNTHETIC", balance: "1000", currency: "ZAR", customer: { firstName: "Synthetic", lastName: "Customer" }, tenancy: { id: "tenancy", status: "ACTIVE", facilityId: "facility", facility: { name: "Test store" }, documents: [], occupancies: [] }, ledgerEntries: [], payments: [] }] };
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let mode='network',reads=0,posts=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/accounts',async route=>{
   if(route.request().method()==='POST'){posts++;mode='500';return route.fulfill({status:201,json:{data:{notificationReviewRequired:false}}});}
   assert.equal(route.request().method(),'GET');reads++;
   if(mode==='network')return route.abort();if(mode==='hold')return;
   if(mode==='malformed')return route.fulfill({body:'{',contentType:'application/json'});
   if(mode==='shape')return route.fulfill({json:{data:{accounts:[{}],facilities:[]}}});
   if(mode==='nested'){const broken=structuredClone(data);broken.accounts[0].tenancy.occupancies=[{unit:null}];return route.fulfill({json:{data:broken}});}
   if(mode==='empty')return route.fulfill({json:{data:{accounts:[],facilities:[]}}});
   if(mode==='success')return route.fulfill({json:{data}});
   return route.fulfill({status:Number(mode),json:{error:{message:'Synthetic read failure'}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const reload=page.getByRole('button',{name:'Reload accounts',exact:true});
  await expect(page.getByRole('alert')).toContainText('could not be loaded');await expect(reload).toBeEnabled();await expect(page.getByText('No accounts found.')).toHaveCount(0);
  for(const failure of ['500','malformed','shape','nested']){mode=failure;await reload.click();await expect(page.getByRole('alert')).toContainText('could not be loaded');await expect(reload).toBeEnabled();await expect(page.getByRole('button',{name:'Take payment',exact:true})).toHaveCount(0);}
  mode='hold';await page.clock.install();const before=reads;await reload.click();await expect(page.getByRole('button',{name:'Loading accounts…'})).toBeDisabled();await page.clock.fastForward(21000);await expect(reload).toBeEnabled();await expect(page.getByRole('alert')).toContainText('could not be loaded');assert.equal(reads,before+1);
  mode='empty';await reload.click();await expect(page.getByText('No accounts found.')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  mode='success';await reload.click();await page.getByRole('button',{name:/Open account SYNTHETIC/}).click();await expect(page.getByRole('button',{name:'Take payment',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  mode='403';await reload.click();await expect(page.getByRole('alert')).toContainText('administrator');await expect(page.getByRole('button',{name:'Take payment',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:/Open account SYNTHETIC/})).toHaveCount(0);await expect(page.getByText('R 1,000.00',{exact:true})).toHaveCount(0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`output/accounts-read-recovery/${width}-denied.png`,fullPage:true});
  mode='401';await reload.click();await expect(page.getByRole('alert')).toContainText('Sign in again');await expect(page.getByRole('link',{name:'Sign in again'})).toHaveAttribute('href','/login?next=%2Faccounts');
  mode='success';await page.reload();await expect(page.getByRole('button',{name:'Take payment',exact:true})).toBeVisible();await page.getByRole('button',{name:'Take payment',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Amount',{exact:true}).fill('100');await dialog.getByRole('button',{name:'Post payment',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('alert')).toContainText('could not be loaded');assert.equal(posts,1);
  mode='success';await reload.click();await expect(page.getByRole('button',{name:'Take payment',exact:true})).toBeVisible();assert.equal(posts,1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: accounts initial/refresh failure, malformed/nested payloads, timeout, empty data,401/403 hidden data, recovery and confirmed payment followed by GET-only refresh recovery at1440/390/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
