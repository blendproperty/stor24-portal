import {build} from "esbuild";
import {chromium,expect} from "@playwright/test";
import {createServer} from "node:http";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const bundle=await build({entryPoints:["tests/browser/legacy-handover-fixture.jsx"],bundle:true,write:false,format:"esm",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"actions",setup(b){b.onResolve({filter:/^@\/app\/actions\/leasing$/},()=>({path:"actions",namespace:"test"}));b.onLoad({filter:/^actions$/,namespace:"test"},()=>({contents:"export async function confirmLegacyHandoverAction() { return {error:'Synthetic only'}; }",loader:"js"}));b.onResolve({filter:/^next\/image$/},()=>({path:"image",namespace:"test"}));b.onLoad({filter:/^image$/,namespace:"test"},()=>({contents:"import React from 'react'; export default function Image({unoptimized,...props}) { return React.createElement('img',props); }",loader:"js",resolveDir:process.cwd()}));}}]});
const css=readFileSync("src/styles/legacy-handover.css","utf8");
const server=createServer((req,res)=>{if(req.url==="/fixture.js"){res.setHeader("content-type","text/javascript");return res.end(bundle.outputFiles[0].text);}if(req.url==="/legacy.css"){res.setHeader("content-type","text/css");return res.end(css);}res.setHeader("content-type","text/html");res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/legacy.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),base=`http://127.0.0.1:${server.address().port}`,writes=[];
try{
  const page=await browser.newPage();page.on("pageerror",error=>console.error("PAGE ERROR",error.message));
  const pixel=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMioAAAAASUVORK5CYII=","base64");
  await page.route("**/api/v1/access/legacy-photo**",route=>route.fulfill({contentType:"image/png",body:pixel}));
  await page.route("**/api/v1/access/legacy-trial-photo**",route=>{writes.push(route.request().method());return route.fulfill({contentType:"image/png",body:pixel});});
  await page.route("**/api/v1/access/legacy-photo/handoff",route=>{const body=JSON.parse(route.request().postData()??"{}");assert.deepEqual(body,{tenancyId:"ci-lease",version:0,identityConfirmed:true});writes.push("HANDOFF");return route.fulfill({json:{data:{token:"a".repeat(43),expiresAt:"2099-01-01T12:00:00Z"}}});});
  await page.goto(base+"?staff");await expect(page.locator('input[type="file"]')).toHaveCount(0);await expect(page.getByRole("button",{name:"Prepare customer photo screen"})).toHaveCount(0);await page.getByRole("button",{name:"Open photo for review"}).click();await expect(page.getByRole("button",{name:"Approve photo"})).toBeEnabled();
  await page.setViewportSize({width:820,height:900});await page.goto(base+"?staff-trial");await expect(page.getByRole("heading",{name:"Customer photo on the Counter tablet"})).toBeVisible();await expect(page.locator('input[type="file"]')).toHaveCount(0);await page.getByRole("button",{name:"Prepare customer photo screen"}).click();assert.deepEqual(writes,[]);await page.locator('.legacy-photo-handoff input[type="checkbox"]').check();await page.getByRole("button",{name:"Prepare customer photo screen"}).click();await expect(page.getByRole("img",{name:"Scan to open the customer-only photo screen"})).toBeVisible();assert.deepEqual(writes,["HANDOFF"]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto(base+"?staff-trial-saved");await expect(page.getByText("Photo saved for private staff review.",{exact:false})).toBeVisible();await expect(page.getByRole("button",{name:"Prepare customer photo screen"})).toHaveCount(0);await page.getByRole("button",{name:"Open photo for review"}).click();await expect(page.getByRole("button",{name:"Approve photo"})).toBeEnabled();assert.deepEqual(writes,["HANDOFF","GET"]);
  console.log("Legacy handover: staff-only controls, Counter QR, identity check and private review passed; no production writes.");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
