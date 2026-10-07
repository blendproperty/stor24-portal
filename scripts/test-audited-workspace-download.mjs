import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const built = await build({ stdin: { contents: `import {auditedCsvDownload} from './src/lib/audited-csv-download';document.querySelector('button').onclick=async()=>{try{await auditedCsvDownload({kind:'marketing',rows:[['Campaign','Spend'],['Synthetic',2]],filename:'synthetic.csv'});document.querySelector('p').textContent='Prepared';}catch(e){document.querySelector('p').textContent=e.message;}};`, resolveDir: process.cwd(), loader: "js" }, bundle: true, write: false, format: "esm" });
const server = createServer((req,res) => { res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html");res.end(req.url === "/app.js" ? built.outputFiles[0].text : '<html><meta name="viewport" content="width=device-width,initial-scale=1"><button>Export CSV</button><p role="status"></p><script type="module" src="/app.js"></script></html>'); });
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch();
try {
  for (const width of [1440,390,320]) {
    const page = await browser.newPage({viewport:{width,height:800}});let allowed=false,downloads=0;
    page.on("download",()=>downloads++);
    await page.route("**/api/v1/reports/csv",async route=>{
      assert.equal(route.request().method(),"POST");assert.equal(route.request().postDataJSON().kind,"marketing");
      return route.fulfill(allowed ? {status:200,contentType:"text/csv",body:'"Campaign","Spend"\r\n"Synthetic","2"'} : {status:403,json:{error:{code:"PERSONAL_EXPORT_FORBIDDEN"}}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button",{name:"Export CSV"}).click();await expect(page.getByRole("status")).toContainText("Super Admin");assert.equal(downloads,0);
    allowed=true;const event=page.waitForEvent("download");await page.getByRole("button",{name:"Export CSV"}).click();const file=await event;
    assert.equal(file.suggestedFilename(),"synthetic.csv");assert.equal(await readFile(await file.path(),"utf8"),'"Campaign","Spend"\r\n"Synthetic","2"');assert.equal(downloads,1);await page.close();
  }
  console.log("PASS: workspace CSV helper waits for server authorisation, blocks denied downloads, and releases exact approved bytes at1440/390/320.");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
