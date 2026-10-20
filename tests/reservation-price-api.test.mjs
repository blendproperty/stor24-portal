import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {randomUUID} from "node:crypto";
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"isolated-price-routes",setup(b){
  b.onResolve({filter:/(?:auth-guards|request-security|reservation-price-service|public-booking-service|public-lease-workflow)$/},args=>({path:args.path,namespace:"price-fixture"}));
  b.onLoad({filter:/.*/,namespace:"price-fixture"},args=>({contents:args.path.endsWith("auth-guards")?"export const requirePermission=(...args)=>globalThis.__priceApi.authorise(...args);":args.path.endsWith("request-security")?"export const sameOrigin=request=>request.headers.get('origin')==='https://fixture.invalid';export const requestIp=()=> 'synthetic-ip';export const privacyHash=()=> 'synthetic-hash';export const rateLimit=async()=>globalThis.__priceApi.limited;":args.path.endsWith("public-booking-service")?"export const startPublicEmailVerification=(...args)=>globalThis.__priceApi.call('start',args);export const verifyPublicReservationEmail=(...args)=>globalThis.__priceApi.call('verify',args);":args.path.endsWith("public-lease-workflow")?"export const preparePublicReservationLease=(...args)=>globalThis.__priceApi.call('agreement',args);":"export const prepareStaffReservationQuote=(...args)=>globalThis.__priceApi.call('prepare',args);export const sendReservationPriceReview=(...args)=>globalThis.__priceApi.call('send',args);export const proposeReservationPrice=(...args)=>globalThis.__priceApi.call('propose',args);export const decideReservationPrice=(...args)=>globalThis.__priceApi.call('decide',args);export const reservationPriceWorkspace=(...args)=>globalThis.__priceApi.call('workspace',args);export const reservationPriceVerificationAvailable=(...args)=>globalThis.__priceApi.call('available',args);export const previewCustomerReservationPrice=(...args)=>globalThis.__priceApi.call('preview',args);export const acceptCustomerReservationPrice=(...args)=>globalThis.__priceApi.call('accept',args);export const appliedCustomerReservationPrice=(...args)=>globalThis.__priceApi.call('applied',args);"}));
}}]});return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);}
const request=(url,body,origin="https://fixture.invalid")=>new Request(`https://fixture.invalid${url}`,{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});

