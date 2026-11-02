import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {randomUUID,createHash} from "node:crypto";
import {Prisma} from "../src/generated/prisma/client";
import {defaultVisualQuery} from "../src/lib/visual-report-engine";
import {encryptReportArtifact} from "../src/lib/visual-report-security";
import {WORD_REPORT_TYPE} from "../src/lib/report-word";
type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function matches(row:Row,where:Row={}):boolean {
  return Object.entries(where).every(([key,value])=>{
    if(value===undefined)return true;
    if(key==="AND")return (Array.isArray(value)?value:[value]).every(v=>matches(row,v));
    if(key==="OR")return value.some((v:Row)=>matches(row,v));
    if(key==="NOT")return !(Array.isArray(value)?value:[value]).some(v=>matches(row,v));
    if(value instanceof Date)return row[key]?.getTime()===value.getTime();
    if(value&&typeof value==="object") {
      if("some"in value)return (row[key]??[]).some((item:Row)=>matches(item,value.some));
      if("path"in value)return value.path.reduce((v:Row,k:string)=>v?.[k],row[key])===value.equals;
      if("in"in value)return value.in.includes(row[key]);
      if("not"in value)return row[key]!==value.not;
      if("startsWith"in value)return row[key]?.startsWith(value.startsWith);
      for(const op of ["gte","gt","lte","lt"])if(op in value)return op==="gte"?row[key]>=value[op]:op==="gt"?row[key]>value[op]:op==="lte"?row[key]<=value[op]:row[key]<value[op];
      return matches(row[key]??{},value);
    }
    return row[key]===value;
  });
}
async function fixture():Promise<Row> {
  const facility={id:"a",organisationId:"org",name:"Fixture store",closedFloors:[]};
  const user={id:"staff",organisationId:"org",active:true,passwordHash:"synthetic-not-a-real-password-hash",sessionVersion:1,name:"Fixture employee",roleAssignments:[{facilityId:"a",role:{name:"Staff",permissions:["reports.view","reports.export"]}}]};
  const tables:Record<string,Row[]>={user:[user],organisation:[{id:"org",currency:"ZAR"}],facility:[facility],unit:[{id:"unit-a",facilityId:"a",facility,number:"A1",floor:"G",unitType:{name:"Small",areaSqMetres:new Prisma.Decimal(4)},monthlyRate:new Prisma.Decimal(100),status:"AVAILABLE",combinedIntoUnitId:null,reservations:[],useTypes:["STORAGE"],attributes:{}}],savedReport:[],reportHistoryImport:[],reportSchedule:[],reportRun:[],auditEvent:[],lead:[],customerNote:[]};
  const state:Row={tables,user,Prisma,authenticated:true,queries:[],failAudit:false,authReads:0,changedOnRead:0};
  const db:Row={};
  for(const [model,rows] of Object.entries(tables)){
    db[model]={
      findUnique:async({where}:Row)=>{if(model==="user"){state.authReads++;if(state.changedOnRead===state.authReads)user.roleAssignments=state.changedAssignments??[];}return rows.find(r=>matches(r,where))??null;},
      findUniqueOrThrow:async({where}:Row)=>{const row=rows.find(r=>matches(r,where));if(!row)throw Error("NOT_FOUND");return row;},
      findFirst:async(args:Row)=>rows.find(r=>matches(r,args.where))??null,
      findMany:async(args:Row)=>{state.queries.push({model,...args});return rows.filter(r=>matches(r,args.where)).slice(0,args.take??rows.length);},
      count:async(args:Row)=>rows.filter(r=>matches(r,args.where)).length,
      create:async({data}:Row)=>{if(model==="auditEvent"&&state.failAudit)throw Error("AUDIT_UNAVAILABLE");const row={id:randomUUID(),archived:false,revision:1,createdAt:new Date(),updatedAt:new Date(),...data};rows.push(row);return row;},
      updateMany:async({where,data}:Row)=>{let count=0;rows.forEach((row,index)=>{if(matches(row,where)){rows[index]={...row,...Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v&&typeof v==="object"&&"increment"in v?row[k]+(v as Row).increment:v]))};count++;}});return {count};},
      update:async({where,data}:Row)=>{const index=rows.findIndex(r=>matches(r,where));if(index<0)throw Error("NOT_FOUND");rows[index]={...rows[index],...data};return rows[index];},
    };
  }
  db.$queryRaw=async()=>[{count:1}];
  db.$transaction=async(fn:(db:Row)=>Promise<unknown>)=>{const copies=Object.fromEntries(Object.entries(tables).map(([model,rows])=>[model,[...rows]]));try{return await fn(db);}catch(error){for(const [model,copy]of Object.entries(copies))tables[model].splice(0,tables[model].length,...copy);throw error;}};
  state.db=db;(globalThis as Row).__reportFixture=state;
  const result=await build({stdin:{contents:`export * as builder from './src/app/api/v1/reports/builder/route';export * as history from './src/app/api/v1/reports/history/route';export * as batch from './src/app/api/v1/reports/batch/route';export * as runs from './src/app/api/v1/reports/runs/[id]/route';export * as fixed from './src/app/api/v1/reports/export/route';export * as worker from './src/lib/visual-report-worker';export * as workerRoute from './src/app/api/v1/reports/worker/route';`,resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"cjs",platform:"node",packages:"external",plugins:[{name:"report-fixture",setup(b){b.onResolve({filter:/^(?:@\/lib\/db|\.\/db)$/},()=>({path:"db",namespace:"report-fixture"}));b.onResolve({filter:/generated\/prisma\/client$/},()=>({path:"prisma",namespace:"report-fixture"}));b.onResolve({filter:/^(?:@\/lib\/session|\.\/session)$/},()=>({path:"session",namespace:"report-fixture"}));b.onLoad({filter:/.*/,namespace:"report-fixture"},args=>({contents:args.path==="db"?"export const db=globalThis.__reportFixture.db;":args.path==="prisma"?"export const Prisma=globalThis.__reportFixture.Prisma;":"export async function getSession(){return globalThis.__reportFixture.authenticated?{userId:'staff',organisationId:'org',sessionVersion:1,mfaVerified:true}:null;}"}));}}]});
  const fixtureModule={exports:{} as Row};new Function("require","module","exports",result.outputFiles[0].text)(createRequire(import.meta.url),fixtureModule,fixtureModule.exports);
  return {...state,api:fixtureModule.exports};
}
const request=(body:unknown,origin="https://fixture.invalid")=>new Request("https://fixture.invalid/api/v1/reports/builder",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
const query=()=>({...defaultVisualQuery("units","2026-10-01","2026-10-31"),columns:["facility","unit","monthlyRate"]});
test("real builder routes enforce authentication, origin, field validation and facility scope",async()=>{
  const f=await fixture();assert.equal((await f.api.builder.POST(request({kind:"preview",query:query()},"https://foreign.invalid"))).status,403);
  (globalThis as Row).__reportFixture.authenticated=false;assert.equal((await f.api.builder.GET()).status,401);(globalThis as Row).__reportFixture.authenticated=true;
  assert.equal((await f.api.builder.POST(request({kind:"preview",query:{...query(),columns:["passwordHash"]}}))).status,422);
  assert.equal((await f.api.builder.POST(request({kind:"preview",query:{...query(),facilityId:"b"}}))).status,403);
  const response=await f.api.builder.POST(request({kind:"preview",query:query()}));assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store, max-age=0");assert.equal((await response.json()).data[0].unit,"A1");
  const read=f.queries.find((q:Row)=>q.model==="unit");assert.equal(read.where.facility.organisationId,"org");assert.deepEqual(read.where.facility.id,{in:["a"]});assert.equal(read.take,5001);
});
test("permission revocation between query and release blocks rows",async()=>{const f=await fixture();(globalThis as Row).__reportFixture.changedOnRead=2;const response=await f.api.builder.POST(request({kind:"preview",query:query()}));assert.equal(response.status,403);assert.equal((await response.json()).data,undefined);});

test("native staff-note reports retain recorded author/text and enforce store, organisation and SAST boundaries",async()=>{
  const f=await fixture();
  f.user.roleAssignments=[{facilityId:"a",role:{name:"Synthetic note reporter",permissions:["reports.view","reports.export","operations.view","customer_history.export","data.personal_export"]}}];
  const base={organisationId:"org",facilityId:"a",facility:{id:"a",organisationId:"org",name:"Fixture store"},customerId:"customer-a",customer:{organisationId:"org",companyName:null,firstName:"Synthetic",lastName:"Customer",tenancies:[{facilityId:"a"}]},category:"HANDOVER",authorName:"Original author",body:"Synthetic handover detail"};
  f.tables.customerNote.push(...[
    {...base,id:"included",createdAt:new Date("2026-09-30T22:00:00.000Z")},
    {...base,id:"before",createdAt:new Date("2026-09-30T21:59:59.999Z")},
    {...base,id:"after",createdAt:new Date("2026-10-01T22:00:00.000Z")},
    {...base,id:"other-store",facilityId:"b",facility:{id:"b",organisationId:"org",name:"Other store"},createdAt:new Date("2026-10-01T08:00:00Z")},
    {...base,id:"other-org",organisationId:"foreign",createdAt:new Date("2026-10-01T08:00:00Z")},
    {...base,id:"foreign-customer",customer:{...base.customer,organisationId:"foreign"},createdAt:new Date("2026-10-01T08:00:00Z")},
    {...base,id:"unlinked-customer",customer:{...base.customer,tenancies:[]},createdAt:new Date("2026-10-01T08:00:00Z")},
  ]);
  const q={...defaultVisualQuery("customer-notes-native","2026-10-01","2026-10-01"),dateField:"date",columns:["customer","category","author","date","note"]};
  const response=await f.api.builder.POST(request({kind:"preview",query:q}));assert.equal(response.status,200);
  assert.deepEqual((await response.json()).data,[{customer:"Synthetic Customer",category:"HANDOVER",author:"Original author",date:"2026-09-30T22:00:00.000Z",note:"Synthetic handover detail"}]);
  const source=f.queries.find((r:Row)=>r.model==="customerNote");assert.equal(source.take,5001);assert.equal(source.where.customer.organisationId,"org");assert.equal(source.where.facility.organisationId,"org");assert.deepEqual(source.where.facilityId,{in:["a"]});
  const downloaded=await f.api.builder.POST(request({kind:"export",query:q,format:"DOCX"}));assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get("content-type"),WORD_REPORT_TYPE);assert.match(downloaded.headers.get("cache-control"),/no-store/);
  assert.ok(f.tables.auditEvent.some((event:Row)=>event.after.format==="DOCX"));assert.equal(f.tables.customerNote.length,7);
  assert.equal((await f.api.builder.POST(request({kind:"preview",query:{...q,historyImportId:"legacy"}}))).status,422);
  f.user.roleAssignments=[{facilityId:null,role:{name:"Organisation owner",permissions:[]}}];
  assert.equal((await f.api.history.POST(request({kind:"validate",dataset:"customer-notes-native",facilityId:"a",name:"Synthetic legacy notes",extractedAt:"2026-10-01T08:00:00Z",approvalReference:"Synthetic source review",csv:"ID,Note\nlegacy,Synthetic legacy",mapping:{sourceRecordId:"ID",note:"Note"}}))).status,422);
  assert.equal(f.tables.reportHistoryImport.length,0);
});

