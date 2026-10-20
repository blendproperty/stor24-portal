import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import ExcelJS from 'exceljs';
const excel=new ExcelJS.Workbook();excel.addWorksheet('Customer history').addRow(['Synthetic history']);const fixtureExcelBytes=await excel.xlsx.writeBuffer();
const policyBundle=await build({entryPoints:['src/lib/customer-history-policy.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {historyExportSchema}=await import('data:text/javascript;base64,'+Buffer.from(policyBundle.outputFiles[0].text).toString('base64'));
const fixturePdf=await PDFDocument.create();fixturePdf.addPage().drawText('Synthetic customer contact history');const fixturePdfBytes=await fixturePdf.save();
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CustomerOperationsWorkspace}from'./src/components/customer-operations-workspace';createRoot(document.getElementById('root')).render(<CustomerOperationsWorkspace initialFollowups={new URLSearchParams(window.location.search).get("section") === "followups"}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic',plugins:[{name:'next-link',setup(b){b.onResolve({filter:/^next\/link$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:'jsx',resolveDir:process.cwd()}));}}]});
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','')+"\nbody{font-family:Arial,sans-serif;margin:0;background:#eff4f7;}#root{padding:28px;max-width:1440px;margin:auto;}";
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();await mkdir('output/customer-dossier',{recursive:true});
const customer={id:'synthetic-customer',type:'INDIVIDUAL',firstName:'Alex',lastName:'Example',companyName:null,email:'alex@example.invalid',phone:'+27820000000',identityRef:null,taxNumber:null,dateOfBirth:null,notes:null,billingAddress:null,alternateContact:null,workContact:null,emergencyContact:null,communicationConsent:{email:true,sms:true,whatsapp:true,phone:true},tenancies:[],leads:[],reservations:[]};
const base={id:'message-1',kind:'COMMUNICATION',at:'2026-10-14T09:30:00.000Z',title:'WHATSAPP Â· RESERVATION CONFIRMED',body:'Outbound communication record',category:null,author:null,facility:'Midpoint',channel:'WHATSAPP',status:'SUCCEEDED',sentAt:'2026-10-14T09:30:00.000Z',deliveredAt:'2026-10-14T09:31:00.000Z',readAt:'2026-10-14T09:32:00.000Z'};
const data={entries:[{...base,id:'note',kind:'NOTE',category:'HANDOVER',channel:null,status:null,title:'Staff handover',body:'Customer expects to arrive on Saturday. Covering staff to confirm the arrival requirements.',author:'Synthetic Faeez'},base,{...base,id:'sms',channel:'SMS',title:'SMS Â· RESERVATION CONFIRMED',readAt:null},{...base,id:'email',channel:'EMAIL',title:'EMAIL Â· RESERVATION CONFIRMED',deliveredAt:null,readAt:null}],nextCursor:null,facilities:[{id:'midpoint',name:'Midpoint'}],writableFacilities:[{id:'midpoint',name:'Midpoint'}],visibility:{communications:true,collections:true},legacyNotes:null,canExport:true};
try{
 for(const width of [1440,1024,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:true});let requests=[],mode='success';const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/leasing/customers',r=>r.fulfill({json:{data:[customer]}}));
  await page.route('**/api/v1/customers/*/history**',async route=>{
    if(route.request().url().includes('/export')){
      const body=route.request().postDataJSON();requests.push(body);
      if(!historyExportSchema.safeParse(body).success)return route.fulfill({status:422,json:{error:{message:"Choose PDF, CSV or Excel and valid history filters."}}});
      if(mode==='403')return route.fulfill({status:403,json:{error:{message:'Download access is unavailable.'}}});
      if(mode==='malformed')return route.fulfill({contentType:'text/html',body:'not a file'});
      if(mode==='hold')return;
      return route.fulfill({headers:{'content-type':body.format==='PDF'?'application/pdf':body.format==='XLSX'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv; charset=utf-8'},body:body.format==='PDF'?Buffer.from(fixturePdfBytes):body.format==='XLSX'?Buffer.from(fixtureExcelBytes):'customerName,body\r\nAlex Example,Complete stored history'});
    }
    return route.fulfill({json:{data}});
  });
  await page.route('**/api/v1/operations/followups**', r => { assert.equal(new URL(r.request().url()).searchParams.get('customer'), customer.id); return r.fulfill({json:{data:{userId:'staff',canManage:true,tasks:[],nextCursor:null,facilities:[{id:'midpoint',name:'Midpoint'}],customers:[customer],staff:[]}}}); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole('heading',{name:'Alex Example',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Customer history & staff notes'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Identity',exact:true})).toBeHidden();
  await expect(page.getByLabel('Staff note',{exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Contact details',exact:true}).click();await expect(page.getByRole('heading',{name:'Identity',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Documents',exact:true}).click();await expect(page.getByRole('heading',{name:'Signed booking agreements'})).toBeVisible();
  await page.getByRole('button',{name:'Follow-ups',exact:true}).click();
  await page.getByRole('button',{name:'Schedule follow-up',exact:true}).click();
  await expect(page.getByLabel('Customer',{exact:true})).toHaveValue(customer.id);
  await expect(page.getByLabel('Customer',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('Agreed date and time (SAST)')).toBeVisible();
  await page.getByLabel('Agreed date and time (SAST)').fill('2026-10-21T10:30');
  await page.getByRole('button',{name:'Contact details',exact:true}).click();
  await page.getByRole('button',{name:'Follow-ups',exact:true}).click();
  await expect(page.getByLabel('Agreed date and time (SAST)')).toHaveValue('2026-10-21T10:30');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`output/customer-dossier/followups-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'History & notes',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const initialHeight=await page.locator('.customer-detail').evaluate(e=>e.getBoundingClientRect().height);
  if(width>=1024)assert.ok(initialHeight<1300,'Desktop dossier must not be a long stack');
  await page.screenshot({path:`output/customer-dossier/${width}.png`,fullPage:true});
  for(const format of ['PDF','CSV','XLSX']){
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:format==='PDF'?'Download history':format==='XLSX'?'Excel':'CSV',exact:true}).click();
    const downloaded=await pending;assert.ok(downloaded.suggestedFilename().endsWith('.'+format.toLowerCase()));await downloaded.saveAs(`output/customer-dossier/${width}.${format.toLowerCase()}`);
    assert.equal(requests.at(-1).format,format);assert.equal(requests.at(-1).kind,'ALL');assert.equal(requests.at(-1).category,undefined);assert.ok(historyExportSchema.safeParse(requests.at(-1)).success);
  }
  await page.getByRole('combobox',{name:'Note category',exact:true}).selectOption('HANDOVER');
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  const filteredDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Excel',exact:true}).click();await filteredDownload;
  assert.equal(requests.at(-1).category,'HANDOVER');assert.ok(historyExportSchema.safeParse(requests.at(-1)).success);
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download WHATSAPP Â· RESERVATION CONFIRMED',exact:true}).click();await pending;assert.equal(requests.at(-1).entryId,'message-1');assert.equal(requests.at(-1).entryKind,'COMMUNICATION');
  for(const failure of ['403','malformed']){mode=failure;for(const name of ['Download history','Excel']){await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();}}
  mode='success';await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByLabel('Staff note',{exact:true}).fill('Draft retained between sections');
  await page.getByRole('button',{name:'Contact details',exact:true}).click();await page.getByRole('button',{name:'History & notes',exact:true}).click();await expect(page.getByLabel('Staff note',{exact:true})).toHaveValue('Draft retained between sections');
  await page.goto(`http://127.0.0.1:${server.address().port}?section=followups`);
  await expect(page.getByRole("heading",{name:"Customer appointments",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Follow-ups",exact:true})).toHaveAttribute("aria-current","page");
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}px: compact customer tabs, draft retention, PDF/CSV/Excel download, single comm download and access/content failure recovery`);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
