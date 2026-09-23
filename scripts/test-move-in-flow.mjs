import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints: ["tests/browser/move-in-flow-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "actions", setup(b) {
  b.onResolve({ filter: /^@\/app\/actions\// }, args => ({path: args.path, namespace: "actions"}));
  b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({contents: "export async function confirmReservationMoveInAction(){throw new Error('Unexpected handover')} export async function recordReservationPaymentAction(){throw new Error('Unexpected payment')}"}));
} }] });
const css = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/staff-workspace.css"].map(p => readFile(p,"utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server=createServer(async(req,res)=>{ if(/^\/brand\/Satoshi-Handover-(400|500|700)\.woff2$/.test(req.url)){res.setHeader("content-type","font/woff2");return res.end(await readFile(`public${req.url}`));} if(req.url==="/fixture.js"){res.setHeader("content-type","text/javascript");return res.end(bundle.outputFiles[0].text);}res.setHeader("content-type","text/html");res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:16px}.app-shell{display:block}main{max-width:1400px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(); const base=`http://127.0.0.1:${server.address().port}`;
await mkdir("output/move-in-flow",{recursive:true});
try {
 for(const width of [1440,768,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[],writes=[];
  page.on("pageerror",e=>errors.push(e.message)); page.on("request",r=>{if(r.method()!=="GET")writes.push(r.url());});
  await page.goto(base+"?mode=held");
  const nav=page.getByRole("navigation",{name:"Move-in progress"});
  await expect(nav.locator("li")).toHaveCount(6); await expect(nav.locator(".is-complete")).toHaveCount(2);
  await expect(nav.locator(".is-blocked")).toHaveCount(3);
  await expect(nav.locator(".is-action")).toHaveCount(1);
  await expect(page.getByRole("link",{name:"Review ID",exact:true})).toHaveCSS("background-color","rgb(255, 90, 10)");
  await expect(page.getByText("Go to ID check",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Your signed agreement stays on file.",{exact:true})).toHaveCount(0);
  await expect(nav).toContainText("Test payment only"); await expect(nav).toContainText("Collection on hold");
  await expect(page.getByRole("link",{name:"Open customer photo capture"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Confirm move-in / key handover",exact:true})).toBeDisabled();
  for(const [name,target] of [["Agreement Signed","agreement"],["Payment Test payment only","payment"],["Check ID Awaiting review","identity"],["Access photo Collection on hold","photo"],["Hand over keys Checks outstanding","keys"]]) {
   await nav.getByRole("link",{name:new RegExp(name.split(" ").slice(0,target === "identity" ? 2 : target === "photo" ? 2 : target === "keys" ? 3 : 1).join(" "))}).focus(); await page.keyboard.press("Enter");
   await expect(page).toHaveURL(base+"?mode=held#move-in-"+target);
  }
  await expect(page.getByRole("link",{name:"Review ID",exact:true})).toHaveAttribute("href","/identity?reservation=booking-55");
  await expect(page.getByRole("link",{name:"Review access photo",exact:true})).toHaveAttribute("href","/access?reservation=booking-55");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator(".handover-receipt summary").click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator(".handover-receipt summary").click();
  await page.goto(base+"?mode=held"); await page.screenshot({path:`output/move-in-flow/pending-${width}.png`,fullPage:true});
  await page.goto(base+"?mode=reviewed"); await expect(nav.locator(".is-complete")).toHaveCount(5);
  await expect(page.getByRole("button",{name:"Confirm move-in / key handover",exact:true})).toBeDisabled();
  await page.goto(base+"?mode=complete"); await expect(nav.locator(".is-complete")).toHaveCount(6);
  await expect(page.getByRole("heading",{name:"Keys handed over — confirmation saved",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Confirm move-in / key handover",exact:true})).toHaveCount(0);
  await expect(page.getByText("Photo capture and review do not confirm that Hikvision access is active.")).toBeVisible();
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await page.close();
 }
 console.log("PASS six stages, saved completion evidence, keyboard links, ID/photo booking scope, policy hold, future-date guard, read-only handover confirmation, no writes/errors and 1440/768/390/320px bounds");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
