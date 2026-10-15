import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CommunicationLogWorkspace} from './src/components/communication-log-workspace';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1200,margin:'auto'}}><CommunicationLogWorkspace/></main>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', outfile: 'output/communication-search/app.js' });
const css = (await readFile('src/app/globals.css', 'utf8') + '\n' + await readFile('src/styles/stor24-brand.css', 'utf8')).replace('@import "tailwindcss";', '') + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? js : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css} body{font-family:Arial,sans-serif;margin:0;background:#f3f6f7}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
await mkdir('output/communication-search', { recursive: true });
const id = n => 'c' + String(n).padStart(24, '0');
const defaults = {search:'',from:'',to:'',channel:'',status:'',facilityId:'',customerId:''};
const snapshotAt = '2026-10-15T09:00:00.000Z';
const rows = Array.from({length:135}, (_, n) => ({id:id(n+1),customerId:id(500),customerName:n===134?'Older synthetic customer':'Synthetic customer '+(n+1),canOpenCustomer:true,facilityName:'Synthetic Midpoint',channel:'WHATSAPP',messageType:'RESERVATION_CONFIRMED',direction:'OUTBOUND',status:'SUCCEEDED',queuedAt:'2026-10-14T08:00:00.000Z',sentAt:'2026-10-14T08:00:01.000Z',deliveredAt:'2026-10-14T08:00:02.000Z',readAt:null,failureCode:null,canRetryWhatsApp:false}));
try {
  for (const width of [1440,1024,390,320]) {
    const page = await browser.newPage({viewport:{width,height:1000}}), reads=[], errors=[];
    let mode='success';
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/v1/communications/**', async route=>{
      assert.equal(route.request().method(),'GET','Read UI must never send or retry a message');
      const url=new URL(route.request().url()); assert.equal(url.pathname,'/api/v1/communications/logs');
      const query=Object.fromEntries(url.searchParams); reads.push(query);
      if(['401','403','500'].includes(mode)) return route.fulfill({status:Number(mode),json:{error:{}}});
      if(mode==='malformed') return route.fulfill({json:{data:{rows:[]}}});
      const filters={...defaults,...query}; delete filters.cursor;
      const start=Number(query.cursor?.replace('page-','')??0), selected=filters.search?[rows[134]]:rows;
      const data={rows:selected.slice(start,start+25),facilities:[{id:id(600),name:'Synthetic Midpoint'}],filters,snapshotAt,nextCursor:selected.length>start+25?'page-'+(start+25):null};
      if(mode==='wrong-filter')data.filters={...filters,search:'Different customer'};
      if(mode==='wrong-snapshot')data.snapshotAt='2026-10-15T09:00:01.000Z';
      return route.fulfill({json:{data}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await page.getByLabel('Find customer',{exact:true}).fill('unsaved draft');
    await page.getByRole('button',{name:'Load older messages',exact:true}).click();
    await expect(page.locator('tbody tr')).toHaveCount(50);
    assert.equal(reads.at(-1).search,undefined,'Paging must use applied filters, not edited draft');
    await page.getByLabel('Find customer',{exact:true}).fill('Older synthetic customer');
    await page.getByLabel('Communication channel',{exact:true}).selectOption('WHATSAPP');
    await page.getByLabel('Recorded send status',{exact:true}).selectOption('SUCCEEDED');
    await page.getByLabel('From date (SAST)',{exact:true}).fill('2026-10-14');
    await page.getByLabel('To date (SAST)',{exact:true}).fill('2026-10-14');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    assert.deepEqual(reads.at(-1),{search:'Older synthetic customer',from:'2026-10-14',to:'2026-10-14',channel:'WHATSAPP',status:'SUCCEEDED'});
    await expect(page.getByRole('link',{name:'Customer history',exact:true})).toHaveAttribute('href','/tenants?customer='+id(500));
    await page.screenshot({path:`output/communication-search/filtered-${width}.png`,fullPage:true});
    const bounds=await page.locator('input,select,button,a').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>{const r=node.getBoundingClientRect();return {text:node.textContent,left:r.left,right:r.right};}));
    for(const control of bounds)assert.ok(control.left>=-1&&control.right<=width+1,JSON.stringify({width,control}));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const before=reads.length;
    await page.getByLabel('From date (SAST)',{exact:true}).fill('2026-10-15');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('from date'); assert.equal(reads.length,before);
    await page.getByLabel('From date (SAST)',{exact:true}).fill('2026-10-14');
    for(const failure of ['401','403','500','malformed','wrong-filter']){
      mode=failure;
      await page.getByLabel('Find customer',{exact:true}).fill('new intention '+failure);
      await page.getByRole('button',{name:'Apply filters',exact:true}).click();
      await expect(page.getByText('Message history unavailable',{exact:true})).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(0);
      await expect(page.getByText('No recorded messages match the applied filters',{exact:true})).toHaveCount(0);
      mode='success'; await page.getByRole('button',{name:'Refresh messages',exact:true}).click();
      await expect(page.locator('tbody tr')).toHaveCount(1); assert.equal(reads.at(-1).search,'new intention '+failure);
    }
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    assert.deepEqual(reads.at(-1),{});
    mode='wrong-snapshot'; await page.getByRole('button',{name:'Load older messages',exact:true}).click();
    await expect(page.getByText('Message history unavailable',{exact:true})).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    mode='success'; await page.getByRole('button',{name:'Refresh messages',exact:true}).click();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    for(const count of [50,75,100,125,135]) { await page.getByRole('button',{name:'Load older messages',exact:true}).click(); await expect(page.locator('tbody tr')).toHaveCount(count); }
    await expect(page.locator('tbody tr')).toHaveCount(135);
    assert.equal(new Set(await page.locator('tbody tr').allTextContents()).size,135);
    assert.deepEqual(errors,[]); await page.close();
    console.log(`PASS ${width}px: applied-filter paging, all135 records, old-customer lookup, SAST dates, failed-read safety, snapshot verification, responsive controls; GET only`);
  }
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
