import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { noticeBatchAccountsSchema, noticeBatchPreparationSchema, noticeBatchApprovalSchema } from "../src/lib/collection-notice-batch-policy";
test("notice audiences are bounded, distinct and explicitly confirmed without recipient overrides",()=>{
  const item={accountId:"synthetic-account",fingerprint:"0".repeat(64)};
  assert.deepEqual(noticeBatchPreparationSchema.parse({items:[item],confirm:true}),{items:[item],confirm:true});
  for(const ids of [[],["same","same"],Array.from({length:21},(_,i)=>String(i))])assert.equal(noticeBatchAccountsSchema.safeParse(ids).success,false);
  for(const value of [{items:[item],confirm:false},{items:[item,item],confirm:true},{items:[{...item,recipient:"other@example.invalid"}],confirm:true},{items:[item],confirm:true,send:true}])assert.equal(noticeBatchPreparationSchema.safeParse(value).success,false);
});
test("group approval binds distinct saved account/notice revisions and independent review confirmation",()=>{
  const item={accountId:"synthetic-account",id:"synthetic-notice",revision:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"},input={items:[item],reference:" CI independent review ",confirm:true};
  assert.equal(noticeBatchApprovalSchema.parse(input).reference,"CI independent review");
  for(const value of [{...input,confirm:false},{...input,reference:" "},{...input,items:[item,{...item,accountId:"other"}]},{...input,items:[item,{...item,id:"other"}]},{...input,items:[{...item,revision:"stale"}]},{...input,items:[{...item,recipient:"other@example.invalid"}]},{...input,send:true},{...input,items:[]}])assert.equal(noticeBatchApprovalSchema.safeParse(value).success,false);
});
test("bulk API uses management scope for selection and preparation, private responses and bounded origin-confirmed commands",async()=>{
  const result=await build({stdin:{contents:'export{GET,POST}from"./src/app/api/v1/collections/notices/bulk/route";export{state}from"fixture";',resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"esm",plugins:[{name:"bulk-boundaries",setup(b){const mocks:Record<string,string>={
    fixture:'export const state={auth:true,manage:true,limited:false,previewRows:false,sendStore:"ci-store",calls:[]};',
    "@/lib/scope":'import{state}from"fixture";export async function requirePermissionScope(p,f){if(!state.auth)throw Error("UNAUTHENTICATED");if(p==="billing.documents.send"){if(f!==state.sendStore)throw Error("FORBIDDEN")}else if(p!=="collections.manage"||!state.manage)throw Error("FORBIDDEN");return{organisationId:"ci-org",userId:"ci-user",facilityIds:state.previewRows?["ci-store","ci-other"]:["ci-store"],unrestrictedFacilities:false}}',
    "@/lib/request-security":'import{state}from"fixture";export const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;export const rateLimit=async()=>state.limited;',
    "@/lib/collections-service":'export const collectionsWorkspace=async s=>({rows:[{id:"ci-account",accountNumber:"CI-1",name:"Synthetic",facility:"CI",facilityId:s.facilityIds[0],privateNote:"excluded from selection"}]});',
    "@/lib/collection-notice-service":'import{state}from"fixture";export const previewCollectionNoticeBatch=async(s,ids)=>{state.calls.push(["preview",s.facilityIds,ids]);return{items:state.previewRows?s.facilityIds.map(f=>({source:{facilityId:f},sendConfigured:true})):[]}};export const prepareCollectionNoticeBatch=async(s,v)=>{state.calls.push(["prepare",s.facilityIds,v]);return{prepared:true,emailSent:false,notices:[]}};export const approveCollectionNoticeBatch=async(s,v)=>{state.calls.push(["approve",s.facilityIds,v]);return{approved:true,emailSent:false,notices:[]}};',
  };b.onResolve({filter:/^(fixture|@\/lib\/(scope|request-security|collections-service|collection-notice-service))$/},args=>({path:args.path,namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:mocks[args.path]}))}}]});
  const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`),url="https://portal.example.invalid/api/v1/collections/notices/bulk",input={action:"prepare",items:[{accountId:"ci-account",fingerprint:"0".repeat(64)}],confirm:true};
  const post=(body:unknown,origin="https://portal.example.invalid")=>api.POST(new Request(url,{method:"POST",headers:{origin},body:typeof body==="string"?body:JSON.stringify(body)}));
  api.state.auth=false;assert.equal((await api.GET()).status,401);assert.equal((await post(input)).status,401);api.state.auth=true;api.state.manage=false;assert.equal((await api.GET()).status,403);assert.equal((await post(input)).status,403);api.state.manage=true;
  assert.equal((await post(input,"https://other.invalid")).status,403);
  for(const invalid of [{...input,confirm:false},{...input,recipient:"other@example.invalid"},{...input,action:"send"},{action:"preview",accounts:["same","same"]},"x".repeat(16001)])assert.equal((await post(invalid)).status,400);
  api.state.limited=true;assert.equal((await post(input)).status,429);api.state.limited=false;assert.deepEqual(api.state.calls,[]);
  const list=await api.GET();assert.equal(list.status,200);assert.match(list.headers.get("cache-control")!,/private, no-store/);const data=await list.json();assert.equal(data.rows[0].facilityId,"ci-store");assert.equal("privateNote" in data.rows[0],false);
  assert.equal((await post({action:"preview",accounts:["ci-account"]})).status,200);const prepared=await post(input);assert.equal(prepared.status,200);assert.equal((await prepared.json()).emailSent,false);assert.deepEqual(api.state.calls.map((call:unknown[])=>call[0]),["preview","prepare"]);assert.deepEqual(api.state.calls[1][1],["ci-store"]);
  const approval={action:"approve",items:[{accountId:"ci-account",id:"ci-notice",revision:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"}],reference:"CI review",confirm:true};
  assert.equal((await post({...approval,confirm:false})).status,400);const reviewed=await post(approval);assert.equal(reviewed.status,200);assert.equal((await reviewed.json()).emailSent,false);assert.deepEqual(api.state.calls.at(-1),["approve",["ci-store"],{items:approval.items,reference:approval.reference,confirm:true}]);
  api.state.previewRows=true;const scoped=await post({action:"preview",accounts:["ci-account"]});assert.deepEqual((await scoped.json()).items.map((item:{canSend:boolean})=>item.canSend),[true,false]);api.state.sendStore="no-store";const denied=await post({action:"preview",accounts:["ci-account"]});assert.deepEqual((await denied.json()).items.map((item:{canSend:boolean})=>item.canSend),[false,false]);assert.equal((await post({...approval,action:"send"})).status,400);
});
