import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverMetaLead,type MetaLeadEvent} from '../src/lib/meta-conversion-delivery';
import {metaConversionConsent} from '../src/lib/meta-conversion-contract';
import {metaWebsiteLeads} from '../src/lib/marketing-ads';
const event:MetaLeadEvent={event_name:'Lead',event_id:'a'.repeat(64),event_time:1793610000,action_source:'website',event_source_url:'https://stor24.co.za/micro-warehousing',user_data:{fbp:'fb.1.1793610000000.12'}};
test('fresh explicit bounded consent is required; private paths and extra fields fail closed',()=>{
 const input={version:'stor24-meta-server-v1',consent:'granted',page:'/micro-warehousing',fbp:event.user_data.fbp};
 assert.equal(metaConversionConsent.safeParse(input).success,true);
 for(const changed of [{consent:'denied'},{version:'legacy'},{page:'/account'},{page:'/book?email=private'},{email:'private'},{fbp:'invalid'}])assert.equal(metaConversionConsent.safeParse({...input,...changed}).success,false);
});
test('Meta website leads exclude overlapping aggregate and instant-form actions',()=>{
 assert.equal(metaWebsiteLeads([{action_type:'lead',value:'20'},{action_type:'omni_lead',value:'20'},{action_type:'onsite_conversion.lead_grouped',value:'5'},{action_type:'offsite_conversion.fb_pixel_lead',value:'15'}]),15);
 assert.equal(metaWebsiteLeads([]),0);assert.equal(metaWebsiteLeads(undefined),null);
 assert.throws(()=>metaWebsiteLeads([{action_type:'offsite_conversion.fb_pixel_lead',value:'NaN'}]));
 assert.throws(()=>metaWebsiteLeads([{action_type:'offsite_conversion.fb_pixel_lead',value:1},{action_type:'offsite_conversion.fb_pixel_lead',value:1}]));
});
test('delivery uses the fixed dataset, secret header and stable browser/server deduplication ID',async()=>{
 const original=globalThis.fetch;try{
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://graph.facebook.com/v25.0/2256945718217336/events');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer secret');const b=JSON.parse(String(init?.body));assert.deepEqual(b.data,[event]);assert.equal(b.test_event_code,'TEST123');assert.ok(!String(init?.body).includes('secret'));return Response.json({events_received:1});};
 assert.deepEqual(await deliverMetaLead('secret',event,'TEST123'),{status:'accepted',http:200});
 }finally{globalThis.fetch=original;}
});
test('transient failures retry; permission failures stop; raw provider errors never escape',async()=>{
 const original=globalThis.fetch;try{
 for(const [http,status] of [[429,'retry'],[503,'retry'],[403,'rejected']] as const){globalThis.fetch=async()=>Response.json({error:{message:'private'}},{status:http});assert.deepEqual(await deliverMetaLead('secret',event),{status,http});}
 globalThis.fetch=async()=>{throw Error('secret private');};assert.deepEqual(await deliverMetaLead('secret',event),{status:'retry',http:0});
 globalThis.fetch=async()=>Response.json({events_received:0});assert.equal((await deliverMetaLead('secret',event)).status,'retry');
 }finally{globalThis.fetch=original;}
});
