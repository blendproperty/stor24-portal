import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { mkdir,writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { customerHistoryPdf } from "../src/lib/customer-history-document";
import { permissionMatches } from "../src/lib/permissions";

test("customer history downloads require an exact delegation instead of broad wildcards",()=>{
  for(const wildcard of ["*","reports.*","operations.*","*.view"])assert.equal(permissionMatches(wildcard,"customer_history.export"),false);
  assert.equal(permissionMatches("customer_history.export","customer_history.export"),true);
  assert.equal(permissionMatches("customer_history.export","data.personal_export"),false);
  assert.equal(permissionMatches("customer_history.export","adjustments.approve"),false);
});
test("customer dossier PDF retains long notes, page numbers and valid page bounds",async()=>{
  const rows=Array.from({length:12},(_,i)=>({customerName:"Synthetic customer",recordId:"synthetic-"+i,title:i?"Phone call":"WhatsApp reservation confirmation",body:(i===0?"Hi Brett \u{1f44b} — Möller confirmed.\n\u{274c} Not approved.\n":"")+("Customer discussed the move-out request. Covering staff should follow up on the agreed date.\n").repeat(i===4?40:1),recordedAtSast:"14 October 2026, 15:00 SAST",store:"Midpoint",author:"Synthetic staff",category:"Staff handover",status:i?"":"DELIVERED",sentAtSast:i?"":"14 October 2026, 14:00 SAST",deliveredAtSast:i?"":"14 October 2026, 14:01 SAST",readAtSast:"",evidenceLimit:i?"":"Original message text not retained."}));
  const bytes=await customerHistoryPdf("Synthetic customer",rows,"Customer reference: synthetic-only | All stored history",new Date("2026-10-14T13:00:00Z"));
  const doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>1);assert.equal(doc.getTitle(),"STOR24 customer contact history");
  for(const page of doc.getPages()){assert.equal(page.getWidth(),595);assert.equal(page.getHeight(),842);}
  await mkdir("output/pdf",{recursive:true});await writeFile("output/pdf/customer-history-example.pdf",bytes);
});
test("actual export HTTP route enforces CSRF, scoped delegation and source grants before constructing files",async()=>{
  type Released={customerId:string;access:{collections:unknown};query:{kind:string}};
  let exportAllowed=false,writeCalls=0;const released:Released[]=[];
  const scope={userId:"actor",organisationId:"org",facilityIds:["A"],unrestrictedFacilities:false};
  const output=await build({entryPoints:["src/app/api/v1/customers/[customerId]/history/export/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"export-fixture",setup(b){
    b.onResolve({filter:/^@\/lib\/(scope|auth-guards|customer-history-export|request-security)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/scope")?"export const requirePermissionScope=__scope;":a.path.endsWith("/auth-guards")?"export const requirePermission=__scope;":a.path.endsWith("/request-security")?"export const sameOrigin=r=>r.headers.get('origin')===new URL(r.url).origin;":"export const intersectHistoryScope=(a,b)=>{const f=a.facilityIds.filter(id=>b.facilityIds.includes(id));if(!f.length)throw Error('FORBIDDEN');return {...a,facilityIds:f};};export const releaseCustomerHistoryExport=__release;"}));
  }}]});
  const loaded={exports:{} as {POST:(r:Request,c:unknown)=>Promise<Response>}};
  new Function("require","module","exports","__scope","__release",output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,async(p:string)=>{if(p==="customer_history.export"&&!exportAllowed)throw Error("FORBIDDEN");if(p==="collections.view")throw Error("FORBIDDEN");return scope;},async(value:unknown)=>{writeCalls++;released.push(value as Released);return new Response("csv",{headers:{"content-type":"text/csv"}});});
  const request=(body:unknown={format:"CSV"},origin="https://example.invalid")=>new Request("https://example.invalid/api/v1/customers/one/history/export",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
  const c={params:Promise.resolve({customerId:"one"})};
  assert.equal((await loaded.exports.POST(request(),c)).status,403);
  exportAllowed=true;assert.equal((await loaded.exports.POST(request(undefined,"https://attacker.invalid"),c)).status,403);
  assert.equal((await loaded.exports.POST(request({format:"HTML"}),c)).status,422);
  assert.equal((await loaded.exports.POST(request({format:"CSV",rows:[{customerName:"forged"}]}),c)).status,422);
  assert.equal(writeCalls,0);assert.equal((await loaded.exports.POST(request({format:"CSV",kind:"COMMUNICATION"}),c)).status,200);
  assert.equal(released[0].customerId,"one");assert.equal(released[0].access.collections,null);assert.equal(released[0].query.kind,"COMMUNICATION");assert.equal(writeCalls,1);
  assert.equal((await loaded.exports.POST(request({format:"XLSX",kind:"NOTE",category:"HANDOVER"}),c)).status,200);
  assert.equal(released[1].query.kind,"NOTE");
  exportAllowed=false;assert.equal((await loaded.exports.POST(request({format:"XLSX"}),c)).status,403);assert.equal(writeCalls,2);
});
