import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
const bundle = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{WalkInStarter}from'./src/components/walk-in-starter';createRoot(document.getElementById('root')).render(<WalkInStarter facilities={[{id:'store',name:'Store 1 - Midpoint'}]}/>);`,resolveDir:process.cwd(),loader:'tsx'},plugins:[{name:'image',setup(b){b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>}`,loader:'jsx',resolveDir:process.cwd()}));}}],bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
const qrDataUrl=await QRCode.toDataURL('https://stor24.co.za/walk-in#launch='+'e'.repeat(64));
let expired=false,fail=false;
const server=createServer(async(req,res)=>{
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
  if(req.url==='/api/v1/walk-in'){
    res.setHeader('content-type','application/json');if(fail){res.statusCode=503;return res.end(JSON.stringify({error:{message:'Reconnect and retry'}}));}
    return res.end(JSON.stringify({data:{id:'synthetic',facilityName:'Store 1 - Midpoint',launchUrl:'https://stor24.co.za/walk-in#launch='+'e'.repeat(64),visitCode:'ABCD-2345',qrDataUrl,expiresAt:new Date(Date.now()+(expired?-1000:300000)).toISOString()}}));
  }
  res.setHeader('content-type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:16px}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();await mkdir('output/walk-in-starter',{recursive:true});
try{for(const width of [1440,820,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));expired=false;fail=false;
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Prepare tablet visit'}).click();
  await expect(page.getByText('ABCD-2345',{exact:true})).toBeVisible();await expect(page.getByAltText('Scan this visit QR in the STOR24 Counter app')).toBeVisible();
  assert.equal(await page.getByRole('button',{name:/Copy handover/}).count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`output/walk-in-starter/ready-${width}.png`,fullPage:true});
  expired=true;await page.getByRole('button',{name:'Prepare another visit'}).click();await expect(page.getByRole('heading',{name:'Visit code expired'})).toBeVisible();await expect(page.getByText('ABCD-2345',{exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Open on this device'})).toHaveCount(0);
  fail=true;await page.getByRole('button',{name:'Prepare another visit'}).click();await expect(page.getByRole('alert')).toHaveText('Reconnect and retry');assert.deepEqual(errors,[]);await page.close();
}console.log('Synthetic CRM QR/code display, expiry, retry and responsive 1440/820/390/320 passed.');}finally{await browser.close();await new Promise(r=>server.close(r));}
