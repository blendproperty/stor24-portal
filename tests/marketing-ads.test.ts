import {generateKeyPair,exportPKCS8} from "jose";
import test from 'node:test';import assert from 'node:assert/strict';
import {googleAdvertisingQuery,googleAdvertising,metaAdvertising} from '../src/lib/marketing-ads';
test('advertising query requires exact numeric campaign allowlist and rejects injection',()=>{
 const q=googleAdvertisingQuery('2026-09-01','2026-09-30','24315692802,24315694704');assert.match(q,/campaign.id IN \(24315692802,24315694704\)/);assert.match(q,/LIMIT 10000/);
 for(const ids of ['',"1) OR 1=1",'abc','1,2,'])assert.throws(()=>googleAdvertisingQuery('2026-09-01','2026-09-30',ids));
 assert.throws(()=>googleAdvertisingQuery("2026-01-01'",'2026-09-30','1'));
});
test('unconfigured providers return unavailable evidence rather than invented zero performance',async()=>{
 const env={...process.env};try{delete process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON;delete process.env.META_ADS_ACCESS_TOKEN;for(const f of [await googleAdvertising('2026-09-01','2026-09-30'),await metaAdvertising('2026-09-01','2026-09-30')]){assert.equal(f.status,'unconfigured');assert.deepEqual(f.rows,[]);assert.equal(f.retrievedAt,null)}}finally{process.env=env}
});
test('Meta pagination keeps credentials in headers and ignores provider-supplied destinations',async()=>{
 const original=globalThis.fetch;const urls:string[]=[];let calls=0;
 try{globalThis.fetch=async(input,init)=>{urls.push(String(input));assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer server-token');calls++;return Response.json({data:[{campaign_id:'123',campaign_name:'Storage',date_start:'2026-09-01',account_currency:'ZAR',spend:'10.50',impressions:'100',clicks:'3'}],...(calls===1?{paging:{next:'https://attacker.invalid/',cursors:{after:'bounded-cursor'}}}:{})});};
 const feed=await metaAdvertising('2026-09-01','2026-09-30',{token:'server-token',account:'1064679099720272',version:'v25.0'});assert.equal(feed.status,'connected');assert.equal(feed.rows[0].spend,10.5);assert.equal(feed.rows[0].conversions,null);assert.equal(calls,2);assert.ok(urls.every(u=>u.startsWith('https://graph.facebook.com/v25.0/act_1064679099720272/insights?')));assert.ok(urls.every(u=>!u.includes('server-token')));
 }finally{globalThis.fetch=original;}
});
test('provider failures and invalid metrics disclose no raw provider details or credentials',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({error:{message:'private token server-token'}},{status:403});const feed=await metaAdvertising('2026-09-01','2026-09-30',{token:'server-token',account:'1064679099720272',version:'v25.0'});assert.equal(feed.status,'unavailable');assert.ok(!JSON.stringify(feed).includes('server-token'));assert.deepEqual(feed.rows,[]);}finally{globalThis.fetch=original;}
});

test('STOR24 Google reporting includes approved Micro under legacy scope and still rejects unrequested rows',async()=>{
 const env={...process.env},original=globalThis.fetch;const {privateKey}=await generateKeyPair('RS256',{extractable:true});let unexpected=false;
 try{
 process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON=JSON.stringify({client_email:'fixture@fixture.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey)});
 process.env.GOOGLE_ADS_DEVELOPER_TOKEN='fixture-developer';process.env.GOOGLE_ADS_CUSTOMER_ID='5635711564';process.env.GOOGLE_ADS_CAMPAIGN_IDS='24315692802,24315694704';delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
 globalThis.fetch=async(input,init)=>{
  if(String(input)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access'});
  assert.equal(String(input),'https://googleads.googleapis.com/v25/customers/5635711564/googleAds:search');
  assert.match(JSON.parse(String(init?.body)).query,/campaign.id IN \(24315692802,24315694704,24352709658\)/);
  return Response.json({results:[{campaign:{id:unexpected?'99999999999':'24352709658',name:'Micro'},segments:{date:'2026-11-02'},customer:{currencyCode:'ZAR'},metrics:{costMicros:'1000000',impressions:'10',clicks:'1',conversions:0}}]});
 };
 const report=await googleAdvertising('2026-11-02','2026-11-02');assert.equal(report.status,'connected');assert.equal(report.rows[0].campaignId,'24352709658');assert.equal(report.rows[0].clicks,1);
 unexpected=true;const rejected=await googleAdvertising('2026-11-02','2026-11-02');assert.equal(rejected.status,'unavailable');assert.deepEqual(rejected.rows,[]);
 }finally{globalThis.fetch=original;process.env=env;}
});
