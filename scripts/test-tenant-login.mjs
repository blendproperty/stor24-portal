// Actual login component with intercepted synthetic APIs: no email delivery.
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle=await build({entryPoints:["tests/browser/tenant-login-fixture.jsx"],bundle:true,define:{"process.env":"{}"},write:false,loader:{".css":"empty"},format:"esm",jsx:"automatic"});
const css=await readFile("src/styles/tenant-portal.css","utf8");
const server=createServer(async(req,res)=>{
 if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");return res.end(bundle.outputFiles[0].text);}
 const url=new URL(req.url,"http://localhost");
 const asset=url.pathname==="/_next/image" ? url.searchParams.get("url") : url.pathname;
 if(asset?.startsWith("/brand/") && !asset.includes("..")){try{res.setHeader("Content-Type",asset.endsWith(".svg")?"image/svg+xml":"image/png");return res.end(await readFile(`public${asset}`));}catch{res.statusCode=404;return res.end();}}

 res.setHeader("Content-Type","text/html");res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${css}.tenant-email-help{margin:0;font-size:13px;color:#52615b}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch();await mkdir("output/email-prefill",{recursive:true});
try {
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}), starts=[], errors=[];
  page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
  await page.route("**/api/**",route=>{
   if(route.request().url().endsWith("/auth/start")){starts.push(route.request().postDataJSON());return route.fulfill({json:{message:"Synthetic only"}});}
   assert.equal(route.request().method(),"GET");
   return route.fulfill({status:401,json:{error:"Sign in"}});
  });
  const base=`http://127.0.0.1:${server.address().port}/my?booking=ST24-PREVIEW&step=access-photo`;
  await page.goto(base+"#email=person%2Bbooking%40example.invalid");
  const input=page.getByLabel("Email on your STOR24 account");
  await expect(input).toHaveValue("person+booking@example.invalid");await expect(input).toBeEditable();
  assert.equal(page.url(),base);assert.equal(starts.length,0);
  await page.screenshot({path:`output/email-prefill/login-${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await input.fill("changed@example.invalid");await page.getByRole("button",{name:"Email me a sign-in code"}).click();
  await expect(input).toBeDisabled();assert.equal(starts[0].email,"changed@example.invalid");
  await page.getByLabel("Your six-digit code").fill("123456");
  await page.getByRole("button",{name:"Use another email / request a new code"}).click();
  await expect(input).toBeEditable();await expect(page.getByLabel("Your six-digit code")).toHaveCount(0);
  await input.fill("second@example.invalid");await page.getByRole("button",{name:"Email me a sign-in code"}).click();
  await expect(page.getByLabel("Your six-digit code")).toHaveValue("");assert.equal(starts[1].email,"second@example.invalid");
  await page.goto(base+"&case=invalid#email=invalid");await expect(input).toHaveValue("");assert.equal(page.url(),base+"&case=invalid");
  await page.goto(base);await expect(input).toHaveValue("");assert.equal(starts.length,2);assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log("PASS desktop/mobile: editable prefill, fragment removed, no automatic OTP, changed email payload, code reset, invalid/no hint and no overflow");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
