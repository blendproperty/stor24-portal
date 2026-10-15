import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StaffEventEmails} from './src/components/staff-event-emails';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1200,margin:'auto'}}><StaffEventEmails/></main>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', outfile: 'output/staff-event-emails/app.js', plugins: [{ name: 'next-link-fixture', setup(b) { b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,loader:'jsx',resolveDir:process.cwd()})); } }] });
const css = (await readFile('src/app/globals.css','utf8')+'\n'+await readFile('src/styles/stor24-brand.css','utf8')).replace('@import "tailwindcss";','')+'\n'+(bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'');
const js = bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{font-family:Arial,sans-serif;margin:0;background:#f3f6f7}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();await mkdir('output/staff-event-emails',{recursive:true});
const id=n=>'c'+String(n).padStart(24,'0'), uuid='c3a695c2-cb0f-439e-979d-32c1e41381cc', policyId='staff-event-email-policy:'+uuid;
try {
 for(const width of [1440,1024,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000}}),writes=[],errors=[];let mode='success',retained=null;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/operations/event-emails**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()==='GET'){
    if(mode==='401')return route.fulfill({status:401,json:{error:{}}});
    return route.fulfill({json:{data:{facilities:[{id:id(1),name:'Synthetic Midpoint'}],staff:[{id:id(2),name:'Synthetic covering manager',email:'synthetic-cover@example.invalid'}],policies:retained?[retained]:[],selectedPolicy:url.searchParams.get('policyId')?retained:null,outbox:[],nextCursor:null,nextOutboxCursor:null,selectedFacilityId:url.searchParams.get('facilityId')??'',selectedPolicyId:url.searchParams.get('policyId')??'',capabilities:{canManage:true,canApprove:true},sendingEnabled:false}}});
   }
   assert.equal(request.method(),'POST');const body=request.postDataJSON();writes.push(body);
   assert.ok(['preview','prepare','evaluate','review'].includes(body.action),'No send/activation/retry API command');
   if(body.action==='preview')return route.fulfill({json:{data:{requestKey:body.requestKey,input:body.input,facility:'Synthetic Midpoint',sender:'Not configured',recipients:[{id:id(2),name:'Synthetic covering manager',email:'synthetic-cover@example.invalid'}],examples:[{sourceKey:'BOOKING:'+id(3),sourceHash:'b'.repeat(64),at:'2026-10-15T08:00:00.000Z',subject:'Synthetic booking event',text:'Synthetic training example. Not payment or physical access approval.'}],moreSourcePages:false,policyFingerprint:'a'.repeat(64),previewFingerprint:'c'.repeat(64)}}});
   if(body.action==='prepare'){
    retained={id:policyId,revision:uuid,label:body.input.label,status:'PENDING_REVIEW',facilityId:id(1),facility:'Synthetic Midpoint',createdAt:'2026-10-15T09:00:00.000Z',createdByName:'Synthetic preparer',createdById:id(4),reviewedAt:null,reviewedByName:null,reference:null,input:body.input,recipients:[{id:id(2),name:'Synthetic covering manager',email:'synthetic-cover@example.invalid'}],policyFingerprint:'a'.repeat(64),authorityCurrent:true,blockers:[],activationConfigured:false,canReview:false,canCancel:true,scanMore:false};
    return route.fulfill({json:{data:retained}});
   }
   throw Error('Unexpected fixture mutation');
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);await expect(page.getByText('Email sending is disabled.',{exact:true})).toBeVisible();
  await page.getByLabel('Store',{exact:true}).selectOption(id(1));await expect(page.getByLabel('Policy name',{exact:true})).toBeVisible();
  await page.getByLabel('Policy name',{exact:true}).fill('Synthetic manager review');
  await page.getByLabel('Source from',{exact:true}).fill('2026-10-15');await page.getByLabel('Source to (inclusive)',{exact:true}).fill('2026-10-15');
  await page.getByLabel('Delivery from (SAST)',{exact:true}).fill('2026-10-15T09:00');await page.getByLabel('Delivery expires (SAST)',{exact:true}).fill('2026-10-16T00:00');
  await page.getByRole('checkbox',{name:/Synthetic covering manager/}).check();await page.getByRole('checkbox',{name:'Booking created',exact:true}).check();
  await page.getByRole('button',{name:'Preview email policy',exact:true}).click();await expect(page.getByRole('heading',{name:'Preview — nothing sent',exact:true})).toBeVisible();
  assert.equal(writes.length,1);assert.equal(writes[0].action,'preview');
  await page.getByLabel('Policy name',{exact:true}).fill('Revised synthetic manager review');await expect(page.getByRole('heading',{name:'Preview — nothing sent',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Preview email policy',exact:true}).click();await expect(page.getByRole('heading',{name:'Preview — nothing sent',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retain for independent review',exact:true}).click();await expect(page.getByRole('heading',{name:'Reviewed outbox',exact:true})).toBeVisible();
  assert.equal(writes.filter(w=>w.action==='prepare').length,1);await expect(page.getByRole('button',{name:'Approve reviewed policy',exact:true})).toHaveCount(0);
  await page.screenshot({path:`output/staff-event-emails/review-${width}.png`,fullPage:true});
  const bounds=await page.locator('input,select,button,a').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,text:n.textContent}}));
  for(const control of bounds)assert.ok(control.left>=-1&&control.right<=width+1,JSON.stringify({width,control}));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  mode='401';await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'Reviewed outbox',exact:true})).toHaveCount(0);assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Staff event email UI: four widths, explicit fields, preview invalidation, retained independent review, no send/activation commands, 401 recovery and zero page errors passed. Synthetic fixtures only; no actual provider or staff UAT.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
