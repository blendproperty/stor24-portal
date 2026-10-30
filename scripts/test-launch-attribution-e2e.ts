/** Isolated browser -> real website routes -> authenticated CRM route -> PostgreSQL -> staff report. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect as baseExpect } from "@playwright/test";
import { db } from "../src/lib/db";
import { POST as crmLead } from "../src/app/api/public/v1/leads/route";
import { GET as crmFacilities } from "../src/app/api/public/v1/facilities/route";
import { marketingWorkspace } from "../src/lib/marketing-service";
import { marketingReport } from "../src/lib/marketing-reporting";

const expect = baseExpect.configure({timeout:30000});

async function main() {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/merchandise_ci");
  assert.ok(process.env.LAUNCH_WEBSITE_ROOT);
  const web = path.resolve(process.env.LAUNCH_WEBSITE_ROOT!);
  for (const file of ["launch-advertising.json", "advertising-attribution.ts"]) assert.equal(await readFile(path.join(web,"app/lib",file),"utf8"),await readFile(path.join("src/lib",file),"utf8"));
  assert.equal(await db.facility.count({where:{active:true,publicBookingEnabled:true}}),0,"Use an empty isolated database");
  const org=await db.organisation.create({data:{name:"Synthetic launch tracking",slug:randomUUID()}});
  const facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic launch store",code:randomUUID(),publicSlug:"fixture",publicBookingEnabled:true}});
  const excluded=await db.facility.create({data:{organisationId:org.id,name:"Excluded store",code:randomUUID()}});
  const scope={organisationId:org.id,userId:"synthetic-launch-reporter",facilityIds:[facility.id],unrestrictedFacilities:false};
  const type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic business unit",useTypes:["STORAGE","MICRO_WAREHOUSE"]}});
  await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"LAUNCH-TEST",floor:"Ground Floor",monthlyRate:1000}});
  process.env.AUTH_SECRET="synthetic-launch-test-auth-secret-over-32-characters";
  process.env.PUBLIC_BOOKING_API_KEY="synthetic-launch-test-public-key-over-32-characters";
  process.env.STOR24_PUBLIC_BOOKING_API_KEY=process.env.PUBLIC_BOOKING_API_KEY;
  process.env.RECAPTCHA_SECRET_KEY="synthetic-provider-boundary-only";
  let quote: (request: Request)=>Promise<Response>, micro: (request: Request)=>Promise<Response>;
  const staffCss=(await Promise.all(["src/app/globals.css","src/styles/stor24-brand.css","src/styles/staff-workspace.css","src/styles/marketing.css","src/styles/workspace-insights.css"].map(file=>readFile(file,"utf8")))).join("\n").replace('@import "tailwindcss";',"")+"\nbody{font-family:Arial,sans-serif;background:#f1f5f8;padding:20px}.marketing-cell-note{display:block}";
  let browserBundle="", staffBundle="", blocked=false;
  const captured: {route:string;response:unknown}[]=[];
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url!,"http://localhost"),chunks:Buffer[]=[];
      for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const request=new Request(`http://127.0.0.1:${(server.address() as {port:number}).port}${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,...(chunks.length?{body:new Uint8Array(Buffer.concat(chunks))}:{})});
      let response:Response;
      if(url.pathname==="/crm/api/public/v1/leads")response=blocked?Response.json({error:"Synthetic unavailable CRM"},{status:503}):await crmLead(request);
      else if(url.pathname==="/crm/api/public/v1/facilities")response=await crmFacilities(request);
      else if(url.pathname==="/api/quote"||url.pathname==="/api/micro-warehousing/enquiry"){
        response=await(url.pathname==="/api/quote"?quote:micro)(request);
        captured.push({route:url.pathname,response:await response.clone().json()});
      } else if(url.pathname==="/n8n-fixture")response=Response.json({accepted:true});
      else if(url.pathname==="/fixture.js"||url.pathname==="/staff.js")response=new Response(url.pathname==="/staff.js"?staffBundle:browserBundle,{headers:{"content-type":"text/javascript"}});
      else if(url.pathname==="/staff.css")response=new Response(staffCss,{headers:{"content-type":"text/css"}});
      else if(url.pathname==="/workspace.json")response=Response.json(await marketingWorkspace(scope));
      else response=new Response(`<html><head><meta name="viewport" content="width=device-width">${url.pathname==="/staff"?'<link rel="stylesheet" href="/staff.css">':""}<style>body{margin:20px}table{border-collapse:collapse}td,th{padding:6px;overflow-wrap:anywhere}input,textarea{max-width:100%}</style></head><body><div id="root"></div><script type="module" src="${url.pathname==="/staff"?"/staff.js":"/fixture.js"}"></script></body></html>`,{headers:{"content-type":"text/html"}});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){console.error(error);res.writeHead(500);res.end("Synthetic fixture failure");}
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const port=(server.address() as {port:number}).port,base=`http://stor24.co.za:${port}`;
  process.env.STOR24_PORTAL_URL=`http://127.0.0.1:${port}/crm`;
  process.env.N8N_WEBHOOK_URL=`http://127.0.0.1:${port}/n8n-fixture`;
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=String(input instanceof Request?input.url:input);
    if(url==="https://www.google.com/recaptcha/api/siteverify")return Response.json({success:true});
    assert.ok(url.startsWith(`http://127.0.0.1:${port}/`),"No external provider transport in fixture");
    return realFetch(input,init);
  };
  const webRequire=createRequire(path.join(web,"package.json"));
  async function route(entry:string){
    const built=await build({absWorkingDir:web,entryPoints:[entry],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"test-server-only",setup(b){b.onResolve({filter:/^server-only$/},()=>({path:"empty",namespace:"test"}));b.onLoad({filter:/.*/,namespace:"test"},()=>({contents:""}));}}]});
    const loaded={exports:{} as {POST:(request:Request)=>Promise<Response>}};
    new Function("require","module","exports",built.outputFiles[0].text)(webRequire,loaded,loaded.exports);return loaded.exports.POST;
  }
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    quote=await route("app/api/quote/route.ts");micro=await route("app/api/micro-warehousing/enquiry/route.ts");
    const built=await build({absWorkingDir:web,entryPoints:["tests/browser/analytics-forms.jsx"],bundle:true,write:false,outdir:"tmp/launch-e2e",format:"esm",jsx:"automatic",define:{"process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY":JSON.stringify("synthetic-only")},plugins:[{name:"test-captcha-and-router",setup(b){b.onResolve({filter:/^(react-google-recaptcha|next\/navigation)$/},a=>({path:a.path,namespace:"test"}));b.onLoad({filter:/.*/,namespace:"test"},a=>({loader:"jsx",resolveDir:web,contents:a.path==="next/navigation"?'export const usePathname=()=>location.pathname;':`import React,{forwardRef,useImperativeHandle} from 'react';export default forwardRef(function TestCaptcha(props,ref){useImperativeHandle(ref,()=>({getValue:()=>"synthetic-captcha",reset:()=>{}}));return <p>Isolated CAPTCHA provider fixture</p>;});`}));}}]});
    browserBundle=built.outputFiles.find(f=>f.path.endsWith(".js"))!.text;
    const today=new Date(Date.now()+7200000).toISOString().slice(0,10);
    const staff=await build({stdin:{contents:`import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{MarketingCommandCentre}from'./src/components/marketing-command-centre';function App(){const[data,set]=useState(null);useEffect(()=>{fetch('/workspace.json').then(r=>r.json()).then(set)},[]);return data?<MarketingCommandCentre data={data} from="${today}" to="${today}" facility="" view="channels"/>:null}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:"jsx"},bundle:true,write:false,format:"esm",jsx:"automatic"});staffBundle=staff.outputFiles[0].text;
    browser=await chromium.launch({args:["--no-sandbox","--host-resolver-rules=MAP stor24.co.za 127.0.0.1","--no-proxy-server"]});
    const cases=[
      ["/contact","google","cpc","stor24_midrand_search","ad_826923892509_ag_201418428952","business storage midrand",true],
      ["/micro-warehousing","google","cpc","stor24_micro_warehouse","828126323236","micro warehouse midrand",true],
      ["/contact","facebook","paid_social","stor24_self_storage_round2_20261015","self-image","",true],
      ["/micro-warehousing","facebook","paid_social","stor24_micro_warehousing_round2_20261015","micro-carousel-4","",true],
      ["/micro-warehousing","facebook","paid_social","stor24_micro_warehousing_round2_20261015","micro-image","",false],
    ] as const;
    await mkdir("output/launch-tracking",{recursive:true});
    for(const [pathname,source,medium,campaign,content,term,consent] of cases){
      const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage();
      const meta: string[]=[];
      const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
      await page.route("**/*",r=>{const url=r.request().url();if(url.startsWith("https://www.facebook.com/"))meta.push(url);return url.startsWith(base)?r.continue():r.fulfill({contentType:"application/javascript",body:"/* external analytics transport isolated */"});});
      const query=new URLSearchParams({utm_source:source,utm_medium:medium,utm_campaign:campaign,utm_content:content,utm_term:term,email:"private-tag@example.invalid"});
      await page.goto(base+pathname+"?"+query);
      await page.getByRole("button",{name:consent?"Accept analytics":"Reject analytics",exact:true}).click();
      await page.getByLabel("First name",{exact:true}).fill("Synthetic");await page.getByLabel("Last name",{exact:true}).fill("Launch");
      await page.getByLabel(pathname==="/contact"?"Email address":"Email",{exact:true}).fill(randomUUID()+"@example.invalid");
      await page.getByLabel(pathname==="/contact"?"Mobile number":"Phone",{exact:true}).fill("0000000000");
      if(pathname!=="/contact"){await page.getByLabel("Business name",{exact:true}).fill("Synthetic launch test");await page.getByLabel("Space requirements",{exact:true}).fill("Synthetic test only");await page.getByRole("checkbox").check();}
      await page.evaluate(()=>{const target=window as unknown as {gtag?:(...args:unknown[])=>void};const old=target.gtag;target.gtag=(...args)=>{if(args[0]==="event")sessionStorage.setItem("launch-events",JSON.stringify([...(JSON.parse(sessionStorage.getItem("launch-events")||"[]")),args]));old?.(...args);};});
      const before=await db.lead.count({where:{facilityId:facility.id}});
      await page.getByRole("button",{name:pathname==="/contact"?"Send my quote request":"Send enquiry →",exact:true}).click();
      if(pathname==="/contact")await expect(page).toHaveURL(/thank-you/);else await expect(page.getByRole("status")).toBeVisible();
      assert.equal(await db.lead.count({where:{facilityId:facility.id}}),before+1);
      const workspace=await marketingWorkspace(scope),last=workspace.leads[0];
      assert.equal(last.attribution?.advertising?.campaign,consent?campaign:undefined);
      assert.equal(last.attribution?.advertising?.content,consent?content:undefined);
      assert.equal(last.attribution?.advertising?.term,consent&&term?term:undefined);
      assert.equal(last.attribution?.source,consent?source:undefined);
      assert.equal(last.attribution?.conversionPage,consent?pathname:undefined);
      const events=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("launch-events")||"[]"));
      const saved=events.filter((e:unknown[])=>e[1]==="generate_lead");assert.equal(saved.length,consent?1:0);
      assert.equal(meta.filter(url=>new URL(url).searchParams.get("ev")==="Lead").length,consent?1:0);
      if(consent){assert.equal(saved[0][2].campaign_name,campaign);assert.equal(saved[0][2].campaign_content,content);assert.equal(JSON.stringify(saved).includes("private-tag"),false);}
      assert.deepEqual(errors,[]);await context.close();
    }
    const workspace=await marketingWorkspace(scope),report=marketingReport(workspace.leads,workspace.campaigns,today,today);
    assert.equal(report.leads,5);assert.equal(report.advertising.reduce((n,a)=>n+a.leads,0),4);assert.equal(report.unknown,1);
    assert.equal((await marketingWorkspace({...scope,facilityIds:[excluded.id]})).leads.length,0);
    const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base+"/staff");
    await expect(page.getByRole("heading",{name:"Ad campaign attribution"})).toBeVisible();
    await expect(page.getByRole("cell",{name:"micro-carousel-4",exact:true})).toBeVisible();
    await page.screenshot({path:"output/launch-tracking/database-backed-report.png",fullPage:true});
    for(const width of [390,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`output/launch-tracking/database-backed-report-${width}.png`,fullPage:true});}await page.close();
    // A failed CRM save must never turn into a successful-lead event.
    blocked=true;const before=await db.lead.count({where:{facilityId:facility.id}});
    const response=await micro(new Request(`http://127.0.0.1:${port}/api/micro-warehousing/enquiry`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({recaptchaToken:"synthetic-captcha",facilitySlug:"fixture",firstName:"Synthetic",lastName:"Failure",email:randomUUID()+"@example.invalid",phone:"0000000000",businessDetails:{companyName:"Synthetic"}})}));assert.equal(response.status,503);assert.equal(await db.lead.count({where:{facilityId:facility.id}}),before);
    assert.equal(await db.reservation.count({where:{facilityId:facility.id}}),0);
    console.log("PASS: five real browser forms through website proxy and authenticated CRM route to PostgreSQL; four campaign/creative/keyword attributions, consent-off exclusion, one saved event each, staff report readback, store isolation and CRM-failure handling. CAPTCHA/n8n/analytics are isolated provider boundaries; no production writes.");
    assert.equal(captured.length,5);
  }finally{
    await browser?.close();server.close();globalThis.fetch=realFetch;
    await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.lead.deleteMany({where:{facilityId:facility.id}});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
