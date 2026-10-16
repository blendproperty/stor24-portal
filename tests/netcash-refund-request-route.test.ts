import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
test('native provider-refund route has separate SEND grants, strict confirmations and no browser authority overrides',async()=>{
 const state={auth:true,origin:true,limited:false,denied:'',failure:'',calls:0,permissions:[] as string[]};
 const runtime=globalThis as typeof globalThis&{refundSendRouteFixture?:typeof state};runtime.refundSendRouteFixture=state;
 const mocks:Record<string,string>={
  '@/lib/scope':`export async function requirePermissionScope(permission){const s=globalThis.refundSendRouteFixture;s.permissions.push(permission);if(!s.auth)throw Error('UNAUTHENTICATED');if(s.denied===permission)throw Error('FORBIDDEN');return{organisationId:'org',userId:'staff',facilityIds:['store'],unrestrictedFacilities:false}}`,
  '@/lib/auth-guards':`export function authErrorResponse(e){return Response.json({error:{message:'Denied'}},{status:e.message==='UNAUTHENTICATED'?401:e.message==='FORBIDDEN'?403:500})}`,
  '@/lib/request-security':`export const sameOrigin=()=>globalThis.refundSendRouteFixture.origin;export const rateLimit=async()=>globalThis.refundSendRouteFixture.limited`,
  '@/lib/payments/netcash-refund-request-service':`const action=async()=>{const s=globalThis.refundSendRouteFixture;s.calls++;if(s.failure)throw Error(s.failure);return{state:'CLAIMED',financialPosting:false,retryAvailable:false}};export const prepareRefundSend=action,reviewRefundSend=action,sendRefundRequest=action,refundSendHistory=action,closeRefundSend=action,renewRefundSend=action`,
 };
 const compiled={exports:{} as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}},result=await build({entryPoints:['src/app/api/v1/adjustments/netcash-refunds/requests/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'isolated-route',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const facilityId='cmfixturefacility000000001',refundId='netcash-refund:'+'1'.repeat(64),base={facilityId,refundId,reservationRevision:3,attemptRevision:2,reference:'Synthetic explicit review',confirmed:true},post=(body:object)=>compiled.exports.POST(new Request('https://portal.example.invalid/api',{method:'POST',body:JSON.stringify(body)}));
 try{
  for(const[action,confirmation,permission,status]of [['prepare-send','PREPARE REFUND REQUEST','payments.refund_send',200],['review-send','APPROVE REFUND REQUEST','payments.refund_send_review',200],['send','REQUEST NETCASH REFUND','payments.refund_send',202],['withdraw-send','WITHDRAW UNCLAIMED REQUEST','payments.refund_send',200],['reject-send','REJECT UNCLAIMED REQUEST','payments.refund_send_review',200],['renew-send','PREPARE FRESH REFUND REQUEST','payments.refund_send',200]] as const){
   const body={...base,action,confirmation};if(action==='prepare-send')delete (body as Partial<typeof base>).attemptRevision;
   assert.equal((await post({...body,confirmation:'YES'})).status,422);state.denied=permission;assert.equal((await post(body)).status,403);state.denied='';assert.equal((await post(body)).status,status);assert.ok(state.permissions.includes(permission));
  }
  const valid={...base,action:'send',confirmation:'REQUEST NETCASH REFUND'},calls=state.calls;
  for(const forged of [{amount:'1.00'},{serviceKey:'forged'},{merchantKey:'forged'},{approval:{approved:true}},{wireFormat:'DECIMAL_COMMA'},{environment:'sandbox'},{providerAttempted:false},{transactionId:'123'},{actorId:'owner'}])assert.equal((await post({...valid,...forged})).status,422);
  assert.equal((await post({...valid,confirmed:false})).status,422);assert.equal((await post({...valid,reference:'x'.repeat(5000)})).status,422);assert.equal(state.calls,calls);
  state.origin=false;assert.equal((await post(valid)).status,403);state.origin=true;state.auth=false;assert.equal((await post(valid)).status,401);state.auth=true;state.limited=true;assert.equal((await post(valid)).status,429);state.limited=false;assert.equal(state.calls,calls);
  state.failure='NETCASH_REFUND_REQUEST_DISABLED';const rejected=await post(valid);assert.equal(rejected.status,409);assert.match((await rejected.json()).error.message,/must never be retried/);state.failure='';
  const query='facilityId='+facilityId+'&refundId='+refundId;for(const suffix of ['&facilityId='+facilityId,'&environment=live','&approval=true'])assert.equal((await compiled.exports.GET(new Request('https://portal.example.invalid/?'+query+suffix))).status,422);
  const response=await compiled.exports.GET(new Request('https://portal.example.invalid/?'+query));assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/private, no-store/);assert.equal((await response.json()).data.financialPosting,false);
 }finally{delete runtime.refundSendRouteFixture;}
});
