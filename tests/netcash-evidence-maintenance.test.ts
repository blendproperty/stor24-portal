import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";

test("maintenance CLI previews first, validates every target, gates apply and prints no payment identifiers",async()=>{
 const organisationId="cmfixtureorg00000000000001",facilityId="cmfixturestore000000000001",paymentId="cmfixturepayment00000000001";
 const valid={organisationId,facilityId,maintenanceReference:"CI developer outcome recovery",paymentIds:[paymentId]};
 type State={input:unknown;live:boolean;calls:number;done:()=>void};
 const runtime=globalThis as typeof globalThis&{netcashMaintenanceFixture?:State};
 const mocks:Record<string,string>={
  "node:fs/promises":`export async function readFile(){return Buffer.from(JSON.stringify(globalThis.netcashMaintenanceFixture.input))}`,
  "../src/lib/db":`export const db={payment:{findFirst:async()=>({providerRef:'private-reference',environment:globalThis.netcashMaintenanceFixture.live?'live':'sandbox',status:'TEST_SUCCEEDED'})},$disconnect:async()=>globalThis.netcashMaintenanceFixture.done()}`,
  "../src/lib/payments/payment-evidence":`export const isTestPayment=()=>true`,
  "../src/lib/payments/netcash-payment-evidence":`export async function netcashPaymentFacility(scope){return scope.facilityIds[0]}export async function recoverNetcashTestPaymentEvidence(){globalThis.netcashMaintenanceFixture.calls++;return{method:'Credit card'}}`,
 };
 const bundle=await build({entryPoints:["scripts/recover-netcash-test-evidence.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"maintenance-fixture",setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:"fixture"}:undefined);b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:mocks[a.path],loader:"js"}))}}]});
 async function run(input:unknown,args:string[],enabled=false,live=false){
  let done!:()=>void;const completed=new Promise<void>(resolve=>{done=resolve});
  const state:State={input,live,calls:0,done};runtime.netcashMaintenanceFixture=state;
  const output:string[]=[];const processFixture={argv:["node","maintenance",...args],env:{NETCASH_EVIDENCE_MAINTENANCE_ENABLED:enabled?"true":"false"},exitCode:0};
  const compiled={exports:{}};
  new Function("require","module","exports","process","console",bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports,processFixture,{log:(v:string)=>output.push(v),error:(v:string)=>output.push(v)});
  await completed;return{state,output,exitCode:processFixture.exitCode};
 }
 try{
  let result=await run(valid,["manifest.json"]);assert.equal(result.exitCode,0);assert.equal(result.state.calls,0);assert.equal(JSON.parse(result.output[0]).metadataWrites,0);
  result=await run(valid,["manifest.json","--apply"]);assert.equal(result.exitCode,1);assert.equal(result.state.calls,0);assert.match(result.output.join(""),/MAINTENANCE_DISABLED/);
  result=await run(valid,["manifest.json","--apply"],true);assert.equal(result.exitCode,0);assert.equal(result.state.calls,1);assert.equal(JSON.parse(result.output[0]).actorKind,"SYSTEM_MAINTENANCE");assert.ok(!result.output.join("").includes(paymentId));assert.ok(!result.output.join("").includes("private-reference"));
  for(const input of[{...valid,actorId:"pretend-staff"},{...valid,paymentIds:[paymentId,paymentId]},{...valid,maintenanceReference:""}]){result=await run(input,["manifest.json","--apply"],true);assert.equal(result.exitCode,1);assert.equal(result.state.calls,0);}
  result=await run(valid,["manifest.json","--apply"],true,true);assert.equal(result.exitCode,1);assert.equal(result.state.calls,0);
 }finally{delete runtime.netcashMaintenanceFixture;}
});
