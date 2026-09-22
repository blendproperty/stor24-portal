import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints:["tests/browser/identity-fixture.jsx"], bundle:true, write:false, format:"esm", jsx:"automatic" });
const fonts = `@font-face{font-family:"Satoshi Handover";src:url("/brand/Satoshi-Handover-400.woff2");font-weight:400}@font-face{font-family:"Satoshi Handover";src:url("/brand/Satoshi-Handover-700.woff2");font-weight:700}`;
const css = fonts + await readFile("src/styles/identity-review.css","utf8");
const configBundle = await build({entryPoints:["next.config.ts"],bundle:true,write:false,format:"esm",platform:"node"});
const config = (await import(`data:text/javascript;base64,${Buffer.from(configBundle.outputFiles[0].text).toString("base64")}`)).default;
const securityHeaders = (await config.headers()).find(rule=>rule.source==="/identity").headers;
assert.equal(config.experimental.proxyClientMaxBodySize,"13mb");

const server=createServer(async(req,res)=>{
 if (/^\/brand\/Satoshi-Handover-(400|700)\.woff2$/.test(req.url)) {res.setHeader("Content-Type","font/woff2");return res.end(await readFile(`public${req.url}`));}
 if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");return res.end(bundle.outputFiles[0].text);}
 for(const header of securityHeaders) res.setHeader(header.key,header.value);
 res.setHeader("Content-Type","text/html");res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#f5f4ec}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(); const page=await browser.newPage(), errors=[];page.on("pageerror",error=>errors.push(error.message));
let documents=[], writes=0;
const document={id:"synthetic",version:1,status:"AWAITING_REVIEW",documentType:"ID_CARD",pageCount:2,retentionMode:"TENANCY",expiresAt:null,erasedAt:null,reservation:{publicReference:"ST24-PREVIEW",facility:{name:"Training store"},unit:{number:"106"},customer:{firstName:"Sample",lastName:"Customer",companyName:null}}};
try {
 await page.route("**/api/v1/identity-documents**",route=>{
  if(route.request().method()==="POST"){writes++;return route.fulfill({status:409,json:{error:{message:"This document changed. Refresh before continuing."}}});}
  if(route.request().url().includes("preview=true"))return route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMioAAAAASUVORK5CYII=","base64")});
  return route.fulfill({json:{data:documents}});
 });
 await mkdir("output/identity",{recursive:true}); const base=`http://127.0.0.1:${server.address().port}`;
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByText("ID collection is on hold.")).toBeVisible();await expect(page.getByText("No documents to review")).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`output/identity/staff-held-${width}.png`,fullPage:true});
 }
 documents=[document];await page.goto(base+"?enabled");await page.getByRole("button",{name:/Sample Customer/}).click();
 await expect(page.getByRole("button",{name:"Accept document",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"Open front",exact:true}).click();await expect(page.getByRole("img")).toBeVisible();
 await expect(page.getByRole("img")).toHaveJSProperty("naturalWidth",1);
 await expect(page.getByRole("button",{name:"Accept document",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"Open back",exact:true}).click();await expect(page.getByRole("button",{name:"Accept document",exact:true})).toBeEnabled();
 await page.screenshot({path:"output/identity/staff-review-mobile.png",fullPage:true});
 await page.getByRole("button",{name:"Accept document",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByRole("img")).toHaveCount(0);assert.equal(writes,1);
 await expect(page.getByRole("button",{name:"Accept document",exact:true})).toBeDisabled();assert.deepEqual(errors,[]);
 documents=[{...document,status:"ACCEPTED",reservation:{...document.reservation,status:"CONVERTED"}}];
 await page.goto(base+"?enabled");await page.getByRole("button",{name:/Sample Customer/}).click();
 await expect(page.getByText("Retained for the tenancy. Each private view is recorded.")).toBeVisible();
 await expect(page.getByRole("button",{name:"Accept document",exact:true})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Request replacement",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Open front",exact:true}).click();await expect(page.getByRole("img")).toBeVisible();
 assert.equal(writes,1);assert.deepEqual(errors,[]);
 console.log("Identity review browser: held state, responsive bounds, private two-page preview, stale approval and cleared preview passed.");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
