import { build } from "esbuild";
import { chromium,expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile,mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import sharp from "sharp";

const bundle=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {OperationalForms} from './src/components/operational-forms';createRoot(document.getElementById('root')).render(<OperationalForms/>);",resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic",outfile:"output/forms-browser/app.js",plugins:[{name:"next-fixture",setup(b){b.onResolve({filter:/^next\/(link|image)$/},a=>({path:a.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith('image')?"import React from 'react';export default function Image({unoptimized,...p}){return React.createElement('img',p)}":"import React from 'react';export default function Link(p){return React.createElement('a',p)}",loader:"jsx",resolveDir:process.cwd()}));}}]});
const compiled=await postcss([tailwindcss()]).process(await readFile("src/app/globals.css","utf8"),{from:resolve("src/app/globals.css")});
const css=compiled.css+(await Promise.all(["src/styles/stor24-brand.css","src/styles/staff-workspace.css"].map(p=>readFile(p,"utf8")))).join("\n")+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text+'\n@font-face{font-family:Satoshi;src:url(/font.ttf);font-weight:300 900}:root{--font-satoshi:Satoshi}.app-shell{display:block;min-height:100vh}';
const font=await readFile("public/brand/Satoshi-Variable.ttf"),server=createServer((req,res)=>{if(req.url==='/font.ttf'){res.setHeader('content-type','font/ttf');return res.end(font);}res.setHeader('content-type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles.find(f=>f.path.endsWith('.js')).text:req.url==='/style.css'?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div class="app-shell"><main class="content"><div id="root"></div></main></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));await mkdir('output/forms-browser',{recursive:true});const browser=await chromium.launch();
const [store,cso,manager,run]=Array.from({length:4},(_,i)=>`cm0000000000000000000000${i}`);
const photograph=await sharp({create:{width:40,height:30,channels:3,background:'#d0d5d8'}}).png().toBuffer();
try{for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let actor=cso,mode='ok',writes=0,version=0;
 let record={version:1,kind:'MAINTENANCE',values:{},photos:[],reviewerId:null,submittedAt:null,reviewedAt:null,reviewedBy:null,reviewNote:''};
 let task={id:run,title:'Maintenance and marketing issue',facilityId:store,createdById:cso,status:'OPEN',createdAt:'2026-10-30T08:00:00.000Z',updatedAt:'2026-10-30T08:00:00.000Z',facility:{name:'Synthetic Midpoint'},assignee:{name:'Synthetic CSO'}};
 const meta=()=>({actorId:actor,facilities:[{id:store,name:'Synthetic Midpoint'}],managerFacilityIds:actor===manager?[store]:[],reviewers:actor===cso?[{id:manager,name:'Synthetic manager',facilityIds:[store]}]:[]});
 await page.route('**/api/v1/operations/forms*',route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='GET'){
   if(mode==='denied')return route.fulfill({status:403,json:{error:{message:'Access revoked'}}});
   return route.fulfill({json:{data:{...meta(),...(url.searchParams.has('id')?{task:{...task,operationalForm:record}}:{tasks:[task],nextCursor:null})}}});
  }
  writes++;if(mode==='lost')return route.abort();if(mode==='stale')return route.fulfill({status:409,json:{error:{message:'Record changed. Reload before acting.'}}});
  const body=req.postDataJSON();
  if(req.method()==='POST'){assert.equal(body.kind,'MAINTENANCE');assert.equal(body.facilityId,store);}
  else {
   assert.equal(body.expectedUpdatedAt,task.updatedAt);
   if(['SAVE','SUBMIT'].includes(body.action)){record={...record,values:body.values,photos:body.photos,reviewerId:body.reviewerId};if(body.action==='SUBMIT'){task.status='WAITING';record.submittedAt='2026-10-30T09:00:00.000Z';}}
   if(body.action==='RETURN'){task.status='IN_PROGRESS';record.reviewNote=body.note;}
   if(body.action==='REVIEW'){task.status='COMPLETED';record.reviewNote=body.note;record.reviewedAt='2026-10-30T09:30:00.000Z';record.reviewedBy=actor;}
  }
  task.updatedAt=new Date(Date.parse('2026-10-30T08:00:00.000Z')+(++version)*1000).toISOString();return route.fulfill({json:{data:{id:run}}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('combobox',{name:'Store',exact:true}).selectOption(store);
 await page.getByRole('combobox',{name:'Form',exact:true}).selectOption('VISITOR');await expect(page.getByRole('button',{name:'Capture awaiting agreed rules'})).toBeDisabled();assert.equal(writes,0);
 await page.getByRole('combobox',{name:'Form',exact:true}).selectOption('MAINTENANCE');await page.getByRole('button',{name:'Create draft',exact:true}).click();
 await page.getByLabel('Priority *',{exact:true}).fill('1');await page.getByLabel('Date discovered').fill('2026-10-30');await page.getByLabel('Area / unit reference').fill('Reception');await page.getByRole('textbox',{name:'Issue *',exact:true}).fill('Synthetic damaged latch');await page.getByLabel('Action required').fill('Inspect and quote');await page.getByRole('combobox',{name:'Separate manager reviewer',exact:true}).selectOption(manager);
 await page.locator('input[type=file]').setInputFiles({name:'synthetic-equipment.png',mimeType:'image/png',buffer:photograph});await expect(page.getByRole('img',{name:'synthetic-equipment.png'})).toBeVisible();
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Issue *',exact:true})).toHaveValue('Synthetic damaged latch');await expect(page.getByRole('img',{name:'synthetic-equipment.png'})).toBeVisible();
 await page.getByRole('button',{name:'Submit for review',exact:true}).click();await expect(page.getByRole('button',{name:'Save draft',exact:true})).toHaveCount(0);
 actor=manager;await page.getByRole('button',{name:'Reload saved forms'}).click();await page.getByLabel('Review / cancellation note').fill('Please confirm photograph reference');await page.getByRole('button',{name:'Return for correction'}).click();
 actor=cso;await page.getByRole('button',{name:'Reload saved forms'}).click();await page.getByRole('button',{name:'Submit for review',exact:true}).click();actor=manager;await page.getByRole('button',{name:'Reload saved forms'}).click();await page.getByLabel('Review / cancellation note').fill('Reviewed; repairs and spending remain separate');await page.getByRole('button',{name:'Record manager review'}).click();await expect(page.getByRole('textbox',{name:'Issue *',exact:true})).toBeDisabled();
 await page.screenshot({path:`output/forms-browser/reviewed-${width}.png`,fullPage:true});
 actor=manager;task={...task,status:'OPEN',createdById:manager,title:'Supplier service and cost review',assignee:{name:'Synthetic manager'}};record={...record,kind:'ADJUDICATION',values:{supplier:'Synthetic contractor',cost:'1200.50'},reviewedAt:null,reviewedBy:null};await page.getByRole('button',{name:'Reload saved forms'}).click();await expect(page.getByRole('button',{name:'Submit for review',exact:true})).toBeDisabled();await expect(page.getByLabel('Quoted cost (ZAR)')).toHaveValue('1200.50');
 await page.screenshot({path:`output/forms-browser/held-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 mode='stale';await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Reload');await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();
 mode='ok';await page.getByRole('button',{name:'Reload saved forms'}).click();mode='lost';const before=writes;await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('alert')).toContainText('could not be confirmed');assert.equal(writes,before+1);
 mode='denied';await page.getByRole('button',{name:'Reload saved forms'}).click();await expect(page.getByRole('region',{name:'Operational form record'})).toHaveCount(0);await expect(page.getByText('Synthetic contractor')).toHaveCount(0);
 assert.deepEqual(errors,[]);await page.close();console.log(`PASS create/save/submit/return/review, held capture and spend, stale/lost/denied recovery at ${width}`);
}}finally{await browser.close();server.close();}
