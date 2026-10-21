import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{LeadsWorkspace}from'./src/components/leads-workspace';createRoot(document.getElementById('root')).render(<LeadsWorkspace followupsDue={new URLSearchParams(location.search).get(\"view\")===\"due\"}/>);",resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic'});
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/staff-workspace.css','src/styles/workspace-insights.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','')+'\n@font-face{font-family:Satoshi;src:url(/satoshi.ttf);font-weight:300 900}html{--font-satoshi:Satoshi}body{display:block;padding:24px;background:#f4f6f3}@media(max-width:600px){body{padding:12px}}';
let stage,bookings,patch,reservation,capture,rejectReservation,newLead,refreshFailed;
let bulk,bulkError=false,bulkRefreshFailed=false,readOnly=false,bulkClosed=new Set();
const booking=(extra={})=>({id:'saved/booking',status:'ACTIVE',journey:'RENTAL',quotedRate:1400,convertedTenancyId:null,unit:{number:'101'},publicLease:null,convertedTenancy:null,...extra});
const make=()=>({leads:[...Array.from({length:8},(_,i)=>({id:`lead${i}`,stage:bulkClosed.has(`lead${i}`)?'LOST':i===0?stage:['NEW','CONTACTED','QUALIFIED','QUOTED','VIEWING_BOOKED','RESERVED','WON','LOST'][i],source:i%2?'Phone':'PUBLIC_QUOTE_FORM',createdAt:new Date(Date.now()-i*7*86400000).toISOString(),updatedAt:'2026-10-02T08:00:00Z',notes:'Household furniture',expectedMoveIn:'2026-10-15T00:00:00Z',nextActionAt:null,assignedToId:null,assignedTo:null,facility:{id:'store',name:'Midpoint'},desiredUnitType:{name:'10 m²'},customer:{id:`customer${i}`,firstName:`Example ${i+1}`,lastName:'Customer',email:'example@example.invalid',phone:'+27000000000',companyName:null},attribution:null,reservations:i===0?bookings:[]})),...(newLead?[newLead]:[])],count:newLead?9:8,facilities:[{id:'store',name:'Midpoint',canCreate:true,canManage:!readOnly,canReserve:true}],staff:[{id:'staff',name:'Example Sales Owner',facilityIds:['store']}]});
const server=createServer(async(req,res)=>{
 if(req.url==='/satoshi.ttf'){res.setHeader('Content-Type','font/ttf');return res.end(await readFile('public/brand/Satoshi-Variable.ttf'));}
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text);}
 if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
 if(req.url.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='PATCH'||req.method==='POST'){
   let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
   if(req.url==='/api/v1/leads/cancel-tests'){
    bulk=body;
    if(bulkError){res.statusCode=409;return res.end(JSON.stringify({error:{message:'Nothing was cancelled. An enquiry changed. Reload and review your selection.'}}));}
    for(const lead of body.leads)bulkClosed.add(lead.id);
    if(bulkRefreshFailed)refreshFailed=true;
    return res.end(JSON.stringify({data:{count:body.leads.length}}));
   }
   if(req.method==='PATCH'){patch=body;stage=patch.stage;}
   else if(req.url==='/api/v1/leads'){
    capture=body;newLead={...make().leads[0],id:'new-lead',stage:'NEW',reservations:[],customer:{id:body.customerId||'new-customer',firstName:body.firstName||'Existing',lastName:body.lastName||'Customer',phone:'+27000000000',email:null,companyName:null}};
    return res.end(JSON.stringify({data:{id:'new-lead'}}));
   }else{
    if(rejectReservation){res.statusCode=409;return res.end(JSON.stringify({error:{message:'This unit is no longer available. Choose another unit.'}}));}
    reservation=body;stage='RESERVED';bookings=[booking()];
   }
   return res.end(JSON.stringify({data:{id:'saved/booking'}}));
  }
  if(req.url.startsWith('/api/v1/leads/workspace')){if(refreshFailed){res.statusCode=503;return res.end('{}');}const view=make();if(req.url.includes('view=due')){view.leads=patch?.nextActionAt?[]:[{...view.leads[0],createdAt:'2020-01-01T00:00:00Z',nextActionAt:'2026-01-01T10:00:00Z'}];view.count=view.leads.length;}return res.end(JSON.stringify({data:view}));}
  if(req.url.startsWith('/api/v1/leads/customers?'))return res.end(JSON.stringify({data:[{id:'existing',firstName:'Existing',lastName:'Customer',companyName:null,email:'existing@example.invalid',phone:'+27000000000'}]}));
  if(req.url==='/api/v1/reservations')return res.end(JSON.stringify({data:{facilities:[{id:'store',units:[{id:'unit',facilityId:'store',number:'101',monthlyRate:'1400'}],maps:[{id:'map',name:'Ground floor',width:600,height:400,elements:[{id:'shape',type:'UNIT',x:20,y:20,width:100,height:80,rotation:0,label:'101',unitId:'unit'},{id:'closed',type:'UNIT',x:140,y:20,width:100,height:80,rotation:0,label:'102',unitId:'blocked'}]}]}]}}));
  return res.end(JSON.stringify({data:[]}));
 }
 res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body class="app-shell"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();await mkdir('output/leads-design',{recursive:true});
try{
 for(const width of [1440,390,320]){
  stage='NEW';bookings=[];newLead=null;rejectReservation=false;refreshFailed=false;
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);await expect(page.getByRole('heading',{name:'Leads & sales performance'})).toBeVisible();await expect(page.locator('.leads-name')).toHaveCount(8);
  if(!await page.locator('.leads-search').evaluate(label=>{const input=label.querySelector('input'),icon=label.querySelector('svg');return input.getBoundingClientRect().left+parseFloat(getComputedStyle(input).paddingLeft)>icon.getBoundingClientRect().right+4;}))throw Error('Search text overlaps the icon');
  await expect(page.locator('.profile-card-heading').first()).toContainText('8 enquiries');
  await expect(page.getByRole('button',{name:'Cancel selected tests',exact:true})).toBeDisabled();
  await page.locator('.leads-register').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`output/leads-design/bulk-worklist-${width}.png`,fullPage:false});
  await expect(page.getByRole('checkbox',{name:'Select enquiry Example 6 Customer (lead5)',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Select enquiry Example 1 Customer (lead0)',exact:true}).check();
  await page.getByLabel('Search leads',{exact:true}).fill('Example 2');
  await expect(page.getByText('0 selected',{exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'Select all eligible enquiries shown',exact:true}).check();
  await expect(page.getByText('1 selected',{exact:true})).toBeVisible();
  await page.getByLabel('Search leads',{exact:true}).fill('');
  await expect(page.getByText('0 selected',{exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'Select enquiry Example 1 Customer (lead0)',exact:true}).check();
  await page.getByRole('checkbox',{name:'Select enquiry Example 2 Customer (lead1)',exact:true}).focus();await page.keyboard.press('Space');
  await page.locator('.leads-register').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:`output/leads-design/bulk-worklist-selected-${width}.png`,fullPage:false});
  await page.getByRole('button',{name:'Cancel selected tests',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Cancel 2 selected test enquiries?',exact:true})).toBeVisible();
  await expect(page.locator('.leads-cancel-review li')).toHaveCount(2);
  await page.screenshot({path:`output/leads-design/bulk-cancel-review-${width}.png`,fullPage:false});
  await page.getByRole('button',{name:'Keep enquiries',exact:true}).click();if(bulkClosed.size)throw Error('Review cancel wrote records');
  await page.getByRole('button',{name:'Cancel selected tests',exact:true}).click();bulkError=true;
  await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Nothing was cancelled');
  if(bulkClosed.size)throw Error('Rejected bulk cancellation changed records');
  bulkError=false;await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('2 test enquiries closed as Lost.',{exact:true})).toBeVisible();
  if(JSON.stringify(bulk.leads.map(l=>l.id))!==JSON.stringify(['lead0','lead1'])||bulk.confirmed!==true||bulk.leads.some(l=>!l.updatedAt))throw Error('Bulk action did not use exact selected IDs and versions');
  if(bulkClosed.has('lead2'))throw Error('Unselected enquiry was closed');
  await expect(page.getByRole('checkbox',{name:'Select enquiry Example 1 Customer (lead0)',exact:true})).toBeDisabled();
  bulkClosed.clear();bulk=null;await page.reload();
  await page.getByRole('checkbox',{name:'Select enquiry Example 1 Customer (lead0)',exact:true}).check();
  await page.getByRole('button',{name:'Cancel selected tests',exact:true}).click();
  await page.route('**/api/v1/leads/cancel-tests',route=>route.abort());
  await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Cancellation could not be confirmed');
  await expect(page.getByRole('button',{name:'Confirm cancellation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Keep enquiries',exact:true}).click();await page.unroute('**/api/v1/leads/cancel-tests');
  await page.getByRole('button',{name:'Reload saved enquiries',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select enquiry Example 1 Customer (lead0)',exact:true}).check();
  await page.getByRole('button',{name:'Cancel selected tests',exact:true}).click();bulkRefreshFailed=true;
  await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('Cancelled, but');
  await expect(page.getByRole('button',{name:'Cancel selected tests',exact:true})).toBeDisabled();
  bulkRefreshFailed=false;refreshFailed=false;bulkClosed.clear();readOnly=true;await page.reload();
  await expect(page.getByRole('button',{name:'Cancel selected tests',exact:true})).toHaveCount(0);
  readOnly=false;await page.reload();
  console.log(`${width}px: exact multi-selection, filtered select-all, filter reset, review, rejection, cancellation, lost-response recovery, refresh-failure guard and read-only access passed`);
  await page.getByRole('button',{name:'Example 1 Customer',exact:true}).click();
  const nav=page.getByRole('navigation',{name:'Lead to lease progress'});await expect(nav.locator('li')).toHaveCount(4);
  await expect(page.getByRole('heading',{name:'Activity history'})).toBeVisible();
  await expect(nav.getByRole('button',{name:/Lease agreement/})).toBeDisabled();
  await page.getByLabel('Needed date / expected move-in').fill('2026-11-01');
  await page.getByLabel('Sales stage',{exact:true}).selectOption('CONTACTED');await page.getByLabel('Assigned owner').selectOption('staff');await page.getByLabel('Next follow-up (South Africa time)').fill('2026-10-12T14:30');
  await page.getByLabel('Enquiry city / town').fill('Pretoria');await page.getByLabel('Enquiry postal code').fill('0081');await page.screenshot({path:`output/leads-design/enquiry-origin-${width}.png`,fullPage:false});
  await page.getByRole('button',{name:'Save & continue to unit',exact:true}).click();
  if(patch.expectedMoveIn!=='2026-11-01')throw Error('Needed date was not saved');
  if(patch.enquiryLocation.city!=='Pretoria'||patch.enquiryLocation.postalCode!=='0081')throw Error('Optional enquiry origin was not retained in update request');
  await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Choose and reserve storage space'})).toBeVisible();
  if(patch.stage!=='CONTACTED'||patch.nextActionAt!=='2026-10-12T12:30:00.000Z')throw Error('Stage or SAST payload mismatch');
  await page.getByRole('button',{name:'Choose an available unit',exact:true}).click();
  await page.getByRole('button',{name:'Select unit 101, R 1400 per month'}).focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Available unit')).toHaveValue('unit');
  await expect(page.getByLabel('Intended move-in')).toHaveValue('2026-10-15');
  await page.getByLabel('Monthly quote (R)').fill('0');await page.getByRole('button',{name:'Confirm reservation',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('greater than zero');await page.getByLabel('Monthly quote (R)').fill('1400');
  rejectReservation=true;await page.getByRole('button',{name:'Confirm reservation',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('no longer available');await expect(page.getByLabel('Available unit')).toHaveValue('unit');
  rejectReservation=false;await page.getByRole('button',{name:'Confirm reservation',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review and sign the lease agreement'})).toBeVisible();
  if(reservation.leadId!=='lead0'||reservation.customerId!=='customer0'||reservation.unitId!=='unit')throw Error('Lost enquiry/customer/unit context');
  await expect(page.getByRole('link',{name:'Continue to agreement details'})).toHaveAttribute('href','/operations/move-in?reservation=saved%2Fbooking');
  await page.screenshot({path:`output/leads-design/lease-step-${width}.png`,fullPage:false});
  await nav.getByRole('button',{name:/Move in/}).click();await expect(page.getByRole('link',{name:'Review agreement status'})).toBeVisible();
  await page.getByRole('button',{name:'Close enquiry'}).click();
  bookings=[booking({publicLease:{id:'lease',status:'SIGNED',signedAt:'2026-10-01',signedPdfSha256:'hash'}})];await page.reload();await page.getByRole('button',{name:'Example 1 Customer',exact:true}).click();await nav.getByRole('button',{name:/Lease agreement/}).click();
  await expect(page.getByRole('link',{name:'View signed agreement',exact:true})).toHaveAttribute('href','/api/v1/public-leases/lease/signed-pdf');await page.getByRole('button',{name:'Continue to move-in checks'}).click();await expect(page.getByRole('link',{name:'Continue in Move In'})).toHaveAttribute('href','/operations/move-in?reservation=saved%2Fbooking');
  await page.screenshot({path:`output/leads-design/move-in-step-${width}.png`,fullPage:false});
  await page.getByRole('button',{name:'Close enquiry'}).click();
  bookings=[booking({status:'CONVERTED',convertedTenancyId:'tenancy',convertedTenancy:{status:'DRAFT',accountId:'account /1',documents:[]}})];await page.reload();await page.getByRole('button',{name:'Example 1 Customer',exact:true}).click();await nav.getByRole('button',{name:/Lease agreement/}).click();await expect(page.getByRole('link',{name:'Open pending lease & account'})).toHaveAttribute('href','/operations/accounts?accountId=account%20%2F1');
  await page.getByRole('button',{name:'Close enquiry'}).click();
  bookings=[booking({status:'CONVERTED',convertedTenancyId:'tenancy',convertedTenancy:{status:'ACTIVE',accountId:'account',documents:[{id:'staff-lease',status:'SIGNED',signedAt:'2026-10-01'}]}})];await page.reload();await page.getByRole('button',{name:'Example 1 Customer',exact:true}).click();await expect(nav).toContainText(/Active tenancy.*check handover/);await expect(nav.locator('li.is-complete')).toHaveCount(3);await page.getByRole('button',{name:'Close enquiry'}).click();
  bookings[0].handedOver=true;await page.reload();await page.getByRole('button',{name:'Example 1 Customer',exact:true}).click();await expect(nav).toContainText('Key handover recorded');await expect(nav.locator('li.is-complete')).toHaveCount(4);await page.getByRole('button',{name:'Close enquiry'}).click();
  bookings=[booking(),booking({id:'second',unit:{number:'102'}})];await page.reload();await page.getByRole('button',{name:'Example 1 Customer',exact:true}).click();await nav.getByRole('button',{name:/Choose unit/}).click();await expect(page.getByLabel('Booking to continue')).toHaveValue('');await page.getByLabel('Booking to continue').selectOption('second');await page.getByRole('button',{name:'Continue to lease agreement'}).click();await expect(page.getByRole('link',{name:'Continue to agreement details'})).toHaveAttribute('href','/operations/move-in?reservation=second');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Page overflow');
  await page.getByRole('button',{name:'Close enquiry'}).click();
  await page.getByRole('button',{name:'Add enquiry',exact:true}).click();await page.getByLabel('Store',{exact:true}).selectOption('store');await page.getByLabel('Customer choice').selectOption('new');await page.getByLabel('First name',{exact:true}).fill('New');await page.getByLabel('Last name',{exact:true}).fill('Customer');await page.getByLabel('Mobile / phone').fill('+27000000000');await page.getByLabel('Enquiry source').selectOption('Other');await page.getByLabel('How did the customer find us?').fill('Local school newsletter');await page.getByRole('button',{name:'Save enquiry & continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Choose and reserve storage space'})).toBeVisible();if(capture.customerId||capture.firstName!=='New'||!capture.submissionId)throw Error('New customer capture mismatch');
  await page.getByRole('button',{name:'Close enquiry'}).click();await page.getByRole('button',{name:'Add enquiry',exact:true}).click();await page.getByLabel('Store',{exact:true}).selectOption('store');await page.getByLabel('Find existing customer').fill('Existing');await page.getByRole('button',{name:'Existing Customer +27000000000'}).click();await page.getByLabel('Enquiry source').selectOption('Phone in');await page.getByRole('button',{name:'Save enquiry & continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Choose and reserve storage space'})).toBeVisible();if(capture.customerId!=='existing'||capture.firstName||capture.source!=='Phone in')throw Error('Existing customer capture mismatch');
  await nav.getByRole('button',{name:/Customer & enquiry/}).click();refreshFailed=true;await page.getByRole('button',{name:'Save & continue to unit',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Saved, but');await expect(page.getByRole('button',{name:'Save & continue to unit',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Close enquiry'})).toBeEnabled();await page.getByRole('button',{name:'Close enquiry'}).click();await expect(page.getByRole('button',{name:'Reload saved enquiries'})).toBeVisible();refreshFailed=false;await page.getByRole('button',{name:'Reload saved enquiries'}).click();await expect(page.getByRole('heading',{name:'Leads & sales performance'})).toBeVisible();
  if(errors.length)throw Error(errors.join('\n'));
  console.log(`${width}px: four stages, customer context, saved reservation, signing evidence, pending account, multiple bookings, conflict recovery, keyboard and viewport passed`);await page.close();
 }
 const duePage=await browser.newPage({viewport:{width:390,height:900}});stage='NEW';bookings=[];newLead=null;patch=null;
 await duePage.goto(`http://127.0.0.1:${server.address().port}/?view=due`);await expect(duePage.locator('.leads-name')).toHaveCount(1);await duePage.getByRole('button',{name:'Example 1 Customer',exact:true}).click();await duePage.getByLabel('Next follow-up (South Africa time)').fill('2099-11-01T10:00');await duePage.getByRole('button',{name:'Save follow-up',exact:true}).click();await expect(duePage.getByRole('dialog')).toHaveCount(0);await expect(duePage.locator('.leads-name')).toHaveCount(0);await expect(duePage.getByRole('button',{name:'Reload saved enquiries'})).toHaveCount(0);console.log('Due lead queue: old enquiry visible, rescheduling removes reminder without false refresh failure');await duePage.close();
}finally{await browser.close();server.close();}

