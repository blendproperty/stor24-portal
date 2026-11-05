import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const bundle = await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {CustomerOperationsWorkspace} from './src/components/customer-operations-workspace'; createRoot(document.getElementById('root')).render(<CustomerOperationsWorkspace initialCustomerId={new URLSearchParams(location.search).get('customer') || ''}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'esm',jsx:'automatic',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^next\/link$/},a=>({path:a.path,namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from 'react'; export default function Link(p){return React.createElement('a',p)}",loader:'jsx',resolveDir:process.cwd()}));}}]});
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<div id="root"></div><script type="module" src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
const base={type:'INDIVIDUAL',lastName:null,companyName:null,email:null,phone:null,identityRef:null,taxNumber:null,dateOfBirth:null,notes:null,billingAddress:null,alternateContact:null,workContact:null,emergencyContact:null,communicationConsent:null,leads:[],reservations:[]};
const tenancy=(status,handedOver)=>({id:'t',status,handedOver,startDate:'2026-11-05',endDate:null,facility:{name:'Store 1 - Midpoint'},account:{accountNumber:'synthetic',balance:'0'},occupancies:[]});
const records=[{...base,id:'lead',firstName:'Lead',tenancies:[]},{...base,id:'draft',firstName:'Draft',tenancies:[tenancy('DRAFT',false)]},{...base,id:'signed',firstName:'Signed',tenancies:[tenancy('ACTIVE',false)]},{...base,id:'moved',firstName:'Moved',tenancies:[tenancy('ACTIVE',true)]},{...base,id:'notice',firstName:'Notice',tenancies:[tenancy('NOTICE_GIVEN',true)]},{...base,id:'closed',firstName:'Closed',tenancies:[tenancy('CLOSED',true)]}];
try {
 const page=await browser.newPage();let writes=0;
 await page.route('**/api/v1/leasing/customers',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:{data:records}})});
 await page.route('**/api/v1/customers/*/history**',route=>route.fulfill({json:{data:{entries:[],nextCursor:null,facilities:[],writableFacilities:[],visibility:{communications:true,collections:true},legacyNotes:null}}}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await expect(page.getByRole('heading',{name:'Moved',exact:true})).toBeVisible();
 for(const name of ['Lead','Draft','Signed','Closed']) await expect(page.locator('aside').getByRole('button',{name:new RegExp(name)})).toHaveCount(0);
 for(const name of ['Moved','Notice']) await expect(page.locator('aside').getByRole('button',{name:new RegExp(name)})).toBeVisible();
 await page.goto(`http://127.0.0.1:${server.address().port}/?customer=lead`);
 await expect(page.getByRole('heading',{name:'Lead',exact:true})).toBeVisible(); await expect(page.getByText(/Lead contact/)).toBeVisible();
 await expect(page.locator('aside').getByRole('button',{name:/Lead/})).toHaveCount(0); assert.equal(writes,0);
 console.log('PASS: only confirmed current handovers in tenant list; draft, signed-only, closed and lead excluded; lead history deep link retained without writes');
} finally {await browser.close();await new Promise(r=>server.close(r));}
