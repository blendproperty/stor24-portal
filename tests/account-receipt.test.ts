import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture(){
  const state={denied:false,missing:false,held:false,graphError:"",dlpDenied:false,status:"SUCCEEDED",queries:[] as {where:Record<string,unknown>}[],audits:[] as unknown[],graphScopes:[] as unknown[]};
  const result=await build({entryPoints:["src/app/api/v1/accounts/[id]/receipts/[paymentId]/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"receipt-boundary",setup(b){
    b.onResolve({filter:/^@\/generated\/prisma\/client$/},()=>({path:"prisma",namespace:"prisma"}));b.onLoad({filter:/.*/,namespace:"prisma"},()=>({contents:"export const Prisma={TransactionIsolationLevel:{RepeatableRead:'RepeatableRead'}};"}));
    b.onResolve({filter:/^@\/lib\/(db|scope|auth-guards|receipt-reallocation-source|dlp-transfer-service|hostinger-email)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/hostinger-email")?`export class HostingerEmailProvider {}`:a.path.endsWith("/db")?`export const db={$transaction:async fn=>fn({payment:{findFirst:async q=>{__state.queries.push(q);return __state.missing?null:{status:__state.status,method:'EFT',providerRef:'<script>bad</script>',account:{accountNumber:'ACC-1',customer:{firstName:'<img src=x>',lastName:'Example',companyName:null},tenancy:{facility:{name:'Synthetic store'}}}}}}}),auditEvent:{create:async q=>__state.audits.push(q)}};`:a.path.endsWith("/scope")?`export const requirePermissionScope=async p=>{if(p!=='ledger.view'||__state.denied)throw Error('FORBIDDEN');return {organisationId:'org',userId:'staff',facilityIds:['store'],unrestrictedFacilities:false}};export const facilityWhere=s=>({organisationId:s.organisationId,id:{in:s.facilityIds}});`:a.path.endsWith("/auth-guards")?`export const authErrorResponse=e=>Response.json({error:{message:'Denied'}},{status:e.message==='FORBIDDEN'?403:500});`:a.path.endsWith("/receipt-reallocation-source")?`export const receiptAllocationGraph=async(tx,s,id)=>{__state.graphScopes.push({scope:s,id});if(__state.graphError)throw Error(__state.graphError);return {root:{amount:'40.00'},receivedAt:new Date('2026-10-01T10:00:00Z'),accounts:[{inFlight:__state.held}]}};`:`export const guardDlpTransfer=async()=>{};export const protectDlpResponse=async r=>{if(__state.dlpDenied)throw Error('DLP_DENIED');return r};`}));
  }}]});
  const loaded={exports:{} as {GET:(r:Request,c:{params:Promise<{id:string;paymentId:string}>})=>Promise<Response>}};
  new Function("require","module","exports","__state",result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,state);
  return {state,get:()=>loaded.exports.GET(new Request("https://example.invalid/receipt"),{params:Promise.resolve({id:"account",paymentId:"payment"})})};
}
test("receipt copy scopes the account/payment, validates the existing receipt graph and escapes all displayed source text",async()=>{
 const f=await fixture(),response=await f.get(),html=await response.text();assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.match(response.headers.get("content-security-policy")!,/default-src 'none'/);
 assert.match(html,/Payment receipt/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img src=x>/);assert.equal(f.state.audits.length,1);assert.equal(f.state.graphScopes.length,1);
 assert.deepEqual(f.state.queries[0].where,{id:"payment",accountId:"account",account:{customer:{organisationId:"org"},tenancy:{facility:{organisationId:"org",id:{in:["store"]}}}}});
});
test("missing, forbidden, in-flight, refunded or unverified sources cannot issue a receipt",async()=>{
 for(const [change,status] of [[{denied:true},403],[{missing:true},404],[{held:true},409],[{status:"REFUNDED"},409],[{graphError:"REALLOCATION_RECEIPT_REVIEW"},409],[{graphError:"REALLOCATION_NOT_FOUND"},404],[{dlpDenied:true},500]] as const){const f=await fixture();Object.assign(f.state,change);assert.equal((await f.get()).status,status);assert.equal(f.state.audits.length,0);}
});
