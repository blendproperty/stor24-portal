import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
const compiled=await build({entryPoints:['tests/browser/rent-review-fixture.jsx'],bundle:true,write:false,format:'esm',jsx:'automatic'});
const styled=await postcss([tailwindcss()]).process(await readFile('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')});
const css=styled.css+(await readFile('src/styles/stor24-brand.css','utf8'))+'\n:root{--font-satoshi:Arial}.table-wrap{max-width:100%;overflow-x:auto}';
const row={id:'fixture',unit:'101',unitType:'Synthetic 5m2',areaSqMetres:5,sizeOccupiedCount:2,sizeUnitCount:3,sizeOccupancyPercent:66.67,standardRate:1200,varianceAmount:-200,variancePercent:-16.67,reviewStatus:'PENDING',reviewReason:null,reviewUpdatedAt:null,customer:'Invented test customer',account:'TEST-ONLY',start:'2025-01-01',daysInUnit:642,lastPriceChange:null,daysSincePriceChange:null,currentRate:1000,currency:'ZAR',schedule:null};
let approvals=0,fail=false,mode='ok',rows=[],calls=[];
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type','text/html');if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');return res.end(compiled.outputFiles[0].text);}
 if(req.url.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');if(fail){res.statusCode=403;return res.end(JSON.stringify({error:{message:'Current owner access is required'}}));}
  let text='';for await(const part of req)text+=part;const body=text?JSON.parse(text):null;if(body)calls.push(body);
  if(req.url==='/api/v1/reports/csv'){assert.equal(body.kind,'rent-review');assert.ok(body.rows[0].includes('Size occupancy %'));res.setHeader('Content-Type','text/csv');return res.end('Unit,Current rent\n101,1000');}
  if(mode==='stale'&&body?.action==='approve'){res.statusCode=409;return res.end(JSON.stringify({error:{message:'rent preview changed'}}));}
  if(body?.action==='approve'){assert.deepEqual(body.input.selectedOccupancyIds,['fixture']);assert.equal(body.noticeConfirmed,true);assert.equal(body.fingerprint,'a'.repeat(64));approvals++;return res.end(JSON.stringify({data:{approvedCount:1,effectivePeriod:'2027-01'}}));}
  if(body?.action==='review-status'){assert.equal(body.input.reason,'Synthetic manager exception');const r=rows.find(r=>r.id===body.input.occupancyId);r.reviewStatus=body.input.status;r.reviewReason=body.input.reason;r.reviewUpdatedAt='2026-10-30T00:00:00.000Z';return res.end(JSON.stringify({data:{status:r.reviewStatus}}));}
  const preview=body?.action==='preview';const data=rows.map(r=>({...r,...(preview?{eligible:r.reviewStatus==='PENDING'&&r.currency==='ZAR',newRate:r.reviewStatus==='PENDING'&&r.currency==='ZAR'?1050:null,reason:r.reviewStatus==='DISMISSED'?'Dismissed from review':null,selected:body.input.selectedOccupancyIds.includes(r.id)}:{})}));
  return res.end(JSON.stringify({data:{today:'2026-10-30',rows:data,history:[],...(preview?{fingerprint:'a'.repeat(64),eligibleCount:data.filter(r=>r.eligible).length,selectedCount:data.filter(r=>r.eligible&&r.selected).length}:{})}}));
 }
 res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});await mkdir('output/rent-reviews',{recursive:true});
