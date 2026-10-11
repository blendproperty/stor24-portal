import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{LeaseSigningSession}from'./src/components/lease-signing-session';createRoot(document.getElementById('root')).render(<LeaseSigningSession documentId="test-document"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
let failed=false, complete=false, dispatch=false, prepared=0, mandatePrepared=0;
const context={accountId:'account /1',reservationId:'booking',leadId:'lead',paymentMethod:'DEBIT_ORDER',completed:false,signers:[{name:'Example customer',order:1,status:'PENDING',signingUrl:'https://signing.example.invalid/sign/test-only'}]};
const server=createServer(async(req,res)=>{
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
  if(req.url.startsWith('/api/')){res.setHeader('content-type','application/json');if(req.url.endsWith('/mandate-session')&&req.method==='POST'){mandatePrepared++;return res.end(JSON.stringify({data:{setupUrl:'https://stor24.co.za/book/debit-order/synthetic-mandate-token'}}));}if(req.method==='POST'){prepared++;dispatch=false;return res.end(JSON.stringify({data:{prepared:true}}));}if(failed){res.statusCode=503;return res.end(JSON.stringify({error:{message:'Signing status unavailable'}}));}return res.end(JSON.stringify({data:{...context,completed:complete,dispatchRequired:dispatch,signers:complete||dispatch?[]:context.signers}}));}
  res.setHeader('content-type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:16px}main{max-width:1400px;margin:auto}</style></head><body><main class="app-shell"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();await mkdir('output/assisted-signing',{recursive:true});
try {
  for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    failed=false;complete=false;dispatch=false;
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole('link',{name:'Open signing for Example customer'})).toBeVisible();
    await expect(page.getByRole('link',{name:'Open signing for Example customer'})).toHaveAttribute('rel','noopener noreferrer');
    await expect(page.getByRole('link',{name:'Review saved account'})).toHaveAttribute('href','/operations/accounts?accountId=account%20%2F1');
    assert.ok(await page.locator(".lease-signing-panel").evaluate(e => parseFloat(getComputedStyle(e).paddingLeft) >= 20));
    await page.screenshot({path:`output/assisted-signing/pending-${width}.png`,fullPage:true});
    failed=true;await page.getByRole('button',{name:'Refresh signing status'}).click();await expect(page.getByRole('alert')).toHaveText('Signing status unavailable');await expect(page.getByRole('link',{name:'Open signing for Example customer'})).toHaveCount(0);
    failed=false;dispatch=true;await page.getByRole('button',{name:'Refresh signing status'}).click();await expect(page.getByRole('button',{name:'Prepare signing for saved lease'})).toBeVisible();await page.getByRole('button',{name:'Prepare signing for saved lease'}).click();await expect(page.getByRole('link',{name:'Open signing for Example customer'})).toBeVisible();
    complete=true;await page.getByRole('button',{name:'Refresh signing status'}).click();await expect(page.getByRole('heading',{name:'Lease agreement signed'})).toBeVisible();await expect(page.getByRole('link',{name:'Continue to payment and account'})).toBeVisible();await expect(page.getByRole('link',{name:'Open signing for Example customer'})).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'Complete the separate debit-order mandate'})).toBeVisible();
    await page.getByRole('button',{name:'Prepare customer mandate signing'}).click();
    await expect(page.getByRole('link',{name:'Open customer mandate on this device'})).toHaveAttribute('href','https://stor24.co.za/book/debit-order/synthetic-mandate-token');
    await expect(page.getByRole('button',{name:"Copy mandate link for customer's phone"})).toBeVisible();
    failed=true;await page.getByRole('button',{name:'Refresh signing status'}).click();
    await expect(page.getByRole('link',{name:'Open customer mandate on this device'})).toHaveCount(0);
    failed=false;context.paymentMethod='EFT';await page.getByRole('button',{name:'Refresh signing status'}).click();
    await expect(page.getByRole('heading',{name:'Complete the separate debit-order mandate'})).toHaveCount(0);context.paymentMethod='DEBIT_ORDER';
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);assert.deepEqual(errors,[]);
    await page.screenshot({path:`output/assisted-signing/completed-${width}.png`,fullPage:true});await page.close();
  }
  assert.equal(prepared,3);assert.equal(mandatePrepared,3);console.log('Assisted signing and separate mobile bank mandate, stale-link removal, EFT isolation and saved completion passed at 1440/390/320. Responses are synthetic; no live lease or mandate was created.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
