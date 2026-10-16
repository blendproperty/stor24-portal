import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
test('bank test actions enforce exact purpose, current scoped permission, origin, bounded shape and no GET replay',async()=>{
 const state={auth:true,allowed:true,origin:true,limited:false,permission:'',facility:'',submits:0,reads:0,error:''};
 const mocks:Record<string,string>={
  '@/lib/scope':`export async function requirePermissionScope(permission,facility){__state.permission=permission;__state.facility=facility;if(!__state.auth)throw Error('UNAUTHENTICATED');if(!__state.allowed)throw Error('FORBIDDEN');return{organisationId:'synthetic',userId:'synthetic-staff',facilityIds:[facility],unrestrictedFacilities:false}}`,
  '@/lib/auth-guards':`export function authErrorResponse(e){return Response.json({error:{message:e.message==='UNAUTHENTICATED'?'Sign in':e.message==='FORBIDDEN'?'Forbidden':'The request could not be completed.'}},{status:e.message==='UNAUTHENTICATED'?401:e.message==='FORBIDDEN'?403:500})}`,
  '@/lib/request-security':`export const sameOrigin=()=>__state.origin;export const rateLimit=async()=>__state.limited`,
  '@/lib/payments/netcash-debicheck-test-worker':`export async function submitReviewedDebiCheckTest(_scope,input){__state.submits++;if(__state.error)throw Error(__state.error);return{synthetic:true,confirmed:input.confirmed}};export async function reconcileDebiCheckTest(){__state.reads++;return{retained:false}}`,
 };
 const compiled=await build({entryPoints:['src/app/api/v1/payments/netcash/debicheck/test-actions/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'test-actions-admission',setup(b){b.onResolve({filter:/^@\/lib\//},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}))}}]});
 const loaded={exports:{}as{POST:(request:Request)=>Promise<Response>;GET?:unknown;maxDuration:number}};new Function('require','module','exports','__state',compiled.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,state);
 assert.equal(loaded.exports.GET,undefined);assert.ok(loaded.exports.maxDuration>=240);
 const facilityId='cmfixturefacility000000001',accountId='cmfixtureaccount000000001',consentId='debicheck-bank-consent:11111111-1111-4111-8111-111111111111',attemptId=consentId.replace('bank-consent','attempt');
 const submission={action:'submit-test',facilityId,accountId,consentId,confirmation:'SUBMIT ONE BANK TEST'},read={action:'read-status',facilityId,accountId,attemptId,confirmed:true};
 const post=(body:object)=>loaded.exports.POST(new Request('https://portal.example.invalid/action',{method:'POST',body:JSON.stringify(body)}));
 for(const extra of [{serviceKey:'forged'},{merchantAccount:'forged'},{providerApproval:true},{contractReference:'NC000000000001'},{actorId:'forged'},{monthlyAmount:'1.00'},{environment:'live'},{retry:true}])assert.equal((await post({...submission,...extra})).status,422);
 assert.equal((await post({...submission,confirmation:'SUBMIT'})).status,422);assert.equal((await post({...submission,oversize:'x'.repeat(4100)})).status,422);assert.equal(state.submits,0);
 state.origin=false;assert.equal((await post(submission)).status,403);state.origin=true;state.auth=false;assert.equal((await post(submission)).status,401);state.auth=true;state.allowed=false;assert.equal((await post(submission)).status,403);state.allowed=true;state.limited=true;assert.equal((await post(submission)).status,429);state.limited=false;assert.equal(state.submits,0);
 const result=await post(submission);assert.equal(result.status,200);assert.match(result.headers.get('cache-control')??'',/private, no-store/);assert.equal(state.permission,'payments.bank_auth_submit');assert.equal(state.facility,facilityId);assert.equal((await result.json()).data.confirmed,true);assert.equal(state.submits,1);assert.equal(state.reads,0);
 assert.equal((await post(read)).status,200);assert.equal(state.permission,'payments.bank_auth_status');assert.equal(state.facility,facilityId);assert.equal(state.reads,1);assert.equal(state.submits,1);
 state.error='Private provider key diagnostics';const failed=await post(submission);assert.equal(failed.status,500);assert.ok(!(await failed.text()).includes('provider key'));state.error='DEBICHECK_TEST_SUBMISSION_DISABLED';assert.equal((await post(submission)).status,409);
});
