import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, mocks) {
  const fixtureModule = {exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:fixtureModule,exports:fixtureModule.exports,Response,Date,require:name=>{if (!(name in mocks)) throw new Error(`Unexpected import ${name}`);return mocks[name];}});
  return fixtureModule.exports;
}
test('assisted move-in keeps its saved lease on dispatch failure and scopes creation to the chosen facility', async () => {
  let dispatchFails = false, mode, permission, redirected;
  const parsed={facilityId:'store',paymentMethod:'EFT',startDate:new Date()};
  const mocks={
    'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:path=>{redirected=path;}},
    '@/lib/leasing-service':{moveIn:async()=>({tenancy:{accountId:'account'},document:{id:'saved-doc'}})},
    '@/lib/blendsign-lease-service':{dispatchBlendSignLease:async (_scope,_result,input)=>{mode=input.invitationDelivery;if(dispatchFails)throw new Error('Provider failed');}},
    '@/lib/scope':{requirePermissionScope:async (p,f)=>{permission=[p,f];return {}; }},
    '@/lib/validators':{moveInSchema:{parse:()=>parsed}},'@/lib/auth-guards':{},'@/lib/reservation-move-in':{},'@/lib/db':{},
  };
  const action=load('src/app/actions/leasing.ts',mocks).moveInAction;
  const data=new FormData(); await action(data);
  assert.equal(mode,'ASSISTED'); assert.equal(permission.join(','),'move_in.create,store'); assert.equal(redirected,'/operations/lease-signing?document=saved-doc');
  data.set('invitationDelivery','EMAIL');await action(data);assert.equal(mode,'EMAIL');assert.equal(redirected,'/operations/accounts?accountId=account');
  // Real Next redirects throw to terminate the action.
  mocks['next/navigation'].redirect=path=>{throw new Error(path);}; dispatchFails=true;
  await assert.rejects(action(data), /document=saved-doc&dispatch=failed/);
});
test('session uses saved signed evidence, denies inactive leases and retains scoped account recovery', async () => {
  let document, query, providerCalls=0;
  const GET=load('src/app/api/v1/documents/[id]/signing-session/route.ts',{
    '@/lib/api':{apiError:()=>Response.json({error:{message:'Unavailable'}},{status:403})},
    '@/lib/blendsign-lease-service':{},'@/lib/request-security':{},'@/lib/db':{db:{document:{findFirst:async args=>{query=args;return document;}}}},
    '@/lib/scope':{requirePermissionScope:async p=>{assert.equal(p,'move_in.create');return {};},facilityWhere:()=>({organisationId:'org',id:{in:['store']}})},
    '@/lib/blendsign-client':{fetchBlendSignSigningSession:async()=>{providerCalls++;return {status:'COMPLETED',signers:[]};}},
  }).GET;
  const get=()=>GET(new Request('https://portal.example.invalid'),{params:Promise.resolve({id:'doc'})});
  document={status:'SENT',signedAt:null,externalId:'envelope',tenancy:{accountId:'account',status:'DRAFT',reservation:{id:'booking',leadId:'lead'}}};
  let response=await get();assert.equal((await response.json()).data.reconciling,true);assert.equal(query.where.tenancy.facility.organisationId,'org');assert.equal(response.headers.get('cache-control'),'no-store');
  document.externalId=null;response=await get();assert.equal((await response.json()).data.dispatchRequired,true);assert.equal(providerCalls,1);
  document.status='CANCELLED';assert.equal((await get()).status,409);
  document.status='SIGNED';document.signedAt=new Date();response=await get();assert.equal((await response.json()).data.completed,true);assert.equal(providerCalls,1);
  document=null;assert.equal((await get()).status,403);
});
