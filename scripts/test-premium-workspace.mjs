/** Real client components with isolated fixtures. No production access or writes. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const catalogueBundle = await build({ entryPoints: ["src/lib/guided-help.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { workflowGuides } = await import(`data:text/javascript;base64,${Buffer.from(catalogueBundle.outputFiles[0].text).toString("base64")}`);
const accessBundle = await build({ entryPoints: ["src/lib/guided-help-access.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { catalogueForAssignments } = await import(`data:text/javascript;base64,${Buffer.from(accessBundle.outputFiles[0].text).toString("base64")}`);
let guidePersona = [{facilityId: null, role: {name: "Organisation owner", permissions: ["*"]}}];
let guideAccessDenied = false;
const navigation = `import React, {useSyncExternalStore} from 'react';
const subscribe = cb => { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb); };
const read = () => window.location.pathname + window.location.search;
export const usePathname = () => useSyncExternalStore(subscribe, read, () => '/').split('?')[0];
export const useRouter = () => ({push(href) { history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, replace(href) { history.replaceState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, refresh() {}});
export const Link = ({href, children, ...props}) => React.createElement('a', {...props, href, onClick: e => {e.preventDefault(); history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate'));}}, children);
export const Image = ({unoptimized, priority, ...props}) => React.createElement('img', props);`;
const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/browser/guided-help-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "isolated-fixture", setup(b) {
  b.onResolve({filter: /^next\/(navigation|link|image)$/}, args => ({path: args.path, namespace: "fixture"}));
  b.onLoad({filter: /.*/, namespace: "fixture"}, args => ({contents: navigation + (args.path === "next/link" ? "\nexport default Link;" : args.path === "next/image" ? "\nexport default Image;" : ""), loader: "jsx", resolveDir: root}));
  b.onResolve({filter: /^@\/app\/actions\//}, args => ({path: args.path, namespace: "actions"}));
  b.onLoad({filter: /.*/, namespace: "actions"}, () => ({contents: "export async function confirmReservationMoveInAction() { throw new Error('Unexpected handover'); } export async function recordReservationPaymentAction() { throw new Error('Unexpected payment'); }"}));
} }] });
const style = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/guided-help.css", "src/styles/identity-review.css", "src/styles/staff-workspace.css"].map(file => readFile(file, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const customer = { id: "fixture-customer", firstName: "Example", lastName: "Customer", companyName: null, email: "fixture@example.invalid", phone: null };
const unit = {id: "fixture-unit", facilityId: "fixture-store", number: "T01", monthlyRate: "1200", unitType: {name: "Training unit", areaSqMetres: "9"}};
const data = { facilities: [{id: "fixture-store", name: "Training store", units: [unit]}], customers: [customer], reservations: [{id: "fixture-reservation", status: "ACTIVE", quotedRate: "1200", holdExpiresAt: "2026-09-30T12:00:00Z", intendedMoveIn: "2026-09-30T12:00:00Z", createdAt: "2026-09-21T12:00:00Z", facility: {id: "fixture-store", name: "Training store"}, customer, unit, lead: null, convertedTenancy: null}] };
const writes = [];
const server = createServer(async (req, res) => {
  if (req.method !== "GET") { writes.push(`${req.method} ${req.url}`); res.writeHead(405); res.end(); return; }
  const url = new URL(req.url, "http://localhost");
  if (["/offline-workspace.html", "/offline-workspace.css", "/offline-workspace.js", "/offline-guided-help.js", "/offline-guided-help.css"].includes(url.pathname)) {
    res.setHeader("content-type", url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".css") ? "text/css" : "text/html");
    res.end(await readFile(path.join(root, "public", url.pathname))); return;
  }
  if (url.pathname === "/api/v1/offline/snapshot") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: { facilities: [{id: "fixture-store", name: "Training facility with a deliberately long location name", code: "LONG-TRAINING-STORE"}] } })); return; }
  if (url.pathname === "/api/v1/guided-help") {
    res.setHeader("content-type", "application/json");
    if (guideAccessDenied) { res.writeHead(401); res.end(JSON.stringify({error: "UNAUTHENTICATED"})); return; }
    res.end(JSON.stringify({data: catalogueForAssignments(guidePersona)})); return;
  }
  if (url.pathname === "/api/auth/mfa") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({data:{enabled:true,recoveryCodesRemaining:8}})); return; }
  if (url.pathname === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/fixture.css") { res.setHeader("content-type", "text/css"); res.end(style); return; }
  if (url.pathname === "/api/v1/reservations") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({data})); return; }
  if (url.pathname.startsWith("/brand/")) {
    try { res.setHeader("content-type", url.pathname.endsWith(".svg") ? "image/svg+xml" : "font/ttf"); res.end(await readFile(path.join(root, "public", url.pathname))); }
    catch { res.writeHead(404); res.end(); } return;
  }
  res.setHeader("content-type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>@font-face{font-family:Satoshi;src:url(/brand/Satoshi-Variable.ttf)}body{--font-satoshi:Satoshi}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

if (process.env.PREVIEW_ONLY) {
 console.log(`Preview ready: ${base}`);
} else {
 const browser = await chromium.launch();
 try {
  await mkdir('output/premium-workspace',{recursive:true});
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  for (const width of [1440, 1024, 768, 390, 320]) {
   await page.setViewportSize({width,height:900});
   await page.goto(base + '/operations/move-in?inventory');
   await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
   assert.equal(await page.locator('.unit-table tbody tr').count(),20);
   const next = page.getByRole('button',{name:'Next',exact:true});
   const bounds = await next.boundingBox(); assert.ok(bounds.y>=0 && bounds.y+bounds.height<=900);
   await page.getByRole('radio',{name:'Select unit 1',exact:true}).check();
   await expect(next).toBeEnabled();
   await page.getByRole('button',{name:'Next page',exact:true}).click();
   await expect(page.getByRole('radio',{name:'Select unit 21',exact:true})).toBeVisible();
   await expect(page.locator('.move-in-selection')).toContainText('Unit 1');
   await page.getByRole('textbox',{name:'Find unit number',exact:true}).fill('530');
   await expect(page.getByRole('radio',{name:'Select unit 530',exact:true})).toBeVisible();
   await page.getByRole('radio',{name:'Select unit 530',exact:true}).check();
   await expect(page.locator('.move-in-selection')).toContainText('Unit 530');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`move-in overflow ${width}`);
   await page.screenshot({path:`output/premium-workspace/move-in-${width}.png`,fullPage:true});
   await next.click(); await expect(page.getByRole('button',{name:'Send lease for signature'})).toBeVisible();
   await page.goto(base+'/settings');
   await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
   if(width<=760) {
    await page.locator('.staff-mobile-nav summary').click();
    await expect(page.getByRole('navigation',{name:'Mobile navigation'})).toBeVisible();
    await page.locator('.staff-mobile-nav summary').click();
   }
   await mkdir('output/premium-workspace',{recursive:true});
   await page.screenshot({path:`output/premium-workspace/settings-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'A little space for good'}).click();
   await expect(page.getByRole('heading',{name:'Small settings. Big peace of mind.'})).toBeVisible();
   await page.keyboard.press('Escape');
   await expect(page.getByRole('button',{name:'A little space for good'})).toBeFocused();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`settings overflow ${width}`);
  }
  assert.deepEqual(errors,[]);
  console.log('Premium workspace passed: 530-unit pagination, persistent Next, selection through filters, account step, settings, contextual tip/Escape and 1440/1024/768/390/320px bounds.');
 } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
