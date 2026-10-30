import assert from "node:assert/strict";
import test from "node:test";
import {noticeStarters,noticeTemplateSchema,noticeValuesSchema,noticeAudienceSchema,renderOperationalNotice} from "../src/lib/operational-notice-policy";
const values={notice_date:"30 October 2026",effective_time:"31 October, 09:00 SAST",details:"Synthetic maintenance only",contact_details:"Approved store contact"};
test("operational starters render explicit literal variables without recursive interpolation",()=>{
  for(const t of noticeStarters){assert.ok(noticeTemplateSchema.safeParse(t).success);const p=renderOperationalNotice(t,values,"Synthetic <Client> {{details}}","Synthetic store");assert.ok(p.text.includes("Synthetic <Client> {{details}}"));assert.ok(p.text.includes(values.details));assert.ok(!p.subject.includes("{{store_name}}"));}
});
test("unknown variables, header injection, control characters and oversized content are rejected",()=>{
  for(const t of [{...noticeStarters[0],body:"{{unknown}}"},{...noticeStarters[0],subject:"Subject\r\nBcc: external"},{...noticeStarters[0],body:"bad\u0000text"},{...noticeStarters[0],body:"x".repeat(8001)},{...noticeStarters[0],body:"{{ customer_name }}"}])assert.equal(noticeTemplateSchema.safeParse(t).success,false);
  assert.equal(noticeValuesSchema.safeParse({...values,details:"{{store_name}}"}).success,false);
  assert.throws(()=>renderOperationalNotice({...noticeStarters[0],subject:"{{customer_name}}"},values,"Injected\nSubject","Store"),/NOTICE_CONTENT/);
});
test("audiences have no implicit all, reject duplicates and cap at twenty",()=>{
  assert.equal(noticeAudienceSchema.safeParse([]).success,false);assert.equal(noticeAudienceSchema.safeParse(["a","a"]).success,false);assert.equal(noticeAudienceSchema.safeParse(Array.from({length:21},(_,i)=>String(i))).success,false);assert.equal(noticeAudienceSchema.parse(["a"]).length,1);
});
