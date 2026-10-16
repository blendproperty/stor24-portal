import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
test('native refund route requires scoped authority, bounded original identifiers and explicit hold confirmations',async()=>{
 const state={auth:true,denied:'',origin:true,limited:false,calls:0,permissions:[]as string[]};const runtime=globalThis as typeof globalThis&{refundRouteFixture?:typeof state};runtime.refundRouteFixture=state;
 const mocks:Record<string,string>={
  '@/lib/scope':`export async function requirePermissionScope(permission){const s=globalThis.refundRouteFixture;s.permissions.push(permission);if(!s.auth)throw Error('UNAUTHENTICATED');if(s.denied===permission)throw Error('FORBIDDEN');return{organisationId:'org',userId:'staff',facilityIds:['store'],unrestrictedFacilities:false}}`,
  '@/lib/auth-guards':`export function authErrorResponse(e){return Response.json({error:{message:'Denied'}},{status:e.message==='UNAUTHENTICATED'?401:e.message==='FORBIDDEN'?403:500})}`,
  '@/lib/request-security':`export const sameOrigin=()=>globalThis.refundRouteFixture.origin;export const rateLimit=async()=>globalThis.refundRouteFixture.limited`,
  '@/lib/payments/netcash-refund-service':`const action=async()=>{globalThis.refundRouteFixture.calls++;return{providerAttempted:false,dispatchAvailable:false,financialPosting:false}};export const previewNetcashRefund=action,prepareNetcashRefund=action,actOnNetcashRefund=action,netcashRefundHistory=action,netcashRefundOptions=action`,
 };
 const compiled={exports:{}as{GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}},result=await build({entryPoints:['src/app/api/v1/adjustments/netcash-refunds/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}))}}]});new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const route=compiled.exports,facilityId='cmfixturefacility000000001',source={facilityId,adjustmentId:'cmfixtureadjustment0000001',lineId:'cmfixturestatementline0001'},base={facilityId,id:'netcash-refund:'+'1'.repeat(64),revision:2,reference:'Synthetic independent reference',confirmed:true},post=(body:object)=>route.POST(new Request('https://portal.example.invalid/api',{method:'POST',body:JSON.stringify(body)}));
 try{
  assert.equal((await post({action:'preview',...source})).status,200);assert.equal(state.calls,1);
  for(const extra of [{serviceKey:'forged'},{merchantKey:'forged'},{providerAttempted:true},{transactionId:1234},{environment:'live'},{amount:'1.00'},{paymentId:'forged'}])assert.equal((await post({action:'preview',...source,...extra})).status,422);assert.equal(state.calls,1);
  assert.equal((await post({action:'prepare',...source,previewHash:'1'.repeat(64),reference:'Synthetic',confirmed:false})).status,422);
  for(const[action,confirmation,permission]of [['reserve','RESERVE WITHOUT DISPATCH','payments.refund_reserve'],['request-release','REQUEST LOCAL HOLD RELEASE','payments.refund_reserve'],['approve-release','RELEASE LOCAL HOLD','payments.refund_release_review']]){
   assert.equal((await post({action,...base,confirmation:'yes'})).status,422);state.denied=permission;assert.equal((await post({action,...base,confirmation})).status,403);state.denied='';assert.equal((await post({action,...base,confirmation})).status,200);assert.ok(state.permissions.includes(permission));
  }
  const calls=state.calls;state.origin=false;assert.equal((await post({action:'review',...base})).status,403);state.origin=true;state.auth=false;assert.equal((await post({action:'review',...base})).status,401);state.auth=true;state.limited=true;assert.equal((await post({action:'review',...base})).status,429);state.limited=false;
  assert.equal((await post({action:'prepare',...source,previewHash:'1'.repeat(64),reference:'x'.repeat(5000),confirmed:true})).status,422);assert.equal(state.calls,calls);
  for(const query of ['facilityId='+facilityId+'&facilityId='+facilityId,'facilityId='+facilityId+'&environment=live','facilityId='+facilityId+'&mode=dispatch'])assert.equal((await route.GET(new Request('https://portal.example.invalid/?'+query))).status,422);
  const response=await route.GET(new Request('https://portal.example.invalid/?facilityId='+facilityId));assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/private, no-store/);assert.equal((await response.json()).data.providerAttempted,false);
 }finally{delete runtime.refundRouteFixture}
});
