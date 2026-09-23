import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints:["tests/browser/facial-photos-fixture.jsx"], bundle:true, write:false, format:"esm", jsx:"automatic", loader:{".css":"empty"}, plugins:[{name:"navigation-fixture",setup(build){build.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation",namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const useRouter = () => ({refresh: () => {}});",loader:"js"}));}}] });
const css = (await Promise.all(["src/app/globals.css","src/styles/stor24-brand.css","src/styles/tenant-portal.css","src/styles/facial-access.css"].map(path=>readFile(path,"utf8")))).join("\n").replace('@import "tailwindcss";',"");
const server=createServer(async(req,res)=>{
  if (/^\/brand\/Satoshi-Handover-(400|500|700)\.woff2$/.test(req.url)) { res.setHeader("Content-Type","font/woff2"); return res.end(await readFile(`public${req.url}`)); }
  if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");return res.end(bundle.outputFiles[0].text);}
  if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");return res.end(css);}
  res.setHeader("Content-Type","text/html");res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {});
const base=`http://127.0.0.1:${server.address().port}`, errors=[], writes=[];
let available=false, tenantPhoto=null;
const tenantWrites=[];
try {
  const page=await browser.newPage();
  await page.route("**/api/v1/access/photo-control",route=>route.fulfill({json:{data:{enabled:false,version:0,canToggle:true,storageReady:true,maintenanceReady:true,reviewStatus:"Interim � awaiting review"}}}));
  await page.goto(base);await expect(page.getByText("Photo collection disabled",{exact:true})).toBeVisible();
  await expect(page.getByText("Automatic activation from this photo queue is not connected to Hikvision yet. An approved photo does not grant gate access.",{exact:true})).toBeVisible();
  await expect(page.getByRole("switch",{name:"Photo collection"})).toHaveAttribute("aria-checked","false");
  await page.goto(base+"?readonly");await expect(page.getByRole("switch")).toHaveCount(0);await expect(page.getByText("Only the owner can change this",{exact:true})).toBeVisible();
  await page.goto(base+"?policy");await expect(page.getByText("Gate activation unavailable",{exact:true})).toBeVisible();
page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/tenant/access-photo**",route=>{
    if(route.request().method()!=="GET") { tenantWrites.push(route.request().method()); return route.fulfill({status:409,json:{error:"Your booking has changed. Please refresh before continuing."}}); }
    return route.fulfill({json:{data:{available,policy:available?{version:"ci",hash:"ci-hash",notice:"Synthetic browser fixture. This is not legal wording or a real consent record.",consentLabel:"Preview only — consent wording awaiting legal approval.",retentionHours:24,alternativeContact:"Speak to the training store."}:null,photo:tenantPhoto}}});
  });
  await page.route("**/api/v1/access/photos**",async route=>{
    if(route.request().method()==="POST") {writes.push(route.request().url());return route.fulfill({status:409,json:{error:"This photograph has changed or expired. Refresh before continuing."}});}
    return route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMioAAAAASUVORK5CYII=","base64")});
  });
  await mkdir("output/facial-access",{recursive:true});
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});await page.goto(base);await page.evaluate(()=>document.fonts.ready);
    await expect(page.getByText("No customer photographs queued")).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.equal(await page.locator(".face-steps p").first().evaluate(el=>getComputedStyle(el).fontWeight),"400");
    await page.screenshot({path:`output/facial-access/${width}.png`,fullPage:true});
  }
  await page.goto(`${base}?photo`);await expect(page.getByRole("button",{name:"Approve photo"})).toBeDisabled();
  await page.getByRole("button",{name:"View privately"}).click();await expect(page.getByRole("img")).toBeVisible();
  await page.getByRole("button",{name:"Approve photo"}).click();await expect(page.getByText("This photograph has changed or expired. Refresh before continuing.")).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);assert.equal(writes.length,1);
  await page.goto(`${base}?photo&readonly`);await expect(page.getByRole("button",{name:"View privately"})).toHaveCount(0);
  await page.goto(`${base}?tenant`);await expect(page.getByText("Your store will arrange this step with you as part of your move-in.",{exact:false})).toBeVisible();await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.screenshot({path:'output/facial-access/tenant-redesign-held.png',fullPage:true});
  available=true;await page.reload();await expect(page.locator('input[type="checkbox"]')).not.toBeChecked();
  await expect(page.locator('input[name="policyHash"]')).toHaveValue("ci-hash");
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:1000}); await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.equal(await page.locator('.face-submit').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 90, 10)');
    await page.screenshot({path:`output/facial-access/tenant-redesign-${width}.png`,fullPage:true});
  }
  await page.getByLabel('Choose your access photograph').setInputFiles({name:'training-photo.png',mimeType:'image/png',buffer:Buffer.from('fixture')});
  await expect(page.getByText('training-photo.png',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Submit photograph',exact:true}).click();
  assert.equal(await page.locator('input[name="consent"]').evaluate(el=>el.validity.valueMissing),true);
  assert.equal(tenantWrites.length,0);
  await page.getByText('How we use your photograph',{exact:true}).click();
  await expect(page.getByText('Synthetic browser fixture.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();
  await expect(page.getByText('Add your photograph',{exact:true})).toBeVisible();
  await expect(page.locator('input[type="checkbox"]')).not.toBeChecked();
  await page.getByLabel('Choose your access photograph').setInputFiles({name:'training-photo.png',mimeType:'image/png',buffer:Buffer.from('fixture')});
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button',{name:'Submit photograph',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Your booking has changed. Please refresh before continuing.');
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  assert.deepEqual(tenantWrites,['POST']);
  tenantPhoto={version:1,status:'PENDING_PROVIDER',expiresAt:'2099-10-01T12:00:00Z',erasedAt:null};
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Move-in recorded · access activation pending');
  await expect(page.getByRole('button',{name:'Withdraw consent and remove my photo'})).toBeVisible();
  assert.deepEqual(errors,[]);console.log("Facial access: desktop/mobile, empty queue, scoped controls, private preview, stale review and legal hold passed.");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
