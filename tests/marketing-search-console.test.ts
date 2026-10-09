import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {marketingSearchPerformance} from "../src/lib/marketing-search-console";
test("Search Console fails closed, requests read-only aggregate metrics and keeps credentials private",async()=>{
 const oldAccount=process.env.GSC_SERVICE_ACCOUNT_JSON,oldSite=process.env.GSC_SITE_URL,original=globalThis.fetch;
 try {
  delete process.env.GSC_SERVICE_ACCOUNT_JSON;delete process.env.GSC_SITE_URL;
  globalThis.fetch=async()=>{throw Error("Unexpected provider call");};
  assert.equal((await marketingSearchPerformance("2026-10-01","2026-10-07")).status,"unconfigured");
  const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048,privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});
  process.env.GSC_SERVICE_ACCOUNT_JSON=JSON.stringify({client_email:"reader@example.iam.gserviceaccount.com",private_key:privateKey});process.env.GSC_SITE_URL="sc-domain:stor24.co.za";
  const bodies:Record<string,unknown>[]=[];
  globalThis.fetch=async(url,options)=>{
   if(String(url).includes("oauth2"))return Response.json({access_token:"secret-test-token"});
   assert.match(String(url),/sc-domain%3Astor24.co.za/);bodies.push(JSON.parse(String(options?.body)));
   return Response.json({rows:[{keys:["https://stor24.co.za/"],clicks:12,impressions:120,ctr:.1,position:4}]});
  };
  const data=await marketingSearchPerformance("2026-10-01","2026-10-07");assert.equal(data.status,"connected");assert.equal(data.totals?.clicks,12);assert.equal(data.pages[0].ctr,.1);assert.equal(bodies.length,2);assert.equal(bodies[0].dataState,"final");assert.deepEqual(bodies[1].dimensions,["page"]);assert.ok(!JSON.stringify(data).includes("secret-test-token"));assert.ok(!JSON.stringify(data).includes("PRIVATE KEY"));
  globalThis.fetch=async()=>Response.json({error:"sensitive provider detail"},{status:403});
  const failed=await marketingSearchPerformance("2026-10-01","2026-10-07");assert.equal(failed.status,"unavailable");assert.equal(failed.totals,null);assert.ok(!JSON.stringify(failed).includes("sensitive provider detail"));
 }finally{globalThis.fetch=original;if(oldAccount===undefined)delete process.env.GSC_SERVICE_ACCOUNT_JSON;else process.env.GSC_SERVICE_ACCOUNT_JSON=oldAccount;if(oldSite===undefined)delete process.env.GSC_SITE_URL;else process.env.GSC_SITE_URL=oldSite;}
});
