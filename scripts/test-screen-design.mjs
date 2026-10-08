/** Actual staff pages with isolated, invented service results. No production connections. */
import {build} from "esbuild";
import {chromium,expect} from "@playwright/test";
import {createServer} from "node:http";
import {readFile,mkdir} from "node:fs/promises";
import assert from "node:assert/strict";
const root=process.cwd();
const mock=`
const kpis={newLeadsThisWeek:8,activeTenancies:128,totalUnits:200,occupiedUnits:128,occupancyPct:64,monthToDateBilled:184000,monthToDateCollected:162000,collectionsRatePct:88,leadsThisMonth:24,wonThisMonth:6,conversionRatePct:25};
export const getDashboardKpis=async()=>kpis;
export const getOperationsHome=async()=>({metrics:{...kpis,receivables:12400,overdueAccounts:3,activeLeads:8},queue:{expiringReservations:2,dueTasks:4,followUpLeads:3},activity:[{id:'fixture',occurredAt:new Date('2026-10-03T08:00:00Z'),action:'reservation.created',entityType:'Reservation',facility:{name:'Training store'},actor:{name:'Example Staff'}}]});
export const getPipelineByStage=async()=>['New','Contacted','Qualified','Quoted','Reserved','Won'].map((label,i)=>({label,stage:label,count:18-i*3}));
export const getLeadsLast7Days=async()=>['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((label,i)=>({label,count:[2,5,3,8,2,4,1][i]}));
export const getOccupancyTrend=async()=>['Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct'].map((label,i)=>({label,value:45+i*1.8}));
export const getRevenueTrend=async()=>['Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct'].map((label,i)=>({label,billed:130000+i*5000,collected:120000+i*4500}));
export const getUnitStatsByFacility=async()=>[{facilityId:'fixture',facilityName:'Training store',total:200,available:60,reserved:12,occupied:128,service:0,occupancyPct:64}];
export const requireScope=async()=>({organisationId:'fixture',unrestrictedFacilities:true});
export const requirePermissionScope=requireScope;
export const facilityWhere=()=>({});
export const requireSession=async()=>({permissions:location.search.includes('restricted')?['operations.view']:['*'],user:{roleAssignments:[{facilityId:null,role:{name:location.search.includes('restricted')?'Operations':'Organisation owner',permissions:location.search.includes('restricted')?['operations.view']:['*']}}]}});
export const netCollectionTotal=async()=>162000;
export const getWhatsAppAutomationState=async()=>({enabled:false,serverGateEnabled:false});
export const listHikCentralConfiguration=async()=>({company:{endpoint:"",appKeyConfigured:false,appSecretConfigured:false,status:"DISCONNECTED",failureMessage:null},facilities:[]});
export const db={document:{findMany:async()=>[]},webhookInbox:{groupBy:async()=>[{status:'PROCESSED',_count:369}]},webhookOutbox:{groupBy:async()=>[{status:'PENDING',_count:18}]},communicationLog:{findMany:async()=>[]},auditEvent:{findMany:async()=>[]},account:{aggregate:async()=>({_sum:{balance:12400}})},tenancy:{count:async()=>128},facility:{findMany:async()=>[{id:'fixture',name:'Training store'}]}};
export const getOperationsCalendar=async()=>Array.from({length:7},(_,i)=>({key:'2026-10-'+String(i+3).padStart(2,'0'),items:i%2===0?[{id:'task'+i,kind:'task',at:new Date('2026-10-03T10:00:00Z'),title:'Example follow-up',detail:'Training store',href:'/leads?lead=fixture'}]:[]}));
`;
const bundle=await build({entryPoints:['tests/browser/screen-design-fixture.jsx'],bundle:true,write:false,outdir:'output/screen-redesign/bundle',define:{'process.env':'{}'},format:'esm',jsx:'automatic',plugins:[{name:'design-fixture',setup(b){
 // Resolve only the server data boundary; render the real shared panel in the
 // browser fixture, without importing Prisma or pretending React client-side
 // rendering can execute an async Server Component.
 b.onResolve({filter:/^@\/components\/operations-reminders$/},a=>({path:a.path,namespace:'reminder-data'}));
 b.onLoad({filter:/.*/,namespace:'reminder-data'},()=>({loader:'jsx',resolveDir:root,contents:`
 import React from 'react';
 import {OperationsRemindersPanel} from './src/components/operations-reminders-panel';
 export function OperationsReminders(){
 const rows=[
 {label:'Reminders',description:'Open tasks due today or overdue',href:'/operations#operations-tasks',count:3},
 {label:'Call past dues',description:'Due collection follow-ups',href:'/collections',count:1},
 {label:'Reorder',description:'Available stock at threshold',href:'/operations/merchandise',count:5},
 {label:'Move-out',description:'Notice-given tenancies due',href:'/operations/accounts',count:0},
 {label:'Service required',description:'Open maintenance',href:'/operations#operations-maintenance',count:0}];
 return <OperationsRemindersPanel items={location.search.includes('restricted')?rows.filter(r=>['Reminders','Service required'].includes(r.label)):rows} updatedAt={new Date('2026-10-08T05:00:00Z')}/>;
 }` }));
 b.onResolve({filter:/^next\/(link|image|navigation)$/},a=>({path:a.path,namespace:'next-stub'}));
 b.onLoad({filter:/.*/,namespace:'next-stub'},a=>({loader:'jsx',resolveDir:root,contents:a.path==='next/navigation'?`export const usePathname=()=>location.pathname;export const useRouter=()=>({replace(h){location.href=h},refresh(){}});`:a.path==='next/image'?`import React from 'react';export default function Image({priority,fill,...props}){return <img {...props}/>}`:`import React from 'react';export default function Link(props){return <a {...props}/>}`}));
 b.onResolve({filter:/^@\/lib\/(dashboard-service|scope|db|auth-guards|calendar-service|finance\/collection-total|integrations\/whatsapp-automation|integrations\/hikcentral-configuration)$/},a=>({path:a.path,namespace:'services'}));
 b.onLoad({filter:/.*/,namespace:'services'},()=>({contents:mock,loader:'js'}));
}}]});
const css=(await Promise.all(['src/app/globals.css','src/styles/stor24-brand.css','src/styles/guided-help.css','src/styles/staff-workspace.css','src/styles/workspace-insights.css'].map(p=>readFile(p,'utf8')))).join('\n').replace('@import "tailwindcss";','');
const writes=[];
const server=createServer(async(req,res)=>{
 if(req.method!=='GET'){writes.push(req.url);res.writeHead(405);return res.end();}
 if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles.find(x=>x.path.endsWith('.js'))?.text??bundle.outputFiles[0].text)}
 if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');return res.end(css+'\n'+(bundle.outputFiles.find(x=>x.path.endsWith('.css'))?.text??''))}
 if(req.url==='/brand/stor24-logo-white.svg'){res.setHeader('content-type','image/svg+xml');return res.end(await readFile('public/brand/stor24-logo-white.svg'))}
 if(req.url==='/brand/Satoshi-Variable.ttf'){res.setHeader('content-type','font/ttf');return res.end(await readFile('public/brand/Satoshi-Variable.ttf'))}
 if(req.url==='/api/v1/reports/builder'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:{datasets:[{key:'units',name:'Units & prices',group:'Units',grain:'One unit',basis:'Synthetic inventory fixture',fields:[{key:'facility',label:'Store',type:'text'},{key:'unit',label:'Unit',type:'text'}]}],templates:[{key:'price-list',name:'Price list',group:'Units',dataset:'units'},{key:'ageing',name:'Aged receivables',group:'Finance',legacyKey:'receivables-ageing'}],saved:[],schedules:[],runs:[],history:[]}}))}
 if(req.url.startsWith('/api/')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[]}))}
 res.setHeader('content-type','text/html');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>@font-face{font-family:Satoshi;src:url(/brand/Satoshi-Variable.ttf);font-weight:300 900}body{--font-satoshi:Satoshi}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
