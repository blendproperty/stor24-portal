import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"search-fixture",setup(b){
 b.onResolve({filter:/(?:\/db|auth-guards)$/},args=>({path:args.path,namespace:"fixture"}));
 b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path.endsWith("auth-guards")?"export const requirePermission=(...args)=>globalThis.__priceSearch.authorise(...args);export const requireSession=()=>{};":"export const db={reservation:{findMany:args=>globalThis.__priceSearch.find(args)}};"}));
}}]});return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);}
test("price search intersects every grant, scopes all name OR branches and bounds pages without writes",async()=>{
 const api=await compile("src/app/api/v1/reservations/prices/search/route.ts");let allowed=true,calls=[];const previous=globalThis.__priceSearch;
 globalThis.__priceSearch={authorise:async permission=>{if(!allowed)throw Error("FORBIDDEN");return {user:{id:"staff"},organisationId:"org",allowedFacilityIds:permission==="reservations.manage"?["midpoint"]:["midpoint","other"]};},find:async args=>{calls.push(args);return Array.from({length:21},(_,i)=>({id:`r${i}`,publicReference:`REF${i}`,status:"ACTIVE",quotedRate:{toFixed:()=>"1250.00"},facility:{name:"Midpoint"},unit:{number:"53"},customer:{firstName:"Brett",lastName:"Dovey",companyName:null,email:"test@example.invalid"}}));}};
 const get=query=>api.GET(new Request(`https://fixture.invalid/api/v1/reservations/prices/search?${query}`));
 try{
 allowed=false;assert.equal((await get("query=Brett")).status,403);assert.equal(calls.length,0);allowed=true;
 for(const query of ["query=x","query=Brett&page=-1","query=Brett&page=101","query=Brett&extra=x"]){assert.equal((await get(query)).status,422);assert.equal(calls.length,0);}
 const response=await get("query=Brett%20Dovey&page=1"),data=(await response.json()).data;
 assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(data.items.length,20);assert.equal(data.hasMore,true);
 const args=calls[0];assert.equal(args.take,21);assert.equal(args.skip,20);assert.deepEqual(args.where.facility,{organisationId:"org",id:{in:["midpoint"]}});assert.deepEqual(args.where.customer,{organisationId:"org"});assert.equal(args.where.OR.at(-1).AND.length,2);assert.equal(data.items[0].customer,"Brett Dovey");
 }finally{if(previous===undefined)delete globalThis.__priceSearch;else globalThis.__priceSearch=previous;}
});
