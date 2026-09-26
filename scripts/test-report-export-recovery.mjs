import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ReportsWorkspace} from './src/components/reports-workspace';createRoot(document.getElementById('root')).render(<ReportsWorkspace reports={[{key:'unit-availability',name:'Current availability',group:'Operations',description:'Current',permission:'reports.view',formats:['CSV','JSON']},{key:'lead-conversion',name:'Synthetic leads',group:'Operations',description:'Synthetic report',permission:'reports.view',formats:['CSV','JSON']},{key:'receivables-ageing',name:'Receivables ageing',group:'Finance',description:'Synthetic ageing',permission:'reports.financial',formats:['CSV','JSON']}]} facilities={[{id:'a',name:'Synthetic facility'}]} initialFrom='2026-09-01' initialTo='2026-09-26' canExport={!location.search.includes('denied')}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();await mkdir('output/report-export-recovery',{recursive:true});
try {
 for(const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let mode='success',reads=0,downloads=0;const csv='"unit","status"\r\n"SYN-01","AVAILABLE"';
  page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>downloads++);
  await page.route('**/api/v1/reports/export?*',async route=>{
   assert.equal(route.request().method(),'GET');reads++;const url=new URL(route.request().url());assert.equal(url.searchParams.get('facilityId'),'a');if(url.searchParams.get('reportKey')==='receivables-ageing'){assert.equal(url.searchParams.get('from'),'2020-02-02');assert.equal(url.searchParams.get('to'),'2020-02-02');}
   if(mode==='network')return route.abort();if(mode==='hold')return;
   if(mode==='success'||mode==='empty')return route.fulfill({contentType:'text/csv; charset=utf-8',body:mode==='empty'?'':csv});
   if(mode==='html')return route.fulfill({contentType:'text/html',body:'<h1>Sign in</h1>'});
   if(mode==='malformed')return route.fulfill({status:500,contentType:'application/json',body:'{'});
   return route.fulfill({status:Number(mode),json:{error:{message:'Check the report parameters.'}}});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  const open=async(query='')=>{await page.goto(base+query);await page.getByLabel(/^Report/).selectOption('lead-conversion');await page.getByLabel(/^Facility/).selectOption('a');};
  const button=page.getByRole('button',{name:'Export CSV',exact:true});
  await open();await page.getByLabel('From',{exact:true}).fill('2026-10-01');await button.click();await expect(page.getByRole('alert')).toContainText('valid date range');assert.equal(reads,0);await page.getByLabel('From',{exact:true}).fill('2026-09-01');
  for(const failure of ['422','500','malformed','html','network']) {
   mode=failure;await button.click();await expect(page.getByRole('alert')).toBeVisible();await expect(button).toBeEnabled();await expect(page.getByLabel('From',{exact:true})).toHaveValue('2026-09-01');await expect(page.getByLabel(/^Facility/)).toHaveValue('a');assert.equal(page.url(),base+'/');assert.equal(downloads,0);
  }
  mode='hold';await page.clock.install();const before=reads;await button.click();await expect(page.getByRole('button',{name:'Preparing CSV'})).toBeDisabled();await expect(page.getByLabel('From',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Preparing CSV'}).evaluate(b=>{b.click();b.click();});await page.clock.fastForward(31000);await expect(button).toBeEnabled();await expect(page.getByRole('alert')).toContainText('try again');assert.equal(reads,before+1);
  mode='empty';await button.click();await expect(page.getByRole('status')).toContainText('No rows matched');assert.equal(downloads,0);
  mode='success';const downloadEvent=page.waitForEvent('download');await button.click();const download=await downloadEvent;assert.equal(download.suggestedFilename(),'stor24-lead-conversion-2026-09-01-2026-09-26.csv');assert.equal(await readFile(await download.path(),'utf8'),csv);await expect(page.getByRole('status')).toContainText('download prepared');assert.equal(downloads,1);
  await page.getByLabel(/^Report/).selectOption('receivables-ageing');await expect(page.getByLabel('From',{exact:true})).toHaveCount(0);await expect(page.getByText(/Ageing uses all account entries/)).toBeVisible();await page.getByLabel('As of (SAST)',{exact:true}).fill('2020-02-02');mode='422';await button.click();await expect(page.getByRole('alert')).toContainText('Check the report parameters');await page.screenshot({path:"output/report-export-recovery/ageing-"+width+".png"});mode='success';const ageingDownload=page.waitForEvent('download');await button.click();assert.equal((await ageingDownload).suggestedFilename(),'stor24-receivables-ageing-as-of-2020-02-02.csv');
  await page.getByLabel(/^Report/).selectOption('unit-availability');await expect(page.getByLabel('From',{exact:true})).toHaveCount(0);await expect(page.getByLabel('To',{exact:true})).toHaveCount(0);await expect(page.getByText(/Current snapshot/)).toBeVisible();const snapshotDownload=page.waitForEvent('download');await button.click();assert.equal((await snapshotDownload).suggestedFilename(),'stor24-unit-availability-current.csv');
  for(const status of ['401','403']) {
   await open();mode=status;await button.click();await expect(button).toBeDisabled();await expect(page.getByRole('alert')).toContainText(status==='401'?'Sign in again':'administrator');
   if(status==='401')await expect(page.getByRole('link',{name:'Sign in again'})).toHaveAttribute('href','/login?next=%2Freports');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`output/report-export-recovery/${width}-${status}.png`});
   if(status==='403'){const count=reads;await page.getByRole('button',{name:'Reload report access'}).click();await expect(button).toBeEnabled();assert.equal(reads,count);}
  }
  await open('?denied');await expect(button).toBeDisabled();await expect(page.getByText(/Export access is unavailable/)).toContainText('administrator');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: actual report component retains selections through validation/server/malformed/network/timeout failures; duplicate GET protection, empty data, exact CSV download, session/access guidance and read-only reload at 1440/390/320px.');
} finally {await browser.close();await new Promise(r=>server.close(r));}

