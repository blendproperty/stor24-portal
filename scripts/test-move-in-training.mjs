import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import assert from "node:assert/strict";
const bundle=await build({entryPoints:["tests/browser/move-in-training-fixture.jsx"],bundle:true,write:false,format:"esm",jsx:"automatic"});
const css=(await Promise.all(["src/app/globals.css","src/styles/stor24-brand.css","src/styles/staff-workspace.css"].map(p=>readFile(p,"utf8")))).join("\n").replace('@import "tailwindcss";','');
const sample=await sharp({create:{width:240,height:320,channels:3,background:"#ff5a0a"}}).png().toBuffer();
const server=createServer(async(req,res)=>{if(req.url==="/fixture.js"){res.setHeader("content-type","text/javascript");return res.end(bundle.outputFiles[0].text);}if(req.url==="/sample.png"){res.setHeader("content-type","image/png");return res.end(sample);}if(/^\/brand\/Satoshi-Handover-(400|500|700)\.woff2$/.test(req.url)){return res.end(await readFile(`public${req.url}`));}res.setHeader("content-type","text/html");res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--font-satoshi:"Satoshi Handover"}.app-shell{display:block;padding:16px;max-width:1200px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const browser=await chromium.launch();const base=`http://127.0.0.1:${server.address().port}`;await mkdir("output/training",{recursive:true});
try{
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(base+"?enabled=false");await expect(page.getByRole("switch",{name:"Enable manager training"})).not.toBeChecked();await page.getByRole("switch",{name:"Enable manager training"}).click();await expect(page.getByRole("switch",{name:"Enable manager training"})).toBeChecked();
  await page.getByRole("link",{name:"Start training",exact:true}).click();
  await page.getByRole("button",{name:"Create my demo booking"}).click();
  await page.getByRole("button",{name:"Demo unit 01 · R100.00"}).click();await page.getByRole("button",{name:"Confirm demo agreement signed"}).click();
  await page.getByRole("spinbutton",{name:"Test payment amount"}).fill("0.02");await page.getByRole("button",{name:"Record test payment"}).click();
  await page.getByRole("button",{name:"Check ID To do",exact:true}).click();await expect(page.getByRole("button",{name:"Confirm demo ID checked"})).toBeDisabled();
  await page.getByRole("button",{name:"Payment To do",exact:true}).click();await page.getByRole("spinbutton",{name:"Test payment amount"}).fill("99.98");await page.getByRole("button",{name:"Record test payment"}).click();await page.getByRole("button",{name:"Confirm demo ID checked"}).click();
  await page.getByLabel("Upload supplied sample").setInputFiles({name:"sample.png",mimeType:"image/png",buffer:sample});await page.getByRole("button",{name:"Open sample for review"}).click();await page.getByRole("button",{name:"Request replacement"}).click();
  await page.getByLabel("Upload supplied sample").setInputFiles({name:"sample.png",mimeType:"image/png",buffer:sample});await page.getByRole("button",{name:"Open sample for review"}).click();await page.getByRole("button",{name:"Approve training photo"}).click();
  await page.getByRole("checkbox",{name:"I am confirming a training key handover only."}).check();await page.getByRole("button",{name:"Record training handover"}).click();await expect(page.getByRole("heading",{name:"Training handover complete"})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`output/training/complete-${width}.png`,fullPage:true});
  await page.getByRole("switch",{name:"Enable manager training"}).click();await expect(page.getByRole("switch",{name:"Enable manager training"})).not.toBeChecked();await page.goto(base+"?enabled=false");await expect(page.getByRole("heading",{name:"Training is switched off"})).toBeVisible();
  await page.goto(base+"?role=manager");await expect(page.getByRole("switch")).toHaveCount(0);await expect(page.getByRole("link",{name:"Start training",exact:true})).toBeVisible();assert.deepEqual(errors,[]);await page.close();
 }
 console.log("PASS owner toggle, manager read-only availability, partial-payment block, sample replacement/approval, saved demo handover and 1440/390/320px bounds");
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
