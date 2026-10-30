import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
const compiled=await build({entryPoints:['tests/browser/operational-notice-fixture.jsx'],bundle:true,write:false,format:'esm',jsx:'automatic'});
const styled=await postcss([tailwindcss()]).process(await readFile('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')});
const css=styled.css+await readFile('src/styles/stor24-brand.css','utf8')+await readFile('src/styles/operational-notices.css','utf8');
const facilities=[{id:'A',name:'Synthetic store A'},{id:'B',name:'Synthetic store B'}];
let templates=[],runs=[],calls=[],fail=false,self=false,uncertain=false,readonly=false;
const customers=[{id:'one',name:'Synthetic customer one',email:'one@example.invalid',blockers:[]},{id:'two',name:'Synthetic customer two',email:'two@example.invalid',blockers:[]}];
const library=()=>({facilities,templates,customers,moreCustomers:false,runs,canManage:!readonly,canSend:!readonly,sendConfigured:true});
const server=createServer(async(req,res)=>{
 if(req.url==='/app.js'){res.setHeader('content-type','application/javascript');return res.end(compiled.outputFiles[0].text)}
 if(req.url.startsWith('/api/')){
  res.setHeader('content-type','application/json');if(fail){res.statusCode=403;return res.end(JSON.stringify({error:'Current store permission required'}))}
  if(req.method==='GET')return res.end(JSON.stringify(req.url.includes('facilityId=')?library():{facilities}));
  let text='';for await(const part of req)text+=part;const command=JSON.parse(text);calls.push(command);assert.equal(command.facilityId,'A');const i=command.input;let data;
  if(command.action==='save-template'){data={id:'template-'+(templates.length+1),key:'key',...i.content,version:templates.length+1,createdAt:'2026-10-30T00:00:00Z'};templates.unshift(data)}
  if(command.action==='preview'){assert.deepEqual(i.customerIds,['one']);const t=templates.find(t=>t.id===i.templateId);data={fingerprint:'a'.repeat(64),items:i.customerIds.map(customerId=>({customerId,recipient:'one@example.invalid',subject:t.subject.replace('{{store_name}}','Synthetic store A'),text:t.body.replace('{{customer_name}}','Synthetic customer one').replace('{{details}}',i.values.details),blockers:[]}))};}
  if(command.action==='prepare'){assert.equal(i.fingerprint,'a'.repeat(64));assert.deepEqual(i.customerIds,['one']);data={id:'run-12345678',revision:'12345678-1234-4234-8234-123456789abc',status:'DRAFT',preparedBy:'a',approvedBy:null,reference:null,approvedAt:null,items:[{customerId:'one',recipient:'one@example.invalid',subject:'Synthetic store A notice',text:'Literal <img src=x onerror=alert(1)> maintenance',status:'NOT_ATTEMPTED'}]};runs=[data]}
  if(command.action==='approve'){if(self){res.statusCode=403;return res.end(JSON.stringify({error:'Another authorised colleague must approve'}))}runs[0]={...runs[0],status:'APPROVED',reference:i.reference,approvedBy:'b',approvedAt:'2026-10-30T00:00:00Z'};data=runs[0]}
  if(command.action==='send'){assert.equal(i.customerId,'one');assert.equal(i.confirm,true);runs[0]={...runs[0],status:uncertain?'REVIEW_REQUIRED':'ACCEPTED',items:runs[0].items.map(i=>({...i,status:uncertain?'REVIEW_REQUIRED':'ACCEPTED'}))};data=runs[0]}
  if(command.action==='cancel'){assert.equal(runs[0].status,'DISPATCHING');assert.equal(runs[0].items[0].status,'ACCEPTED');runs[0]={...runs[0],status:'CANCELLED'};data=runs[0]}
  return res.end(JSON.stringify({data}));
 }
 res.setHeader('content-type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});await mkdir('output/operational-notices/browser',{recursive:true});
try{for(const width of [1440,390,320]){
 templates=[];runs=[];calls=[];fail=false;self=false;uncertain=width===320;readonly=false;
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('Notice store',{exact:true}).selectOption('A');await expect(page.getByText('Store template editor',{exact:true})).toBeVisible();
 await page.getByLabel('Start from',{exact:true}).selectOption('2');await page.getByLabel('Notice name',{exact:true}).fill('Synthetic maintenance');await page.getByRole('button',{name:'Save template version',exact:true}).click();await expect(page.getByRole('status')).toContainText('immutable');
 for(const [label,value] of [['Notice date','Synthetic date'],['Effective time / period','Synthetic future period'],['Approved details','Literal <img src=x onerror=alert(1)> maintenance'],['Contact details','Synthetic approved contact']])await page.getByLabel(label,{exact:true}).fill(value);
 const preview=page.getByRole('button',{name:'Preview exact audience',exact:true});await expect(preview).toBeDisabled();await page.getByLabel('Include Synthetic customer one',{exact:true}).check();await preview.click();await expect(page.getByRole('button',{name:'Save reviewed draft'})).toBeVisible();
 await page.getByLabel('Approved details',{exact:true}).fill('Changed synthetic detail');await expect(page.getByRole('button',{name:'Save reviewed draft'})).toHaveCount(0);await preview.click();await page.getByRole('button',{name:'Save reviewed draft'}).click();await expect(page.getByRole('status')).toContainText('nothing sent');assert.equal(calls.filter(c=>c.action==='send').length,0);
 await page.getByLabel('Review / cancellation reference',{exact:true}).fill('Synthetic independent approval');self=true;await page.getByRole('button',{name:/Approve exact notice/}).click();await expect(page.getByRole('alert')).toContainText('Another authorised');await expect(page.getByRole('table')).toHaveCount(0);self=false;await page.getByRole('button',{name:'Reload notices'}).click();await page.getByRole('button',{name:/Approve exact notice/}).click();await expect(page.getByRole('status')).toContainText('Nothing sent');
 const send=page.getByRole('button',{name:/Send next approved email/});await expect(send).toBeDisabled();await page.getByRole('checkbox',{name:/I confirm sending/}).check();await expect(send).toBeEnabled();await page.locator('details summary').click();assert.equal(await page.locator('.operational-notices img').count(),0);await page.screenshot({path:`output/operational-notices/browser/approved-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await send.click();await expect(page.getByRole('status')).toContainText('delivery outcome');await expect(send).toHaveCount(0);assert.equal(calls.filter(c=>c.action==='send').length,1);await expect(page.locator('summary')).toContainText(uncertain?'REVIEW_REQUIRED':'ACCEPTED');
 if(width===390){runs[0]={...runs[0],status:'DISPATCHING',items:[...runs[0].items,{customerId:'two',recipient:'two@example.invalid',subject:'Synthetic notice',text:'Synthetic remaining message',status:'NOT_ATTEMPTED'}]};await page.getByLabel('Notice store',{exact:true}).selectOption('B');await expect(page.getByText('Next recipient: two@example.invalid',{exact:true})).toBeVisible();await page.getByLabel('Notice store',{exact:true}).selectOption('A');await page.getByLabel('Review / cancellation reference',{exact:true}).fill('Synthetic cancellation of remaining audience');await page.getByRole('button',{name:/Cancel notice/}).click();await expect(page.getByRole('status')).toContainText('cancelled');assert.equal(runs[0].items[0].status,'ACCEPTED');assert.equal(calls.filter(c=>c.action==='send').length,1);}
 readonly=true;await page.getByLabel('Notice store',{exact:true}).selectOption('B');await expect(page.getByLabel('Notice name',{exact:true})).toBeDisabled();await expect(page.getByLabel('Template version',{exact:true})).toHaveValue('');assert.equal(await page.getByLabel('Include Synthetic customer one',{exact:true}).isChecked(),false);
 fail=true;await page.getByLabel('Notice store',{exact:true}).selectOption('A');await expect(page.getByRole('alert')).toContainText('Current store');await expect(page.getByRole('table')).toHaveCount(0);assert.deepEqual(errors,[]);await page.close();console.log(`Operational notices ${width}px: editor/version, exact selection, preview invalidation, independent approval, guarded one-recipient send, literal text, delivery hold, store/reset and revoked-read recovery passed.`);
}}catch(error){for(const context of browser.contexts())for(const page of context.pages()){console.log(await page.locator('body').innerText());await page.screenshot({path:'output/operational-notices/browser/failed.png',fullPage:true});}throw error;}finally{await browser.close();await new Promise(r=>server.close(r))}
