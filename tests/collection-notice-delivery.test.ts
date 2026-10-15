import assert from "node:assert/strict";
import test from "node:test";
import { deliverReviewedNotices } from "../src/lib/collection-notice-delivery";
const items=Array.from({length:3},(_,i)=>({accountId:`account-${i}`,id:`notice-${i}`,revision:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",recipient:`account-${i}@example.invalid`,subject:"Synthetic reminder",text:`Synthetic ${i}`}));
const accepted=(item:typeof items[number])=>({notice:{...item,status:"ACCEPTED",accepted:true,deliveryVerified:false,sourceCurrent:true,blockers:[]}});

test("reviewed delivery dispatches each exact notice sequentially and retains independent acceptance outcomes",async()=>{
  const original=structuredClone(items),calls:string[]=[],observations:string[][]=[];let active=0;
  const result=await deliverReviewedNotices(items,async item=>{assert.equal(active++,0);calls.push(item.id);await new Promise(resolve=>setTimeout(resolve,2));active--;return accepted(item)},new AbortController().signal,rows=>observations.push(rows.map(row=>row.status)));
  assert.deepEqual(calls,items.map(item=>item.id));assert.ok(result.every(row=>row.status==='PROVIDER_ACCEPTED'));assert.deepEqual(items,original);assert.ok(observations.some(row=>row[0]==='PROVIDER_ACCEPTED'&&row[1]==='IN_PROGRESS'&&row[2]==='NOT_ATTEMPTED'));
});
test("uncertain, rejected, mismatched or malformed results stop the group without retrying or claiming later sends",async()=>{
  for(const failure of ['throw','pending','uncertain','wrong-account','wrong-revision','wrong-message','contradiction','inbox','malformed']){
    const calls:string[]=[];
    const result=await deliverReviewedNotices(items,async item=>{calls.push(item.id);if(item===undefined)throw Error('unreachable');if(item.id===items[0].id)return accepted(item);if(failure==='throw')throw Error('HTTP response unavailable');const result=accepted(item);if(failure==='pending'){result.notice.status='SENDING';result.notice.accepted=false}if(failure==='uncertain'){result.notice.status='REVIEW_REQUIRED';result.notice.accepted=false}if(failure==='wrong-account')result.notice.accountId='foreign';if(failure==='wrong-revision')result.notice.revision='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';if(failure==='wrong-message')result.notice.text='different';if(failure==='contradiction')result.notice.accepted=false;if(failure==='inbox')result.notice.deliveryVerified=true;return failure==='malformed'?{}:result},new AbortController().signal,()=>{});
    assert.deepEqual(calls,items.slice(0,2).map(item=>item.id));assert.deepEqual(result.map(row=>row.status),['PROVIDER_ACCEPTED','REVIEW_REQUIRED','NOT_ATTEMPTED'],failure);
  }
});
test("page interruption stops remaining dispatches and invalid audiences make no requests",async()=>{
  const abort=new AbortController(),calls:string[]=[];
  const result=await deliverReviewedNotices(items,async item=>{calls.push(item.id);abort.abort();return accepted(item)},abort.signal,()=>{});assert.deepEqual(calls,[items[0].id]);assert.deepEqual(result.map(row=>row.status),['PROVIDER_ACCEPTED','NOT_ATTEMPTED','NOT_ATTEMPTED']);
  const stopped=await deliverReviewedNotices(items,async()=>{throw Error('must not dispatch')},abort.signal,()=>{});assert.ok(stopped.every(row=>row.status==='NOT_ATTEMPTED'));
  for(const invalid of [[],[items[0],items[0]],Array.from({length:21},(_,i)=>({...items[0],accountId:`a-${i}`,id:`n-${i}`})),[{...items[0],revision:'invalid'}]])await assert.rejects(deliverReviewedNotices(invalid,async()=>{throw Error('must not dispatch')},new AbortController().signal,()=>{}));
});