test("staff-note reports require history scope and personal authorization again before release",async()=>{
  const q={...defaultVisualQuery("customer-notes-native","2026-10-01","2026-10-31"),columns:["note"]};
  for(const missing of ["operations.view","customer_history.export","data.personal_export"]){
    const f=await fixture();f.user.roleAssignments=[{facilityId:"a",role:{name:"Synthetic note reporter",permissions:["reports.view","reports.export","operations.view","customer_history.export","data.personal_export"].filter(permission=>permission!==missing)}}];
    f.tables.customerNote.push({id:"note",organisationId:"org",facilityId:"a",facility:{id:"a",organisationId:"org",name:"Fixture store"},customerId:"customer",customer:{organisationId:"org",companyName:null,firstName:"Synthetic",lastName:null},category:"GENERAL",authorName:"Original author",body:"Synthetic note",createdAt:new Date("2026-10-01")});
    assert.equal((await f.api.builder.POST(request({kind:"export",query:q,format:"CSV"}))).status,403,missing);
  }
  const f=await fixture();f.user.roleAssignments=[{facilityId:"a",role:{name:"Synthetic note reporter",permissions:["reports.view","reports.export","operations.view","customer_history.export","data.personal_export"]}}];
  (globalThis as Row).__reportFixture.changedOnRead=2;(globalThis as Row).__reportFixture.changedAssignments=[{facilityId:"a",role:{name:"Revoked history reporter",permissions:["reports.view","reports.export","operations.view","data.personal_export"]}}];
  assert.equal((await f.api.builder.POST(request({kind:"preview",query:q}))).status,403);
});