try{for(const width of [1440,390,320]){
 approvals=0;fail=false;mode='ok';calls=[];rows=[{...row},{...row,id:'unselected',unit:'102',customer:'Other synthetic customer'},{...row,id:'currency-review',unit:'103',customer:'Synthetic currency exception',currency:'INVALID',areaSqMetres:null,sizeOccupancyPercent:null}];
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'View duration report'}).click();await expect(page.getByRole('cell',{name:/66.67%/})).toHaveCount(2);await expect(page.getByLabel('Include unit 101',{exact:true})).toBeDisabled();await expect(page.getByText('1000.00 (currency requires review)',{exact:false})).toBeVisible();
 await page.getByLabel('Effective month',{exact:true}).fill('2027-01');await expect(page.getByRole('button',{name:'Download CSV'})).toHaveCount(0);
 await page.getByRole('button',{name:'Preview group increase'}).click();const approve=page.getByRole('button',{name:'Approve scheduled increase'});await expect(approve).toBeDisabled();
 await page.getByLabel('Include unit 101',{exact:true}).check();await expect(page.getByText('Selection changed. Refresh the preview before approval.',{exact:true})).toBeVisible();await expect(approve).toBeDisabled();
 await page.getByRole('button',{name:'Preview group increase'}).click();await expect(page.getByText('1 selected eligible units in the current preview.',{exact:true})).toBeVisible();await page.getByLabel('Approval / notice reference').fill('Invented approval');await page.getByLabel('I confirm the required notice and pricing approval for the explicitly selected tenants.',{exact:true}).check();await expect(approve).toBeEnabled();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV'}).click();assert.equal((await download).suggestedFilename(),'stor24-rent-review.csv');
 await page.screenshot({path:`output/rent-reviews/preview-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await approve.click();await expect(page.getByRole('status')).toContainText('1 selected rent changes scheduled');assert.equal(approvals,1);
 await page.getByRole('button',{name:'View duration report'}).click();await page.getByRole('button',{name:'Dismiss unit 101',exact:true}).click();await page.getByLabel('Review status reason').fill('Synthetic manager exception');await page.getByRole('button',{name:'Save review status'}).click();await expect(page.getByRole('status')).toContainText('Review status saved');
 await page.getByRole('button',{name:'View duration report'}).click();await expect(page.getByLabel('Review view',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Dismiss unit 101',exact:true})).toHaveCount(0);await page.getByLabel('Review view',{exact:true}).selectOption('DISMISSED');await expect(page.getByText('Synthetic manager exception',{exact:true})).toBeVisible();await expect(page.getByLabel('Include unit 101',{exact:true})).toBeDisabled();
 await page.screenshot({path:`output/rent-reviews/dismissed-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Restore unit 101',exact:true}).click();await page.getByLabel('Review status reason').fill('Synthetic manager exception');await page.getByRole('button',{name:'Save review status'}).click();await expect(page.getByRole('status')).toContainText('Review status saved');
 await page.getByRole('button',{name:'View duration report'}).click();await page.getByLabel('Review view',{exact:true}).selectOption('PENDING');await page.getByRole('button',{name:'Preview group increase'}).click();await page.getByLabel('Include unit 101',{exact:true}).check();await page.getByRole('button',{name:'Preview group increase'}).click();await expect(approve).toBeDisabled();await page.getByLabel('Approval / notice reference').fill('Invented approval');await page.getByLabel('I confirm the required notice and pricing approval for the explicitly selected tenants.',{exact:true}).check();
 mode='stale';await approve.click();await expect(page.getByRole('alert')).toContainText('rent preview changed');await expect(approve).toHaveCount(0);assert.equal(approvals,1);
 mode='ok';await page.getByRole('button',{name:'View duration report'}).click();await expect(page.getByRole('table')).toBeVisible();fail=true;await page.getByRole('button',{name:'View duration report'}).click();await expect(page.getByRole('alert')).toContainText('Current owner access');await expect(page.getByRole('table')).toHaveCount(0);assert.deepEqual(errors,[]);await page.close();console.log(`Rent review real component ${width}px: explicit selection/refresh, one-row approval, protected CSV, dismiss/restore, stale and revoked-read recovery passed.`);
}}catch(error){for(const context of browser.contexts())for(const page of context.pages()){console.log(await page.locator('body').innerText());await page.screenshot({path:'output/rent-reviews/failed.png',fullPage:true});}throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
