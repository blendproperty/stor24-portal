import test from 'node:test';
import assert from 'node:assert/strict';
import {processMetaConversions} from '../src/lib/meta-conversions';
import {encryptIntegrationSecret} from '../src/lib/integrations/integration-secret-vault';
import type {db} from '../src/lib/db';

test('outbox leases prevent concurrent delivery; transient retries preserve event ID and erase accepted matching data',async()=>{
 const original=globalThis.fetch,env={...process.env};
 process.env.ADVERTISING_ORGANISATION_ID='fixture-org';process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='isolated-fixture-encryption-key-32-characters';
 const event={event_name:'Lead',event_time:Math.floor(Date.now()/1000),event_id:'b'.repeat(64),action_source:'website',event_source_url:'https://stor24.co.za/',user_data:{fbp:`fb.1.${Date.now()}.1`}};
 const job={id:'fixture-job',status:'PENDING',attempts:0,nextAttemptAt:new Date(),payload:{encryptedEvent:encryptIntegrationSecret(JSON.stringify(event))}};
 const config={status:'READY',config:{encryptedToken:encryptIntegrationSecret('fixture-secret')}};
 let calls=0;const ids:string[]=[];
 const client={configurationProfile:{findFirst:async()=>config},webhookOutbox:{
  findMany:async()=>[{...job}],
  updateMany:async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{
   if(!where.id)return {count:0};
   if(where.status!==job.status||where.attempts!==undefined&&where.attempts!==job.attempts||String(where.nextAttemptAt)!==String(job.nextAttemptAt))return {count:0};
   Object.assign(job,{...data,attempts:typeof data.attempts==='object'?job.attempts+1:job.attempts});return {count:1};
  },
 }} as unknown as typeof db;
 try{
  globalThis.fetch=async(_url,init)=>{calls++;ids.push(JSON.parse(String(init?.body)).data[0].event_id);return Response.json(calls===1?{error:{message:'private'}}:{events_received:1},{status:calls===1?429:200});};
  await Promise.all([processMetaConversions(client),processMetaConversions(client)]);
  assert.equal(calls,1);assert.equal(job.status,'FAILED');assert.equal(job.attempts,1);assert.ok(job.payload.encryptedEvent);assert.ok(job.nextAttemptAt.getTime()>Date.now());
  await processMetaConversions(client);assert.equal(calls,2);assert.deepEqual(ids,[event.event_id,event.event_id]);assert.equal(job.status,'SUCCEEDED');assert.deepEqual(job.payload,{});
 }finally{globalThis.fetch=original;process.env=env;}
});

test('disabled server connection makes no provider requests',async()=>{
 const original=globalThis.fetch,env={...process.env};process.env.ADVERTISING_ORGANISATION_ID='fixture-org';
 try{globalThis.fetch=async()=>{throw Error('must not send');};const client={configurationProfile:{findFirst:async()=>({status:'DISABLED'})}} as unknown as typeof db;assert.deepEqual(await processMetaConversions(client),{accepted:0,failed:0});}finally{globalThis.fetch=original;process.env=env;}
});
