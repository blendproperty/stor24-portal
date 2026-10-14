import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';
test('DebiCheck template routes require session/manage authority, origin, strict identity and confirmation',async()=>{
 const state={auth:true,manage:true,origin:true,limit:false,calls:0};const runtime=globalThis as typeof globalThis&{debiTemplateRoute?:typeof state};runtime.debiTemplateRoute=state;
 const mocks:Record<string,string>={
  '@/lib/scope':`export async function requirePermissionScope(permission){const s=globalThis.debiTemplateRoute;if(!s.auth)throw Error('UNAUTHENTICATED');if(permission==='payments.manage'&&!s.manage)throw Error('FORBIDDEN');return{userId:'staff',organisationId:'org',facilityIds:['store'],unrestrictedFacilities:false}}`,
  '@/lib/auth-guards':`export function authErrorResponse(e){return Response.json({error:{message:e.message}},{status:e.message==='UNAUTHENTICATED'?401:e.message==='FORBIDDEN'?403:500})}`,
  '@/lib/request-security':`export const sameOrigin=()=>globalThis.debiTemplateRoute.origin;export const rateLimit=async()=>globalThis.debiTemplateRoute.limit`,
  '@/lib/payments/netcash-debicheck-template-service':`export const listDebiCheckTemplates=async()=>{globalThis.debiTemplateRoute.calls++;return{records:[]}};export const observeDebiCheckTemplate=async()=>{globalThis.debiTemplateRoute.calls++;return{status:'PENDING_REVIEW'}};export const reviewDebiCheckTemplate=async()=>{globalThis.debiTemplateRoute.calls++;return{status:'REVIEWED'}}`,
 };
 const result=await build({entryPoints:['src/app/api/v1/payments/netcash/debicheck/templates/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}))}}]});
 const compiled={exports:{} as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const facilityId='cmfixturefacility000000001',post=(body:object)=>compiled.exports.POST(new Request('https://portal.example.invalid/api/v1/payments/netcash/debicheck/templates',{method:'POST',body:JSON.stringify(body)})),input={action:'observe',facilityId,templateId:'NCDCT000000001'};
 try{
  assert.equal((await post(input)).status,200);assert.equal(state.calls,1);
  for(const extra of[{environment:'live'},{serviceKey:'override'},{actorId:'forged'},{collectionEnabled:true}])assert.equal((await post({...input,...extra})).status,422);
  assert.equal((await post({action:'review',id:'debicheck-template:11111111-1111-4111-8111-111111111111',confirmed:false})).status,422);assert.equal((await post({...input,oversize:'x'.repeat(9000)})).status,422);assert.equal(state.calls,1);
  state.auth=false;assert.equal((await post(input)).status,401);state.auth=true;state.manage=false;assert.equal((await post(input)).status,403);state.manage=true;state.origin=false;assert.equal((await post(input)).status,403);state.origin=true;state.limit=true;assert.equal((await post(input)).status,429);state.limit=false;
  const get=(query:string)=>compiled.exports.GET(new Request('https://portal.example.invalid/api/v1/payments/netcash/debicheck/templates?'+query));
  assert.equal((await get('facilityId='+facilityId+'&facilityId='+facilityId)).status,422);assert.equal((await get('facilityId='+facilityId+'&environment=live')).status,422);const response=await get('facilityId='+facilityId);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/private, no-store/);assert.equal(state.calls,2);
 }finally{delete runtime.debiTemplateRoute}
});
