import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";

test("Pay now checkout locks the booking and rejects a changed or expired quote before provider checkout",async()=>{
 const compiled=await build({entryPoints:["src/lib/public-netcash-payment.ts"],bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"checkout-price-fixture",setup(b){
  b.onResolve({filter:/^(?:@\/lib\/|\.\/public-initial-rent)/},a=>({path:a.path,namespace:"fixture"}));
  b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db")?"export const db=globalThis.__checkoutPrice.db;":a.path.endsWith("/netcash-service")?"export const createOnceOffCheckout=(...args)=>globalThis.__checkoutPrice.checkout(...args);":a.path.endsWith("/netcash-client")?'export const getNetcashConnection=async()=>({config:{environment:"sandbox"}});':a.path.endsWith("/payment-evidence")?'export const isTestPayment=()=>true;':a.path.endsWith("/tenant-welcome-email")?'export const welcomeTenantWhenReady=async()=>{};':'export const publicCheckoutTotal=r=>Number(r.quotedRate);'}));
 }}]});
 const previous=globalThis.__checkoutPrice,events=[];
 const reservation={id:"booking",customerId:"customer",status:"ACTIVE",journey:"RENTAL",contactVerifiedAt:new Date(),customer:{organisationId:"org",email:"test@example.invalid",emailVerifiedAt:new Date()},facility:{name:"Synthetic store"},unit:{number:"53"},quotedRate:1250,holdExpiresAt:new Date(Date.now()+86400000)};
 let current={...reservation};
 const tx={$queryRaw:async()=>{events.push("lock");},reservation:{findUniqueOrThrow:async()=>{events.push("current");return current;}}};
 globalThis.__checkoutPrice={db:{reservation:{findUnique:async()=>reservation},account:{upsert:async()=>({id:"account",customerId:"customer"})},$transaction:async work=>work(tx),auditEvent:{create:async()=>{events.push("audit");}}},checkout:async(...args)=>{events.push("checkout");assert.equal(args[2].amount,1250);return {payment:{id:"payment",currency:"ZAR"},checkout:{}};}};
 try{
  const service=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  current={...reservation,quotedRate:1100};await assert.rejects(service.startPublicNetcashSandboxPayment("REF","key"),/QUOTE_CHANGED/);assert.deepEqual(events,["lock","current"]);
  events.length=0;current={...reservation,holdExpiresAt:new Date(0)};await assert.rejects(service.startPublicNetcashSandboxPayment("REF","key"),/QUOTE_CHANGED/);assert.deepEqual(events,["lock","current"]);
  events.length=0;current={...reservation};assert.equal((await service.startPublicNetcashSandboxPayment("REF","key")).ok,true);assert.deepEqual(events,["lock","current","checkout","audit"]);
 }finally{if(previous===undefined)delete globalThis.__checkoutPrice;else globalThis.__checkoutPrice=previous;}
});