if(process.env.PREVIEW_ONLY){console.log('Design preview: '+base)}else{
 const browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page failure:',e.message)});
 try{
  await mkdir('output/screen-redesign/design',{recursive:true});
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:1000});
   for(const [route,title] of [['/','Stor24 operational overview'],['/billing','Billing & payments'],['/calendar','Calendar'],['/graphs','Performance overview'],['/reports','Reports'],['/settings','Settings'],['/integrations','Integrations & webhooks']]){
    await page.goto(base+route);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' overflow '+width);
    if(route==='/billing'){await expect(page.getByRole('heading',{name:'Bill & collect'})).toBeVisible();assert.equal(await page.locator('.finance-workstream .module-card').count(),10)}
    if(route==='/'){await expect(page.getByRole('img',{name:/Physical occupancy 64.0 percent/})).toBeVisible();assert.equal(await page.locator('.daily-workflow').count(),4);await expect(page.getByRole('region',{name:'Operations reminders'})).toBeVisible();assert.equal(await page.getByRole('region',{name:'Operations reminders'}).getByRole('link').count(),5)}
    if(route==='/graphs'){await expect(page.getByRole('img',{name:/Nov: 45%/})).toBeVisible();assert.equal(await page.locator('.daily-leads-chart small').count(),7)}
    if(route==='/reports'){await expect(page.getByRole('heading',{name:'Report library',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Units reports',exact:true})).toBeVisible();const ageing=page.getByRole('region',{name:'Finance reports',exact:true}).getByRole('link',{name:'View online and download',exact:true});await expect(ageing).toHaveAttribute('href','/reports?reportKey=receivables-ageing');await ageing.click();await page.getByRole('button',{name:'Select Receivables ageing',exact:true}).click();await expect(page.getByLabel('Report',{exact:true})).toHaveValue('receivables-ageing');await expect(page.getByLabel('As of (SAST)')).toBeVisible()}
    await page.screenshot({path:'output/screen-redesign/design/'+(route==='/'?'home':route.slice(1))+'-'+width+'.png',fullPage:true});
   }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/');
  const expandedWidth=await page.locator('.app-main').evaluate(e=>e.getBoundingClientRect().width);
  await page.getByRole('button',{name:'Hide menu',exact:true}).click();
  await expect(page.locator('#staff-sidebar')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Show menu',exact:true})).toHaveAttribute('aria-expanded','false');
  assert.ok(await page.locator('.app-main').evaluate(e=>e.getBoundingClientRect().width)>expandedWidth+200);
  await page.goto(base+'/billing');
  await expect(page.locator('#staff-sidebar')).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'Show menu',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:1000});
  await expect(page.locator('.staff-mobile-nav')).toBeVisible();
  await expect(page.locator('.sidebar-toggle')).not.toBeVisible();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Show menu',exact:true}).press('Enter');
  await expect(page.locator('#staff-sidebar')).toBeVisible();
  await expect(page.getByRole('button',{name:'Hide menu',exact:true})).toBeFocused();
  await page.reload();
  await expect(page.locator('#staff-sidebar')).toBeVisible();
  const storageBlocked=await browser.newPage({viewport:{width:1440,height:1000}});
  await storageBlocked.addInitScript(()=>{Storage.prototype.setItem=function(){throw new Error('Storage blocked for isolated test')};});
  await storageBlocked.goto(base+'/');
  await storageBlocked.getByRole('button',{name:'Hide menu',exact:true}).click();
  await expect(storageBlocked.locator('#staff-sidebar')).not.toBeVisible();
  await storageBlocked.getByRole('button',{name:'Show menu',exact:true}).click();
  await expect(storageBlocked.locator('#staff-sidebar')).toBeVisible();
  await storageBlocked.close();
  await page.goto(base+'/?restricted');
  await expect(page.getByRole('link',{name:/Explore inventory/})).toHaveCount(0);
  await expect(page.locator('.portfolio-signal[href="/collections"]')).toHaveCount(0);
  await expect(page.locator('.daily-workflow[href="/reports"]')).toHaveCount(0);
  await expect(page.locator('.portfolio-signal[href="/tenants"]')).toBeVisible();
  assert.equal(await page.getByRole('region',{name:'Operations reminders'}).getByRole('link').count(),2);
  await expect(page.getByRole('region',{name:'Operations reminders'}).getByRole('link',{name:/Call past dues|Reorder|Move-out/})).toHaveCount(0);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('Seven actual pages pass design/real-value/layout checks at five widths; no writes.');
 }finally{await browser.close();server.close()}
}