test("actual staff price routes authenticate before body reads and require all grants in the selected store",async()=>{
  const api=await compile("src/app/api/v1/reservations/prices/route.ts"),previous=globalThis.__priceApi;
  let authenticated=true,denied="",mixed=false,calls=[];
  globalThis.__priceApi={authorise:async(permission,facilityId)=>{if(!authenticated)throw Error("UNAUTHENTICATED");if(permission===denied)throw Error("FORBIDDEN");const allowed=mixed&&permission==="billing.view"?["other"]:["store"];if(facilityId&&!allowed.includes(facilityId))throw Error("FORBIDDEN");return {user:{id:"staff"},organisationId:"org",allowedFacilityIds:allowed};},call:async(name,args)=>{calls.push({name,args});return name==="workspace"?{reservation:{id:"booking",facilityId:"store"},amendments:[],blockers:[]}:{id:"proposal"};}};
  const proposal={action:"propose",reservationId:"booking",facilityId:"store",requestKey:randomUUID(),monthlyRate:"900.25",reason:"Synthetic negotiated quote for review"};
  try{
    authenticated=false;assert.equal((await api.POST({headers:new Headers({origin:"https://fixture.invalid"}),get body(){throw Error("Private body read without authentication");}})).status,401);assert.equal(calls.length,0);authenticated=true;
    for(const permission of ["reservation_prices.view","reservations.manage","billing.view","reservation_prices.propose"]){denied=permission;assert.equal((await api.POST(request("/api/v1/reservations/prices",proposal))).status,403);assert.equal(calls.length,0);}denied="";
    mixed=true;assert.equal((await api.GET(new Request("https://fixture.invalid/api/v1/reservations/prices?reference=booking"))).status,403);assert.equal(calls.length,0);mixed=false;
    assert.equal((await api.POST(request("/api/v1/reservations/prices",proposal,"https://other.invalid"))).status,403);assert.equal(calls.length,0);
    assert.equal((await api.POST(request("/api/v1/reservations/prices",{...proposal,monthlyRate:"1.001"}))).status,422);assert.equal(calls.length,0);
    assert.equal((await api.POST(request("/api/v1/reservations/prices",{...proposal,extra:"x".repeat(17000)}))).status,413);assert.equal(calls.length,0);
    assert.equal((await api.POST(request("/api/v1/reservations/prices",proposal))).status,200);assert.equal(calls[0].name,"propose");assert.equal("action" in calls[0].args[1],false);
    calls=[];
    const prepare={action:"prepare",reservationId:"booking",facilityId:"store",confirmed:true};
    assert.equal((await api.POST(request("/api/v1/reservations/prices",{...prepare,confirmed:false}))).status,422);assert.equal(calls.length,0);
    for(const permission of ["reservation_prices.propose","reservations.manage","billing.view"]){denied=permission;assert.equal((await api.POST(request("/api/v1/reservations/prices",prepare))).status,403);assert.equal(calls.length,0);}denied="";
    assert.equal((await api.POST(request("/api/v1/reservations/prices",prepare))).status,200);assert.equal(calls[0].name,"prepare");calls=[];
    const send={action:"send",id:"proposal",facilityId:"store",confirmed:true};
    denied="operations.manage";assert.equal((await api.POST(request("/api/v1/reservations/prices",send))).status,403);assert.equal(calls.length,0);denied="";
    assert.equal((await api.POST(request("/api/v1/reservations/prices",send))).status,200);assert.equal(calls[0].name,"send");
    calls=[];denied="reservation_prices.approve";assert.equal((await api.POST(request("/api/v1/reservations/prices",{action:"decide",id:"proposal",facilityId:"store",revision:0,decision:"APPROVED",reference:"Synthetic review",confirmed:true}))).status,403);assert.equal(calls.length,0);
  }finally{if(previous===undefined)delete globalThis.__priceApi;else globalThis.__priceApi=previous;}
});
test("actual customer quote route checks approved source before OTP and cannot accept an implicit price or payment command",async()=>{
  const api=await compile("src/app/api/booking-price-review/route.ts"),previous=globalThis.__priceApi;let calls=[],available=true;
  const fixture={limited:false,call:async(name,args)=>{calls.push({name,args});if(name==="available"&&!available)throw Error("NOT_FOUND");if(name==="start")return {ok:true};if(name==="verify")return {ok:true,identityAccessToken:"a".repeat(43)};if(name==="agreement")return {ok:true,status:"READY",token:"c".repeat(43)};return {id:"proposal",applied:true};}};globalThis.__priceApi=fixture;
  const common={reference:"booking",id:"proposal"},acceptance={...common,action:"accept",identityAccessToken:"a".repeat(43),quoteFingerprint:"b".repeat(64),accepted:true,understandsNewAgreementRequired:true};
  try{
    assert.equal((await api.POST(request("/api/booking-price-review",{...common,action:"request-code"},"https://other.invalid"))).status,403);assert.equal(calls.length,0);
    available=false;assert.equal((await api.POST(request("/api/booking-price-review",{...common,action:"request-code"}))).status,404);assert.deepEqual(calls.map(c=>c.name),["available"]);calls=[];available=true;
    fixture.limited=true;assert.equal((await api.POST(request("/api/booking-price-review",{...common,action:"request-code"}))).status,429);assert.equal(calls.length,0);fixture.limited=false;
    assert.equal((await api.POST(request("/api/booking-price-review",{...common,action:"request-code"}))).status,200);assert.deepEqual(calls.map(c=>c.name),["available","start"]);assert.equal(calls[1].args[1],true);assert.equal(calls[1].args[2],"proposal");calls=[];
    for(const change of [{accepted:false},{understandsNewAgreementRequired:false},{takePayment:true},{staffAccepted:true}]){assert.equal((await api.POST(request("/api/booking-price-review",{...acceptance,...change}))).status,422);assert.equal(calls.length,0);}
    assert.equal((await api.POST(request("/api/booking-price-review",acceptance))).status,200);assert.equal(calls[0].name,"accept");assert.equal("action" in calls[0].args[0],false);calls=[];
    assert.equal((await api.POST(request("/api/booking-price-review",{...common,action:"agreement",identityAccessToken:"a".repeat(43),paymentMethod:"DEBIT_ORDER"}))).status,422);assert.equal(calls.length,0);
    assert.equal((await api.POST(request("/api/booking-price-review",{...common,action:"agreement",identityAccessToken:"a".repeat(43),paymentMethod:"EFT"}))).status,200);assert.deepEqual(calls.map(c=>c.name),["applied","agreement"]);
  }finally{if(previous===undefined)delete globalThis.__priceApi;else globalThis.__priceApi=previous;}
});
test("customer quote middleware exemption is exact and never exposes neighbouring staff or API paths",async()=>{
  const compiled=await build({entryPoints:["src/proxy.ts"],bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"isolated-price-proxy",setup(b){
    b.onResolve({filter:/^(?:next\/server|@\/lib\/(?:session|navigation-access|db))$/},args=>({path:args.path,namespace:"price-proxy-fixture"}));
    b.onLoad({filter:/.*/,namespace:"price-proxy-fixture"},args=>({contents:args.path==="next/server"?"export const NextResponse={};":args.path.endsWith("session")?"export const sessionCookieName='fixture';export const verifySessionToken=async()=>null;":args.path.endsWith("navigation-access")?"export const canVisit=()=>false;":"export const db={};"}));
  }}]});
  const proxy=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  assert.equal(proxy.isPublicPathname("/booking-price-review"),true);assert.equal(proxy.isPublicPathname("/api/booking-price-review"),true);
  for(const path of ["/booking-price-review/admin","/api/booking-price-review/debug","/reservations/prices","/api/v1/reservations/prices","/api/v1/reservations"])assert.equal(proxy.isPublicPathname(path),false,path);
});
