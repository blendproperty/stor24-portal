/* eslint-disable @typescript-eslint/no-explicit-any -- Partial database fixtures model only the delegates needed by each security boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { newIdentityAccess, reservationAccessMatches } from "../src/lib/booking-access";

type Bag = Record<string, any>;
async function load(entry: string, db: Bag, scope: Bag = { organisationId: "org", user: { id: "actor" }, userId: "actor", allowedFacilityIds: ["caaaaaaaaaaaaaaaaaaaaaaaa"], facilityIds: ["caaaaaaaaaaaaaaaaaaaaaaaa"], unrestrictedFacilities: false }) {
  const mocks: Record<string, string> = {
    "db": "export const db=__db;",
    "auth-guards": "export const requirePermission=async(p,id)=>{if(id&&__scope.allowedFacilityIds!==null&&!__scope.allowedFacilityIds.includes(id))throw Error('FORBIDDEN');return __scope};export const authErrorResponse=e=>Response.json({error:e.message},{status:e.message==='FORBIDDEN'?403:500});",
    "scope": "export const requireScope=async()=>__scope;export const facilityWhere=s=>({organisationId:s.organisationId});export const requireFacility=async(s,id)=>{if(!s.unrestrictedFacilities&&!s.facilityIds.includes(id))throw Error('FACILITY_FORBIDDEN');return {id}};",
    "request-security": "export const sameOrigin=()=>true;",
    "identity-document-service": "export const identityGate=async()=>true;",
    "tenant-welcome-email": "export const welcomeTenantWhenReady=async()=>{throw Error('Unexpected outbound welcome')};",
  };
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{name:"isolated-boundaries", setup(b) {
    b.onResolve({filter:/^@\/lib\/(db|auth-guards|scope|request-security|identity-document-service|tenant-welcome-email)$/}, a=>({path:a.path.split('/').at(-1)!,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:mocks[a.path]}));
  }}] });
  const loaded={exports:{} as Bag};
  new Function("require","module","exports","__db","__scope",result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,scope);
  return loaded.exports;
}
const request=(body:unknown)=>new Request("https://fixture.invalid/api",{method:"POST",body:JSON.stringify(body)});

test("booking authority rejects missing, malformed, expired and another booking's grants",()=>{
  const grant=newIdentityAccess(), other=newIdentityAccess();
  const booking={...grant,publicLease:null};
  for(const token of ["", "ST24-20261024-ABC123", "a".repeat(43), other.token, grant.token+"x"]) assert.equal(reservationAccessMatches(token,booking),false);
  assert.equal(reservationAccessMatches(grant.token,booking),true);
  assert.equal(reservationAccessMatches(grant.token,{...booking,identityAccessExpiresAt:new Date(0)}),false);
  const lease={signingToken:other.token,status:"READY",expiresAt:new Date(Date.now()+60000)};
  assert.equal(reservationAccessMatches(other.token,{...booking,publicLease:lease}),true);
  assert.equal(reservationAccessMatches(other.token,{...booking,publicLease:{...lease,expiresAt:new Date(0)}}),false);
  assert.equal(reservationAccessMatches(other.token,{...booking,publicLease:{...lease,status:"SIGNED",expiresAt:new Date(0)}}),true);
});

test("actual lease service denies token recovery and mutations, while verified preparation resumes",async()=>{
  const grant=newIdentityAccess();let writes=0;
  const booking:Bag={id:"booking",...grant,status:"ACTIVE",journey:"RENTAL",contactVerifiedAt:new Date(),customer:{organisationId:"org",firstName:"Synthetic",lastName:"Customer",emailVerifiedAt:new Date()},facility:{name:"Synthetic store"},facilityId:"caaaaaaaaaaaaaaaaaaaaaaaa",unit:{number:"1",unitType:{name:"Synthetic"}},intendedMoveIn:new Date("2026-11-01"),quotedRate:100,holdExpiresAt:new Date(Date.now()+86400000),createdAt:new Date(),publicLease:null,packageSelection:null};
  const tx:Bag={reservation:{findUnique:async()=>booking,update:async()=>{writes++;return booking}},$queryRaw:async()=>[],publicReservationLease:{upsert:async({create,update}:Bag)=>{writes++;booking.publicLease={id:"lease",status:"READY",...(booking.publicLease?{...booking.publicLease,...update}:create)};return booking.publicLease}},auditEvent:{create:async()=>{writes++;return {}}}};
  const service=await load("src/lib/public-lease-workflow.ts",{$transaction:async(fn:any)=>fn(tx)});
  for(const token of [undefined,"wrong",newIdentityAccess().token]) {const out=await service.preparePublicReservationLease("REF","CARD",token);assert.equal(out.code,"ID_SESSION_REQUIRED");assert.equal(writes,0);}
  const first=await service.preparePublicReservationLease("REF","CARD",grant.token);assert.equal(first.ok,true);assert.equal(writes,3);
  const again=await service.preparePublicReservationLease("REF","CARD",grant.token);assert.equal(again.token,first.token);
  writes=0;booking.identityAccessExpiresAt=new Date(0);
  const denied=await service.preparePublicReservationLease("REF","EFT",grant.token);assert.equal(denied.code,"ID_SESSION_REQUIRED");assert.equal(writes,0);assert.equal(booking.publicLease.paymentMethod,"CARD");
});

test("global configuration writes require unrestricted scope; facility profile remains usable",async()=>{
 let writes=0;const delegate={findFirst:async()=>null,create:async({data}:Bag)=>{writes++;return {id:"setting",...data}}};
 const tx={configurationProfile:delegate,integrationConnection:delegate,auditEvent:{create:async()=>({})}};
 const route=await load("src/app/api/v1/configuration/route.ts",{$transaction:async(fn:any)=>fn(tx)});
 const profile={domain:"PROGRAM_DEFAULTS",name:"Synthetic",status:"READY",config:{}};
 for(const payload of [{kind:"profile",payload:profile},{kind:"profile",payload:{...profile,facilityId:null}},{kind:"integration",payload:{category:"PHONE",provider:"Synthetic",status:"CONFIGURED",config:{}}},{kind:"charge",payload:{code:"TEST",name:"Test",amount:1}},{kind:"discount",payload:{code:"TEST",name:"Test",discountType:"FIXED",value:1,rules:{}}}])assert.equal((await route.PUT(request(payload))).status,403);
 assert.equal(writes,0);assert.equal((await route.PUT(request({kind:"profile",payload:{...profile,facilityId:"caaaaaaaaaaaaaaaaaaaaaaaa"}}))).status,200);assert.equal(writes,1);
 assert.equal((await route.PUT(request({kind:"profile",payload:{...profile,facilityId:"cbbbbbbbbbbbbbbbbbbbbbbbb"}}))).status,403);assert.equal(writes,1);
});

test("scoped task PATCH denies hidden portfolio tasks before write or readback",async()=>{
 let writes=0;const route=await load("src/app/api/v1/operations/tasks/[id]/route.ts",{task:{findFirst:async()=>({id:"global",organisationId:"org",facilityId:null,purpose:"GENERAL"})},$transaction:async()=>{writes++;throw Error("Unexpected transaction")}});
 const response=await route.PATCH(request({status:"COMPLETED"}),{params:Promise.resolve({id:"global"})});assert.equal(response.status,403);assert.equal(writes,0);assert.equal(JSON.stringify(await response.json()).includes('"id":"global"'),false);
});

test("decorative map relationships are rejected and historical foreign unit projections are stripped",async()=>{
 const foreign={id:"foreign",facilityId:"cbbbbbbbbbbbbbbbbbbbbbbbb",floor:"ground",unitType:{name:"private"}};
 const route=await load("src/app/api/v1/facility-map/route.ts",{facility:{findMany:async()=>[{id:"caaaaaaaaaaaaaaaaaaaaaaaa",closedFloors:[],maps:[{name:"ground",elements:[{type:"LABEL",unitId:"foreign",unit:foreign},{type:"UNIT",unitId:"foreign",unit:foreign},{type:"UNIT",unitId:"own",unit:{...foreign,id:"own",facilityId:"caaaaaaaaaaaaaaaaaaaaaaaa"}}]}]}]}});
 for(const extra of [{unitId:"foreign"},{unitId:""},{unit:{unitTypeId:"foreign",number:"X",monthlyRate:1}}])assert.equal((await route.POST(request({facilityId:"caaaaaaaaaaaaaaaaaaaaaaaa",name:"ground",width:500,height:500,elements:[{id:"label",type:"LABEL",x:0,y:0,width:10,height:10,...extra}]}))).status,422);
 const response=await route.GET(new Request("https://fixture.invalid/api?facilityId=caaaaaaaaaaaaaaaaaaaaaaaa"));assert.equal(response.status,200);const elements=(await response.json()).data[0].maps[0].elements;
 for(const row of elements.slice(0,2)){assert.equal(row.unit,null);assert.equal(row.unitId,null)}assert.equal(elements[2].unit.id,"own");
 assert.equal((await route.GET(new Request("https://fixture.invalid/api?facilityId=cbbbbbbbbbbbbbbbbbbbbbbbb"))).status,403);
});

test("facility-limited insurance managers cannot create portfolio plans",async()=>{
 const service=await load("src/lib/insurance-service.ts",{});
 const scope={organisationId:"org",userId:"actor",facilityIds:["caaaaaaaaaaaaaaaaaaaaaaaa"],unrestrictedFacilities:false};
 await assert.rejects(service.createInsurancePlan(scope,{code:"TEST",name:"Synthetic",coverageAmount:100,monthlyPremium:1}),/FACILITY_FORBIDDEN/);
});
