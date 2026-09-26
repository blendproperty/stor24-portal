import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CustomerOperationsWorkspace} from './src/components/customer-operations-workspace';createRoot(document.getElementById('root')).render(<CustomerOperationsWorkspace initialCustomerId='syn-2'/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^next\/link$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:'jsx',resolveDir:process.cwd()}));
}}]});
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();await mkdir('output/customer-read-recovery',{recursive:true});
const customer={id:'syn-2',type:'INDIVIDUAL',firstName:'Synthetic',lastName:'Customer',companyName:null,email:'test@example.invalid',phone:null,identityRef:'SYNTHETIC-ONLY',taxNumber:null,dateOfBirth:null,notes:null,billingAddress:null,alternateContact:null,workContact:null,emergencyContact:null,communicationConsent:null,tenancies:[],leads:[],reservations:[]};
try {for(const width of [1440,390,320]) {
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let mode='network',reads=0,writes=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/leasing/customers',async route=>{
  if(route.request().method()!=='GET'){writes++;mode='500';const raw=route.request().postDataJSON();return route.fulfill({status:200,json:{data:{...(raw.data??raw),id:'syn-2'}}});} reads++;
  if(mode==='network')return route.abort();if(mode==='hold')return;
  if(['401','403','500'].includes(mode))return route.fulfill({status:Number(mode),json:{error:{message:'Fixture'}}});
  if(mode==='malformed')return route.fulfill({json:{data:{}}});
  if(mode==='nested')return route.fulfill({json:{data:[{...customer,tenancies:[{}]}]}});
  return route.fulfill({json:{data:mode==='empty'?[]:[{...customer,id:'syn-1',firstName:'Another'},customer]}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const reload=page.getByRole('button',{name:'Reload customer records',exact:true});
 await expect(page.getByRole('alert')).toContainText('could not be loaded');await expect(page.getByText('No customer records found.')).toHaveCount(0);await expect(page.getByRole('button',{name:'Add customer',exact:true})).toBeDisabled();
 for(const failure of ['500','malformed','nested','network']){mode=failure;await reload.click();await expect(page.getByRole('alert')).toContainText('could not be loaded');await expect(reload).toBeEnabled();}
 mode='hold';await page.clock.install();await reload.click();await expect(page.getByRole('button',{name:'Loading customer records…'})).toBeDisabled();await page.clock.fastForward(21000);await expect(reload).toBeEnabled();
 mode='success';await reload.click();await expect(page.getByRole('heading',{name:'Synthetic Customer',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit details'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 mode='403';await reload.click();await expect(page.getByRole('alert')).toContainText('administrator');await expect(page.getByText('SYNTHETIC-ONLY')).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit details'})).toHaveCount(0);
 mode='401';await reload.click();await expect(page.getByRole('link',{name:'Sign in again'})).toHaveAttribute('href','/login?next=%2Ftenants');
 mode='empty';await reload.click();await expect(page.getByText('No customer records found.')).toBeVisible();
 mode='success';await reload.click();await expect(page.getByRole('heading',{name:'Synthetic Customer',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit details'}).click();await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByText('Customer details updated.')).toBeVisible();await expect(page.getByRole('alert')).toContainText('could not be loaded');assert.equal(writes,1);
 mode='success';await reload.click();await expect(page.getByRole('heading',{name:'Synthetic Customer',exact:true})).toBeVisible();assert.equal(writes,1);assert.ok(reads>8);assert.deepEqual(errors,[]);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'output/customer-read-recovery/'+width+'.png'});await page.close();
} console.log('PASS: customer read failures, malformed/nested, timeout, empty, deep link, denied data clearing, sign-in and GET-only saved-record recovery at1440/390/320px');}finally{await browser.close();await new Promise(r=>server.close(r));}