import test from "node:test";import assert from "node:assert/strict";import{build}from"esbuild";import{createRequire}from"node:module";
test("payment request API requires both payment and ledger scope, strict consent and bounded identity input",async()=>{
 const state={auth:true,manage:true,ledger:true,origin:true,limit:false,calls:0};const runtime=globalThis as typeof globalThis&{paymentRequestRouteFixture?:typeof state};runtime.paymentRequestRouteFixture=state;
 const mocks:Record<string,string>={
  "@/lib/scope":`export async function requirePermissionScope(permission){const s=globalThis.paymentRequestRouteFixture;if(!s.auth)throw Error('UNAUTHENTICATED');if(permission==='payments.manage'&&!s.manage)throw Error('FORBIDDEN');return{userId:'staff',organisationId:'org',facilityIds:[permission==='ledger.view'?'ledger':'payment'],unrestrictedFacilities:false}}export async function requireFacility(scope){if(scope.facilityIds[0]==='ledger'&&!globalThis.paymentRequestRouteFixture.ledger)throw Error('FORBIDDEN')}`,
  "@/lib/db":`export const db={account:{findFirst:async()=>({tenancy:{facilityId:'store'}})}}`,
  "@/lib/auth-guards":`export function authErrorResponse(e){return Response.json({error:{message:e.message}},{status:e.message==='UNAUTHENTICATED'?401:e.message==='FORBIDDEN'?403:500})}`,
  "@/lib/request-security":`export const sameOrigin=()=>globalThis.paymentRequestRouteFixture.origin;export const rateLimit=async()=>globalThis.paymentRequestRouteFixture.limit`,
  "@/lib/payments/netcash-payment-request-service":`export async function previewAccountPaymentRequest(){globalThis.paymentRequestRouteFixture.calls++;return{preview:{}}}export async function createAccountPaymentRequest(){globalThis.paymentRequestRouteFixture.calls++;return{status:'READY'}}export async function listAccountPaymentRequests(){globalThis.paymentRequestRouteFixture.calls++;return{requests:[]}}`,
 };
 const bundle=await build({entryPoints:["src/app/api/v1/payments/netcash/requests/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"request-route-fixture",setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:"fixture"}:undefined);b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:mocks[a.path],loader:"js"}))}}]});
 const compiled={exports:{}as{GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}};new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const id="cmfixtureaccount00000000001",post=(body:unknown)=>compiled.exports.POST(new Request("https://portal.example.invalid/api/v1/payments/netcash/requests",{method:"POST",body:JSON.stringify(body)}));
 try{
  const input={action:"preview",accountId:id};let r=await post(input);assert.equal(r.status,200);assert.match(r.headers.get("cache-control")??"",/private/);assert.equal(state.calls,1);
  for(const extra of[{merchantAccount:"override"},{environment:"live"},{actorId:"pretend-staff"},{methodCode:"1"}])assert.equal((await post({...input,...extra})).status,422);
  assert.equal((await post({action:"create",preview:{accountId:id},confirmed:false})).status,422);assert.equal(state.calls,1);
  state.auth=false;assert.equal((await post(input)).status,401);state.auth=true;state.manage=false;assert.equal((await post(input)).status,403);state.manage=true;state.ledger=false;assert.equal((await post(input)).status,403);state.ledger=true;state.origin=false;assert.equal((await post(input)).status,403);state.origin=true;state.limit=true;assert.equal((await post(input)).status,429);state.limit=false;
  r=await compiled.exports.GET(new Request("https://portal.example.invalid/api/v1/payments/netcash/requests?accountId="+id));assert.equal(r.status,200);assert.equal(state.calls,2);
  assert.equal((await compiled.exports.GET(new Request("https://portal.example.invalid/api/v1/payments/netcash/requests?accountId="+id+"&accountId="+id))).status,422);assert.equal(state.calls,2);
  assert.equal((await post({action:"create",preview:{accountId:id,oversize:"x".repeat(9000)},confirmed:true})).status,422);assert.equal(state.calls,2);
 }finally{delete runtime.paymentRequestRouteFixture}
});
