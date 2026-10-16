import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {debiCheckHistoryQuery,debiCheckHistorySnapshot} from '../src/lib/payments/netcash-debicheck-history-policy';

const facilityId='cmfixturefacility000000001',id='debicheck-attempt:11111111-1111-4111-8111-111111111111';
const attempt={id,requestId:id.replace('attempt','request'),accountNumber:'SYNTHETIC-001',bankSuffix:'2345',monthlyAmount:'950.00',startDate:'2026-11-01',claimedAt:'2026-10-15T12:00:00.000Z',completedAt:null,status:'CLAIMED',bankAuthenticationObserved:false,originalContractAvailable:false,reconciliationRequired:true,retryAllowed:false,collectionAuthorised:false,financialReceipt:false};
const empty={facilityId,attempts:[],selected:null,observations:[],nextCursor:null,nextObservationCursor:null,providerQueried:false};
test('history projections reject invented payment authority, private fields and cross-attempt observations',()=>{
 assert.ok(debiCheckHistorySnapshot.parse({...empty,attempts:[attempt]}));
 for(const change of [{retryAllowed:true},{collectionAuthorised:true},{financialReceipt:true},{contractReference:'NC000000000001'},{encryptedTerms:'private'},{status:'BANK_AUTHENTICATED',bankAuthenticationObserved:true},{status:'OUTCOME_UNKNOWN',reconciliationRequired:false}])assert.throws(()=>debiCheckHistorySnapshot.parse({...empty,attempts:[{...attempt,...change}]}));
 assert.throws(()=>debiCheckHistorySnapshot.parse({...empty,providerQueried:true}));
 assert.throws(()=>debiCheckHistorySnapshot.parse({...empty,selected:attempt,observations:[{id:'observation',attemptId:'foreign',observedAt:attempt.claimedAt,bankAuthenticationObserved:true,retryAllowed:false,collectionAuthorised:false,financialReceipt:false}]}));
 for(const change of [{environment:'live'},{serviceKey:'caller-value'},{status:'ACCEPTED'},{cursor:'x'.repeat(801)}])assert.throws(()=>debiCheckHistoryQuery.parse({facilityId,...change}));
});
test('retained history GET requires current payment scope, bounded unique filters and rate limit without a write entry point',async()=>{
 const state={auth:true,allowed:true,limited:false,calls:0,permission:'',failure:''};
 const mocks:Record<string,string>={
  '@/lib/scope':`export async function requirePermissionScope(permission){__state.permission=permission;if(!__state.auth)throw Error('UNAUTHENTICATED');if(!__state.allowed)throw Error('FORBIDDEN');return {userId:'staff',organisationId:'org',facilityIds:['${facilityId}'],unrestrictedFacilities:false}}`,
  '@/lib/auth-guards':`export function authErrorResponse(e){return Response.json({error:{message:['UNAUTHENTICATED','FORBIDDEN'].includes(e.message)?e.message:'The request could not be completed.'}},{status:e.message==='UNAUTHENTICATED'?401:e.message==='FORBIDDEN'?403:500})}`,
  '@/lib/request-security':`export const rateLimit=async()=>__state.limited`,
  '@/lib/payments/netcash-debicheck-history-service':`export async function readDebiCheckHistory(){__state.calls++;if(__state.failure)throw Error(__state.failure);return __empty}`,
 };
 const built=await build({entryPoints:['src/app/api/v1/payments/netcash/debicheck/history/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'read-only-history-fixture',setup(b){b.onResolve({filter:/^@\/lib\//},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}))}}]});
 const loaded={exports:{} as {GET:(request:Request)=>Promise<Response>;POST?:unknown}};
 new Function('require','module','exports','__state','__empty',built.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,state,empty);
 const read=(query='facilityId='+facilityId)=>loaded.exports.GET(new Request('https://portal.example.invalid/history?'+query));
 assert.equal(loaded.exports.POST,undefined);
 state.auth=false;assert.equal((await read()).status,401);state.auth=true;state.allowed=false;assert.equal((await read()).status,403);state.allowed=true;
 for(const query of ['',`facilityId=${facilityId}&facilityId=${facilityId}`,`facilityId=${facilityId}&status=ACCEPTED`,`facilityId=${facilityId}&environment=live`,`facilityId=${facilityId}&cursor=${'x'.repeat(801)}`])assert.equal((await read(query)).status,422);
 state.limited=true;assert.equal((await read()).status,429);assert.equal(state.calls,0);state.limited=false;
 const response=await read();assert.equal(response.status,200);assert.equal(state.permission,'payments.view');assert.match(response.headers.get('cache-control')??'',/private, no-store/);assert.deepEqual((await response.json()).data,empty);
 for(const [error,status]of [['DEBICHECK_HISTORY_NOT_FOUND',404],['DEBICHECK_HISTORY_INTEGRITY',409],['DEBICHECK_HISTORY_QUERY',422],['FORBIDDEN',403],['Unknown provider secret',500]]as const){state.failure=error;const value=await read();assert.equal(value.status,status);assert.ok(!(await value.text()).includes('provider secret'))}
});
