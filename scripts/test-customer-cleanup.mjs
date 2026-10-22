import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TestCustomerCleanup} from './src/components/test-customer-cleanup';createRoot(document.getElementById('root')).render(<TestCustomerCleanup customers={[{id:'test-one',name:'Synthetic One',contact:'one@example.invalid'},{id:'test-two',name:'Synthetic Two',contact:'two@example.invalid'},{id:'control',name:'Real Control',contact:''}]} disabled={false} onDeleted={async()=>{window.refreshed=true}}/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle:true, write:false, format:'esm', jsx:'automatic' });
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
await mkdir('output/customer-cleanup',{recursive:true});
try {
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:1000}});let mode='ok';const calls=[];const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v1/admin/test-customers',async route=>{
   const input=route.request().postDataJSON();calls.push(input);
   assert.deepEqual([...input.ids].sort(),['test-one','test-two']);
   if(mode==='denied') return route.fulfill({status:403,json:{error:{message:'Owner required'}}});
   if(input.action==='preview')return route.fulfill({json:{data:{customers:[{id:'test-one',name:'Synthetic One'},{id:'test-two',name:'Synthetic Two'}],counts:{customers:2,leads:3},fingerprint:'a'.repeat(64)}}});
   assert.equal(input.confirmation,'DELETE SELECTED TEST CUSTOMERS');assert.equal(input.fingerprint,'a'.repeat(64));
   if(mode==='uncertain')return route.abort();
   return route.fulfill({json:{data:{customers:2}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const open=page.getByRole('button',{name:'Delete test customers',exact:true});await open.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await dialog.getByLabel('Find test customers').fill('Synthetic');
  await dialog.getByRole('button',{name:'Select all matching (2)',exact:true}).click();assert.equal(calls.length,0);
  mode='denied';await dialog.getByRole('button',{name:'Review 2 selected',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Owner required');
  mode='ok';await dialog.getByRole('button',{name:'Review 2 selected',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Review 2 selected customers'})).toBeVisible();
  const remove=dialog.getByRole('button',{name:'Permanently delete selected tests',exact:true});await expect(remove).toBeDisabled();
  await expect(dialog.getByText('Real Control')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Keep customers'}).click();assert.equal(calls.filter(c=>c.action==='delete').length,0);
  await open.click();await dialog.getByRole('button',{name:'Select all matching (2)',exact:true}).click();await dialog.getByRole('button',{name:'Review 2 selected',exact:true}).click();
  await dialog.getByLabel('Type DELETE SELECTED TEST CUSTOMERS').fill('DELETE SELECTED TEST CUSTOMERS');await expect(remove).toBeEnabled();
  await page.screenshot({path:`output/customer-cleanup/${width}.png`});
  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await remove.click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('status')).toContainText('2 test customers deleted');assert.equal(await page.evaluate(()=>window.refreshed),true);
  await open.click();await dialog.getByRole('button',{name:'Select all matching (2)',exact:true}).click();await dialog.getByRole('button',{name:'Review 2 selected',exact:true}).click();
  await dialog.getByLabel('Type DELETE SELECTED TEST CUSTOMERS').fill('DELETE SELECTED TEST CUSTOMERS');mode='uncertain';await remove.click();
  await expect(dialog.getByRole('alert')).toContainText('outcome could not be confirmed');await expect(remove).toBeDisabled();await expect(open).toBeDisabled();
  assert.equal(calls.filter(c=>c.action==='delete').length,2);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: actual cleanup component selection, exact review, owner denial, typed confirmation, cancel, refresh, uncertain-write block, desktop and phone layouts (synthetic fixtures).');
} finally {await browser.close();await new Promise(r=>server.close(r));}
