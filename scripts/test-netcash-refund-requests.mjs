import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{NetcashRefundWorkspace}from'./src/components/netcash-refund-workspace';const root=createRoot(document.getElementById('root'));let actor='sender',enabled=false;function render(){root.render(<main style={{maxWidth:1000,margin:'auto',padding:16}}><NetcashRefundWorkspace userId={actor} preparationEnabled={false} reservationEnabled={false} requestEnabled={enabled} facilities={[{id:'store-a',name:'Synthetic store',prepare:false,review:false,reserve:true,release:true,send:true,sendReview:true}]}/></main>)}window.setRequestActor=value=>{actor=value;render()};window.setRequestEnabled=value=>{enabled=value;render()};render();`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await readFile('src/app/globals.css','utf8')).replace('@import "tailwindcss";',''),server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/app.js'?'text/javascript':request.url==='/style.css'?'text/css':'text/html');response.end(request.url==='/app.js'?bundle.outputFiles[0].text:request.url==='/style.css'?css:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
const errors=[],writes=[];let external=0;
try{
 await mkdir('output/netcash-refund-requests',{recursive:true});
 for(const width of [1440,768,390,320]){
  const context=await browser.newContext({viewport:{width,height:1100},timezoneId:'America/New_York'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const evidence=actorId=>({actorId,at:'2026-10-16T04:00:01Z',reference:'Synthetic independent evidence'}),id='netcash-refund:'+'1'.repeat(64);
  const base={id,facilityId:'store-a',accountId:'account',adjustmentId:'adjustment',paymentId:'payment',amount:'60.00',state:'RESERVED',revision:3,createdAt:'2026-10-16T04:00:00Z',preparedById:'original-preparer',review:evidence('original-reviewer'),reservation:evidence('original-reviewer'),releaseRequest:null,releaseReview:null,manualPayoutHeld:true,providerAttempted:false,dispatchAvailable:false,financialPosting:false,retryAvailable:false,attempt:null};
  const draft=()=>({id:'netcash-refund-attempt:'+'1'.repeat(64),refundId:id,facilityId:'store-a',revision:1,state:'PREPARED',created:evidence('sender'),review:null,claimAt:null,claimRetained:false,providerOutcome:'NOT_CLAIMED',providerCode:null,responseComplete:null,financialPosting:false,retryAvailable:false});
  let row={...base},mode='UNKNOWN',malformed=false;
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external++;return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(request.method()==='GET')return route.fulfill({json:{data:{rows:[malformed?{...row,providerAttempted:false}:row],nextCursor:null}}});
   assert.equal(url.pathname,'/api/v1/adjustments/netcash-refunds/requests');const body=request.postDataJSON();writes.push({width,...body});assert.equal(body.refundId,id);assert.equal(body.reservationRevision,3);assert.equal(body.confirmed,true);
   if(body.action==='prepare-send'){assert.equal(body.confirmation,'PREPARE REFUND REQUEST');row={...row,attempt:draft()};}
   else if(body.action==='review-send'){assert.equal(body.confirmation,'APPROVE REFUND REQUEST');row={...row,attempt:{...row.attempt,state:'REVIEWED',revision:2,review:evidence('reviewer')}};}
   else{
    assert.equal(body.action,'send');assert.equal(body.confirmation,'REQUEST NETCASH REFUND');row={...row,providerAttempted:true,attempt:{...row.attempt,state:mode==='LOST'?'CLAIMED':'RESULT_RETAINED',revision:mode==='LOST'?3:4,claimRetained:true,claimAt:'2026-10-16T04:02:00Z',providerOutcome:mode==='LOST'?'CLAIMED_NO_VERIFIED_RESULT':mode,providerCode:mode==='ACKNOWLEDGED_PENDING_MERCHANT'?'000':mode==='DUPLICATE_OWNERSHIP_UNKNOWN'?'330':null,responseComplete:mode==='LOST'?null:mode!=='UNKNOWN'}};
    if(mode==='LOST')return route.fulfill({status:503,json:{error:{message:'The result is unverified. Refresh retained history; do not resend.'}}});
   }
   await new Promise(resolve=>setTimeout(resolve,60));return route.fulfill({status:body.action==='send'?202:200,json:{data:{...row.attempt,...(body.action==='send'?{resultRetained:true,lastGuardPassed:true}:{})}}});
  });
  await page.goto(origin);await expect(page.getByRole('heading',{name:'R60.00 — reserved',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Prepare provider request',exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.setRequestEnabled(true));
  async function act(label,confirmation){
   await page.getByRole('button',{name:label,exact:true}).click();const form=page.getByRole('form',{name:'Confirm provider refund request'});await form.getByLabel('Provider request reference',{exact:true}).fill('Synthetic explicit request review');await form.getByRole('checkbox').check();const submit=form.getByRole('button',{name:'Confirm '+label.toLowerCase(),exact:true});await expect(submit).toBeDisabled();await form.getByLabel('Provider request confirmation',{exact:true}).fill(confirmation);await submit.evaluate(button=>{button.click();button.click();});
  }
  await act('Prepare provider request','PREPARE REFUND REQUEST');await expect(page.getByRole('heading',{name:'Provider request — prepared',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Review provider request',exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.setRequestActor('reviewer'));await act('Review provider request','APPROVE REFUND REQUEST');await expect(page.getByRole('heading',{name:'Provider request — reviewed',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Request refund from Netcash',exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.setRequestActor('sender'));await act('Request refund from Netcash','REQUEST NETCASH REFUND');await expect(page.getByRole('heading',{name:'Provider request — result retained',exact:true})).toBeVisible();await expect(page.getByText('The provider outcome is unknown. Keep the refund held; do not resend.',{exact:false}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Request hold release',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Request refund from Netcash',exact:true})).toHaveCount(0);await expect(page.getByText('No provider request has been claimed in Stor24.',{exact:false})).toHaveCount(0);
  await page.evaluate(()=>window.setRequestEnabled(false));await expect(page.getByRole('heading',{name:'Provider request — result retained',exact:true})).toBeVisible();await page.evaluate(()=>window.setRequestEnabled(true));
  for(const next of ['ACKNOWLEDGED_PENDING_MERCHANT','DUPLICATE_OWNERSHIP_UNKNOWN','LOST']){
   mode=next;row={...base,attempt:{...draft(),state:'REVIEWED',revision:2,review:evidence('reviewer')}};await page.getByRole('button',{name:'Refresh retained history',exact:true}).click();await expect(page.getByRole('heading',{name:'Provider request — reviewed',exact:true})).toBeVisible();await act('Request refund from Netcash','REQUEST NETCASH REFUND');
   await expect(page.getByRole('heading',{name:next==='LOST'?'Provider request — claimed':'Provider request — result retained',exact:true})).toBeVisible();
   if(next==='ACKNOWLEDGED_PENDING_MERCHANT')await expect(page.getByText('Merchant authorization and payout confirmation remain outstanding.',{exact:false}).first()).toBeVisible();
   if(next==='DUPLICATE_OWNERSHIP_UNKNOWN')await expect(page.getByText('Ownership is unknown.',{exact:false}).first()).toBeVisible();
   await expect(page.getByRole('button',{name:'Request hold release',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Request refund from Netcash',exact:true})).toHaveCount(0);
  }
  const expectedTime=new Date(row.attempt.created.at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'});await expect(page.getByText('Requested '+expectedTime+' SAST.',{exact:false})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Refund request overflow ${width}`);await page.screenshot({path:`output/netcash-refund-requests/request-${width}.png`,fullPage:true});
  malformed=true;await page.getByRole('button',{name:'Refresh retained history',exact:true}).click();await expect(page.getByRole('alert')).toBeFocused();await expect(page.getByRole('heading',{name:'R60.00 — reserved',exact:true})).toHaveCount(0);assert.equal(writes.filter(value=>value.width===width).length,6);await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(external,0);console.log(JSON.stringify({result:'PASS',widths:[1440,768,390,320],syntheticPosts:writes.length,providerCalls:0,financialWrites:0,coverage:['default off','separate independent SEND review','typed request','duplicate click suppression','claimed/unknown truth','acknowledgement not payout','duplicate ownership hold','lost response history recovery','flag-off history','no V1 release/replay after claim','SAST outside SAST zone','contradictory history clears and focuses','no overflow']}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