test('Word downloads use actual builder, fixed, bundle and retained-snapshot routes with the same protection',async()=>{
  const f=await fixture(),JSZip=createRequire(import.meta.url)('jszip');
  const download=await f.api.builder.POST(request({kind:'export',query:query(),format:'DOCX'}));assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),WORD_REPORT_TYPE);assert.match(download.headers.get('content-disposition'),/\.docx/);assert.match(download.headers.get('cache-control'),/no-store/);
  const word=await JSZip.loadAsync(Buffer.from(await download.arrayBuffer()),{checkCRC32:true});assert.ok((await word.file('word/document.xml').async('string')).includes('A1'));assert.equal(f.tables.reportRun[0].format,'DOCX');assert.ok(f.tables.auditEvent.some((r:Row)=>r.after.format==='DOCX'));
  const fixed=await f.api.fixed.GET(new Request('https://fixture.invalid/api/v1/reports/export?reportKey=unit-availability&from=2026-10-01&to=2026-10-31&format=DOCX&facilityId=a'));assert.equal(fixed.status,200);assert.equal(fixed.headers.get('content-type'),WORD_REPORT_TYPE);assert.ok((await (await JSZip.loadAsync(Buffer.from(await fixed.arrayBuffer()))).file('word/document.xml').async('string')).includes('Current snapshot'));
  f.tables.savedReport.push({id:'saved-word',organisationId:'org',ownerId:'staff',archived:false,visibility:'PRIVATE',definition:query()});
  const bundled=await f.api.batch.POST(request({ids:['saved-word'],format:'DOCX'}));assert.equal(bundled.status,200);const zip=await JSZip.loadAsync(Buffer.from(await bundled.arrayBuffer()),{checkCRC32:true});const name=Object.keys(zip.files).find(n=>n.endsWith('.docx'));assert.ok(name);assert.ok((await JSZip.loadAsync(await zip.file(name).async('uint8array'))).file('word/document.xml'));assert.ok(zip.file('manifest.json'));
  const previous=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='synthetic-word-snapshot-key-at-least-32-characters';
  try{
    const artifact={version:1,query:query(),generatedAt:'2026-10-01T08:00:00.000Z',basis:'Retained source snapshot evidence',rows:[{facility:'Fixture store',unit:'ORIGINAL',monthlyRate:100}],scope:{userId:'staff',organisationId:'org',facilityIds:['a'],unrestrictedFacilities:false}};
    f.tables.reportRun.push({id:'word-snapshot',organisationId:'org',requestedById:'staff',reportKey:'scheduled-visual-report',status:'SUCCEEDED',expiresAt:new Date(Date.now()+60000),encryptedResult:encryptReportArtifact(JSON.stringify(artifact),'org:staff:word-snapshot')});
    const retained=await f.api.runs.GET(new Request('https://fixture.invalid/api/v1/reports/runs/word-snapshot?format=DOCX'),{params:Promise.resolve({id:'word-snapshot'})});assert.equal(retained.status,200);const xml=await (await JSZip.loadAsync(Buffer.from(await retained.arrayBuffer()))).file('word/document.xml').async('string');assert.ok(xml.includes('ORIGINAL'));assert.ok(xml.includes('Retained source snapshot evidence'));assert.ok(xml.includes(artifact.generatedAt));
    f.user.roleAssignments=[];assert.equal((await f.api.runs.GET(new Request('https://fixture.invalid/api/v1/reports/runs/word-snapshot?format=DOCX'),{params:Promise.resolve({id:'word-snapshot'})})).status,403);
  }finally{if(previous===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=previous;}
});
test('Word never bypasses personal-data scope, current revocation, secret filtering, audit failure or output limits',async()=>{
  let f=await fixture();f.user.roleAssignments=[{facilityId:'a',role:{name:'Synthetic reporter',permissions:['reports.sales','reports.export']}}];f.tables.lead.push({id:'lead',facility:{id:'a',organisationId:'org',name:'Fixture store'},customer:{companyName:null,firstName:'Synthetic',lastName:'Customer'},source:'Recorded',stage:'NEW',createdAt:new Date('2026-10-02')});
  assert.equal((await f.api.builder.POST(request({kind:'export',query:{...defaultVisualQuery('leads','2026-10-01','2026-10-31'),columns:['customer']},format:'DOCX'}))).status,403);
  f=await fixture();assert.equal((await f.api.builder.POST(request({kind:'export',query:{...query(),facilityId:'excluded'},format:'DOCX'}))).status,403);
  f=await fixture();(globalThis as Row).__reportFixture.changedOnRead=2;assert.equal((await f.api.builder.POST(request({kind:'export',query:query(),format:'DOCX'}))).status,403);
  f=await fixture();(globalThis as Row).__reportFixture.changedOnRead=3;(globalThis as Row).__reportFixture.changedAssignments=[{facilityId:'excluded',role:{name:'Moved reporter',permissions:['reports.view','reports.export']}}];assert.equal((await f.api.fixed.GET(new Request('https://fixture.invalid/api/v1/reports/export?reportKey=unit-availability&from=2026-10-01&to=2026-10-31&format=DOCX&facilityId=a'))).status,403);
  f=await fixture();f.tables.unit[0].number='Bearer '+'A'.repeat(24);assert.equal((await f.api.builder.POST(request({kind:'export',query:query(),format:'DOCX'}))).status,422);
  f=await fixture();(globalThis as Row).__reportFixture.failAudit=true;assert.equal((await f.api.builder.POST(request({kind:'export',query:query(),format:'DOCX'}))).status,500);
  f=await fixture();f.tables.unit[0].number='&'.repeat(1100000);const limit=await f.api.builder.POST(request({kind:'export',query:query(),format:'DOCX'}));assert.equal(limit.status,422);assert.equal((await limit.json()).error.code,'REPORT_LIMIT');
});
test("save is idempotent and audit failures roll back definition changes",async()=>{
  const f=await fixture(),body={kind:"save",query:query(),requestKey:randomUUID()};
  const first=await f.api.builder.POST(request(body));assert.equal(first.status,201);const saved=(await first.json()).data;
  assert.equal((await f.api.builder.POST(request(body))).status,201);assert.equal(f.tables.savedReport.length,1);assert.equal(f.tables.auditEvent.length,1);
  assert.equal((await f.api.builder.POST(request({...body,query:{...query(),name:"Changed after unknown save"}}))).status,409);
  (globalThis as Row).__reportFixture.failAudit=true;
  assert.equal((await f.api.builder.POST(request({kind:"save",id:saved.id,revision:1,query:{...query(),name:"Revised"}}))).status,500);assert.equal(f.tables.savedReport[0].revision,1);
});
test("shared definitions require owner, and conflicts and personal exports remain explicit",async()=>{
  const f=await fixture();assert.equal((await f.api.builder.POST(request({kind:"save",query:query(),requestKey:randomUUID(),visibility:"ORGANISATION"}))).status,403);
  f.user.roleAssignments=[{facilityId:null,role:{name:"Admin",permissions:["*"]}}];
  f.tables.lead.push({id:"lead",facility:{id:"a",organisationId:"org",name:"Fixture store"},customer:{companyName:null,firstName:"Synthetic",lastName:"Customer"},source:"Recorded",stage:"NEW",productLine:"STORAGE",assignedTo:null,createdAt:new Date("2026-10-02"),expectedMoveIn:null,nextActionAt:null});
  const personal={...defaultVisualQuery("leads","2026-10-01","2026-10-31"),columns:["customer"]};
  const denied=await f.api.builder.POST(request({kind:"export",query:personal,format:"CSV"}));assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,"PERSONAL_EXPORT_FORBIDDEN");
  f.user.roleAssignments=[{facilityId:null,role:{name:"Organisation owner",permissions:["*"]}}];assert.equal((await f.api.builder.POST(request({kind:"export",query:personal,format:"CSV"}))).status,200);
});
test("preview/export audit outage fails closed and batch refuses unauthorized definitions",async()=>{
  const f=await fixture();(globalThis as Row).__reportFixture.failAudit=true;
  assert.equal((await f.api.builder.POST(request({kind:"export",query:query(),format:"CSV"}))).status,500);
  (globalThis as Row).__reportFixture.failAudit=false;assert.equal((await f.api.batch.POST(request({ids:["foreign"],format:"CSV"}))).status,404);
});
test("history import is owner-only, encrypted, scoped and replayable",async()=>{
  const f=await fixture(),previous=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="synthetic-report-encryption-fixture-key-123";
  const body={kind:"import",dataset:"units",facilityId:"a",name:"Synthetic history",extractedAt:"2026-10-01T08:00:00+02:00",approvalReference:"Synthetic approval",csv:"ID,Unit,Rate,Currency\nlegacy1,H1,10,ZAR",mapping:{sourceRecordId:"ID",unit:"Unit",monthlyRate:"Rate",currency:"Currency"}};
  try{assert.equal((await f.api.history.POST(request(body))).status,403);f.user.roleAssignments=[{facilityId:null,role:{name:"Organisation owner",permissions:["*"]}}];const imported=await f.api.history.POST(request(body));assert.equal(imported.status,201);const id=(await imported.json()).data.id;assert.equal(Buffer.from(f.tables.reportHistoryImport[0].encryptedRows.split(".")[3],"base64url").includes(Buffer.from('"unit":"H1"')),false);assert.equal((await f.api.history.POST(request(body))).status,200);assert.equal(f.tables.reportHistoryImport.length,1);
    const result=await f.api.builder.POST(request({kind:"preview",query:{...query(),historyImportId:id,facilityId:"a"}}));assert.equal(result.status,200);const payload=await result.json();assert.equal(payload.data[0].unit,"H1");assert.match(payload.meta.basis,/Imported SiteLink/);assert.equal(f.tables.unit[0].number,"A1");
  }finally{if(previous===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=previous;}
});
test("worker uses current permissions and records failed runs without an artifact",async()=>{
  const f=await fixture();const now=new Date("2026-10-07T07:00:00Z"),definition=query();f.tables.savedReport.push({id:"saved",organisationId:"org",ownerId:"staff",archived:false,definition});f.tables.reportSchedule.push({id:"schedule",organisationId:"org",active:true,reportKey:"saved:saved",nextRunAt:new Date("2026-10-07T06:00:00Z"),parameters:{version:1,ownerId:"staff",savedId:"saved",cadence:"daily",query:definition}});
  const result=await f.api.worker.runScheduledReports(now);assert.equal(result.failed,1);assert.equal(f.tables.reportRun[0].status,"FAILED");assert.equal(f.tables.reportRun[0].encryptedResult,undefined);assert.equal(f.tables.reportRun[0].failureCode,"FORBIDDEN");assert.equal((await f.api.worker.runScheduledReports(now)).checked,0);
});

test("report worker handler requires its dedicated key even without a staff session",async()=>{
  const f=await fixture(),previous=process.env.REPORT_CRON_SECRET_SHA256;
  const call=(key?:string)=>f.api.workerRoute.POST(new Request("https://fixture.invalid/api/v1/reports/worker",{method:"POST",headers:key?{"x-cron-key":key}:{}}));
  try{delete process.env.REPORT_CRON_SECRET_SHA256;assert.equal((await call()).status,503);
    process.env.REPORT_CRON_SECRET_SHA256=createHash("sha256").update("synthetic-worker-key").digest("hex");
    assert.equal((await call()).status,401);assert.equal((await call("wrong-key")).status,401);
    (globalThis as Row).__reportFixture.authenticated=false;assert.equal((await call("synthetic-worker-key")).status,200);
  }finally{if(previous===undefined)delete process.env.REPORT_CRON_SECRET_SHA256;else process.env.REPORT_CRON_SECRET_SHA256=previous;}
});


test("specialized history requires an extract and runs approved journal lines without native posting",async()=>{
  const f=await fixture();f.user.roleAssignments=[{facilityId:null,role:{name:"Organisation owner",permissions:["*"]}}];
  const previous=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="synthetic-report-key-at-least-32-characters";
  try{
    const query=defaultVisualQuery("history-general-journal","2026-10-01","2026-10-31");
    const missing=await f.api.builder.POST(request({kind:"preview",query}));assert.equal(missing.status,422);assert.equal((await missing.json()).error.code,"REPORT_HISTORY_REQUIRED");
    const csv="id,date,code,debit,credit,basis,currency\nline1,2026-10-01,4000,12.34,0.00,CASH,ZAR";
    const imported=await f.api.history.POST(request({kind:"import",dataset:query.dataset,facilityId:"a",name:"Synthetic journal",extractedAt:"2026-10-01T08:00:00+02:00",approvalReference:"Synthetic reconciliation",csv,mapping:{sourceRecordId:"id",date:"date",accountCode:"code",debit:"debit",credit:"credit",accountingBasis:"basis",currency:"currency"}}));assert.equal(imported.status,201);
    const id=(await imported.json()).data.id;const result=await f.api.builder.POST(request({kind:"preview",query:{...query,historyImportId:id,facilityId:"a"}}));assert.equal(result.status,200);assert.equal((await result.json()).data[0].debit,"12.34");assert.equal(f.tables.reportHistoryImport.length,1);assert.equal(f.tables.unit.length,1);
  }finally{if(previous===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=previous;}
});
