import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {visualReportDatasets} from '../src/lib/visual-report-contract.ts';
import {visualReportTemplates} from '../src/lib/visual-report-templates.ts';
import {prepareReportHistory} from '../src/lib/report-history-contract.ts';
import {evaluateVisualReport} from '../src/lib/visual-report-engine.ts';
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css','src/styles/workspace-insights.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {VisualReportBuilder} from './src/components/visual-report-builder';createRoot(document.getElementById('root')).render(<main className="app-shell"><div className="content page-stack report-library-workspace" style={{padding:24}}><h1>Report library & custom reports</h1><VisualReportBuilder facilities={[{id:'a',name:'Fixture store'}]} from="2026-10-01" to="2026-10-31" canExport={true} canSchedule={true} canShare={true}/></div></main>);`,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',jsx:'automatic'});
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();await mkdir('output/visual-report-builder',{recursive:true});
try {
  for(const width of [1920,1440,1024,768,390,320]) {
    const page=await browser.newPage({viewport:{width,height:1000}});const saved=[],schedules=[],history=[],requests=[];let failPreview=true;
    await page.route('**/api/v1/reports/builder',async route=>{
      if(route.request().method()==='GET')return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{datasets:visualReportDatasets,templates:visualReportTemplates,saved,schedules,runs:[],history}})});
      const body=route.request().postDataJSON();requests.push(body);
      if(body.kind==='preview') {
        if(failPreview){failPreview=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Temporary report failure. Your selections are retained.'}})});}
        const result=evaluateVisualReport(body.query,[{facility:'Fixture store',unit:'A1',floor:'G',type:'Small',status:'AVAILABLE',effectiveStatus:'AVAILABLE',products:'STORAGE',monthlyRate:'100.00',area:4,operational:true,currency:'ZAR'},{facility:'Fixture store',unit:'B1',floor:'G',type:'Small',status:'OCCUPIED',effectiveStatus:'OCCUPIED',products:'STORAGE',monthlyRate:'120.00',area:4,operational:true,currency:'ZAR'}]);
        return route.fulfill({contentType:'application/json',body:JSON.stringify({data:result.rows,meta:{query:body.query,matchedRows:result.matchedRows,generatedAt:new Date().toISOString(),basis:result.dataset.basis,grain:result.dataset.grain}})});
      }
      if(body.kind==='save') {const entry={id:'saved-fixture',name:body.query.name,definition:body.query,revision:1,visibility:body.visibility,editable:true};saved.splice(0,saved.length,entry);return route.fulfill({contentType:'application/json',body:JSON.stringify({data:entry})});}
      if(body.kind==='schedule'){schedules.push({id:'schedule-fixture',name:saved[0].name,active:true,nextRunAt:'2026-10-08T06:00:00Z',cronExpression:'0 8 * * *'});return route.fulfill({contentType:'application/json',body:'{"data":{"id":"schedule-fixture"}}'});}
      if(body.kind==='pause'){schedules[0].active=false;return route.fulfill({contentType:'application/json',body:'{"data":{"paused":true}}'});}
      if(body.kind==='export')return route.fulfill({contentType:'text/csv',body:'"Unit"\r\n"A1"'});
      return route.fulfill({status:422,contentType:'application/json',body:'{"error":{"message":"Unsupported fixture operation"}}'});
    });
    await page.route('**/api/v1/reports/history',async route=>{
      const body=route.request().postDataJSON();requests.push(body);const prepared=prepareReportHistory(body,'Fixture store');
      if(body.kind==='validate')return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{rowCount:prepared.rows.length,sourceSha256:'a'.repeat(64),unmappedFields:prepared.unmappedFields}})});
      history.push({id:'fixture-history',dataset:body.dataset,facilityId:body.facilityId,name:body.name,extractedAt:body.extractedAt,rowCount:prepared.rows.length});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{id:'fixture-history',rowCount:prepared.rows.length}})});
    });
    await page.goto(origin);await expect(page.getByRole('region',{name:'Units reports',exact:true})).toBeVisible();const geometry=await page.locator('.report-library-categories').evaluate(root=>{
      const categories=[...root.querySelectorAll('.report-library-category')];
      return categories.map(category=>({section:category.getBoundingClientRect().toJSON(),header:category.querySelector('summary').getBoundingClientRect().toJSON(),cards:[...category.querySelectorAll('.report-template-card')].map(card=>({box:card.getBoundingClientRect().toJSON(),actions:[...card.querySelectorAll('.button-row>button, a.button')].map(button=>button.getBoundingClientRect().toJSON())}))}));
    });
    for(const [index,category] of geometry.entries()){
      assert.ok(Math.abs(category.header.width-category.section.width)<2,'Category heading spans the full section');
      if(index)assert.ok(category.section.top>=geometry[index-1].section.bottom+20,'Categories stack with a clear gap');
      const reference=category.cards[0].box;assert.ok(Math.abs(reference.width-geometry[0].cards[0].box.width)<2,'Card widths match across categories');
      for(const card of category.cards){
        assert.ok(Math.abs(card.box.width-reference.width)<2,'Cards have equal widths');
        assert.ok(Math.abs(card.box.height-reference.height)<2,'All category cards have equal heights');
        if(card.actions.length){const last=card.actions.at(-1);assert.ok(card.box.bottom-last.bottom>=14&&card.box.bottom-last.bottom<=20,'All report actions align to the card footer');}
        if(card.actions.length===2){const [online,template]=card.actions;assert.ok(Math.abs(online.top-template.top)<2?template.left-online.right>=17:template.top-online.bottom>=9,'Online and template actions have a real gap');assert.ok(template.right<=card.box.right,'Actions stay inside their card');}
      }
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Directory has no page overflow at ${width}`);
    const sourceDetails=page.locator('.report-card-details').first();await sourceDetails.locator('summary').click();await expect(sourceDetails.locator('p')).toHaveCount(2);await expect(sourceDetails.locator('p').first()).toBeVisible();await expect(sourceDetails.locator('p').last()).toBeVisible();await sourceDetails.locator('summary').click();await expect(sourceDetails.locator('p').first()).not.toBeVisible();await expect(sourceDetails.locator('p').last()).not.toBeVisible();await page.screenshot({path:`output/visual-report-builder/library-viewport-${width}.png`,fullPage:false});
    await page.screenshot({path:`output/visual-report-builder/library-${width}.png`,fullPage:true});await expect(page.getByRole('heading',{name:'Report library',exact:true})).toBeVisible();await page.getByLabel('Find a report').fill('Price list');await expect(page.locator('.report-template-card')).toHaveCount(1);await page.getByRole('button',{name:'Use template',exact:true}).click();
    await page.getByLabel('Report name',{exact:true}).fill('Vacant units fixture');await page.getByRole('button',{name:'Add filter',exact:true}).click();await page.getByLabel('Filter 1 field').selectOption('effectiveStatus');await page.getByLabel('Value',{exact:true}).fill('AVAILABLE');
    await page.getByRole('button',{name:'Preview report',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Temporary report failure');await expect(page.getByLabel('Report name',{exact:true})).toHaveValue('Vacant units fixture');await expect(page.getByRole('region',{name:'Report results'})).toHaveCount(0);
    await page.getByRole('button',{name:'Preview report',exact:true}).click();await expect(page.getByRole('region',{name:'Report results'})).toContainText('A1');await expect(page.getByText('Matching source records',{exact:true})).toBeVisible();await page.getByLabel('Search result rows',{exact:true}).fill('no-match');await expect(page.getByText('No result rows match this search.',{exact:true})).toBeVisible();await page.getByLabel('Search result rows',{exact:true}).fill('');assert.equal(requests.filter(r=>r.kind==='preview').length,2);assert.equal(requests.at(-1).query.filters[0].value,'AVAILABLE');
    await page.getByLabel('Report name',{exact:true}).fill('Vacant units saved');await expect(page.getByRole('region',{name:'Report results'})).toHaveCount(0);await page.getByRole('button',{name:'Save report',exact:true}).click();await expect(page.getByRole('status')).toContainText('Report saved');assert.ok(requests.find(r=>r.kind==='save').requestKey);
    await page.getByRole('button',{name:'Preview report',exact:true}).click();await expect(page.getByRole('region',{name:'Report results'})).toContainText('A1');await page.screenshot({path:`output/visual-report-builder/builder-${width}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No page overflow at ${width}`);
    await page.getByLabel('Download format',{exact:true}).selectOption('CSV');const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV',exact:true}).click();assert.match((await download).suggestedFilename(),/\.csv$/);
    await page.getByRole('button',{name:'Schedule saved report',exact:true}).click();await expect(page.getByRole('status')).toContainText('Scheduled for 08:00 SAST');await page.getByRole('button',{name:'Schedules & history',exact:true}).click();await expect(page.getByText(/Active · Next/)).toBeVisible();await page.getByRole('button',{name:'Pause schedule',exact:true}).click();await expect(page.getByText('Paused',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Saved reports',exact:true}).click();await expect(page.getByRole('heading',{name:'Vacant units saved'})).toBeVisible();await page.getByRole('button',{name:'Open report',exact:true}).click();await expect(page.getByLabel('Report name',{exact:true})).toHaveValue('Vacant units saved');
    await page.getByRole('button',{name:'Add total',exact:true}).click();await page.locator('.report-group-picker').getByRole('checkbox',{name:'Store',exact:true}).check();await page.getByRole('button',{name:'Preview report',exact:true}).click();await expect(page.getByRole('region',{name:'Report results'}).getByRole('columnheader',{name:'Record count'})).toBeVisible();
    await page.screenshot({path:`output/visual-report-builder/grouped-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Report library',exact:true}).click();await page.getByLabel('Find a report').fill('Price list');await page.getByRole('button',{name:'View online',exact:true}).click();await expect(page.getByRole('region',{name:'Report results'})).toBeVisible();await expect(page.getByLabel('Report name',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Adjust fields and filters',exact:true})).toBeVisible();await page.screenshot({path:`output/visual-report-builder/online-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'SiteLink history',exact:true}).click();
    const importer=page.locator('section').filter({has:page.getByRole('heading',{name:'Import SiteLink reporting history',exact:true})});
    await importer.locator('label').filter({hasText:/^Dataset/}).locator('select').selectOption('units');
    await page.getByLabel('Source CSV').setInputFiles({name:'Synthetic history.csv',mimeType:'text/csv',buffer:Buffer.from('sourceRecordId,unit,monthlyRate,currency\nrecord-1,A9,120.00,ZAR')});
    await page.getByLabel('Extracted at (SAST)').fill('2026-10-01T08:00');await page.getByLabel('Approval / reconciliation reference').fill('Synthetic control totals');
    await page.getByRole('button',{name:'Validate extract',exact:true}).click();await expect(page.getByText('Validated 1 records.',{exact:false})).toBeVisible();
    await page.getByLabel('Approval / reconciliation reference').fill('Updated synthetic review');await expect(page.getByRole('button',{name:'Import validated history',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Validate extract',exact:true}).click();await expect(page.getByRole('button',{name:'Import validated history',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Import validated history',exact:true}).click();await expect(page.getByText('Imported 1 reporting records.',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Build from history',exact:true}).click();await expect(page.locator('label').filter({hasText:/^Record source/}).locator('select')).toHaveValue('fixture-history');
    assert.equal(requests.find(r=>r.kind==='import').extractedAt,'2026-10-01T08:00:00+02:00');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.close();
  }
  const malformed=await browser.newPage();let validCatalogue=false;const catalogueErrors=[];malformed.on('pageerror',error=>catalogueErrors.push(error.message));await malformed.route('**/api/v1/reports/builder',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:validCatalogue?{datasets:visualReportDatasets,templates:visualReportTemplates,saved:[],schedules:[],runs:[],history:[]}:[]})}));await malformed.goto(origin);await expect(malformed.getByRole('alert')).toContainText('The report library could not be read');validCatalogue=true;await malformed.getByRole('button',{name:'Reload reporting',exact:true}).click();await expect(malformed.getByRole('region',{name:'Units reports',exact:true})).toBeVisible();await expect(malformed.getByRole('alert')).toHaveCount(0);assert.deepEqual(catalogueErrors,[]);await malformed.close();
  console.log('PASS actual builder templates, filters, retained failed-preview selections, stale-result clearing, saved definitions, typed totals, CSV downloads and schedule/pause controls, CSV history mapping/validation invalidation/import/source selection at 1920/1440/1024/768/390/320, including full-width stacked categories, equal card sizes and separated actions. All database/provider APIs intercepted.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
