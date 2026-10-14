import assert from "node:assert/strict";
import test from "node:test";
import { privacyHash } from "../src/lib/request-security";
import { readHistoryMessage } from "../src/lib/customer-history-message";
import { historyEvidence,redactHistoryMessage } from "../src/lib/customer-history-message-policy";

test("retained communication text omits links, access codes and recipient envelopes",()=>{
  const value=historyEvidence({to:"private@example.invalid",subject:"Reservation confirmed",text:"Hi, your unit is booked. Visit https://example.invalid/lease?token=private. OTP code 123456"});
  assert.ok(value);assert.ok(!JSON.stringify(value).includes("private@example.invalid"));assert.ok(!value.text.includes("token="));assert.ok(!value.text.includes("123456"));
  assert.ok(redactHistoryMessage("Bearer "+"a".repeat(40)).includes("[credential omitted]"));
});
test("provider message recovery is GET-only, account/SID/channel/recipient-bound and skips authentication",async()=>{
  const old={account:process.env.TWILIO_ACCOUNT_SID,token:process.env.TWILIO_AUTH_TOKEN,auth:process.env.AUTH_SECRET};
  process.env.TWILIO_ACCOUNT_SID="AC"+"a".repeat(32);process.env.TWILIO_AUTH_TOKEN="synthetic-provider-token";process.env.AUTH_SECRET="synthetic-history-hash-key";
  const proof={provider:"twilio",providerRef:"SM"+"b".repeat(32),channel:"WHATSAPP",direction:"OUTBOUND",messageType:"RESERVATION_CONFIRMED",recipientHash:privacyHash("+27820000000")};let calls=0;
  const request:typeof fetch=async(url,options)=>{calls++;assert.ok(String(url).startsWith("https://api.twilio.com/2010-04-01/Accounts/"));assert.equal(options?.method,"GET");return Response.json({sid:proof.providerRef,account_sid:process.env.TWILIO_ACCOUNT_SID,direction:"outbound-api",to:"whatsapp:+27820000000",body:"Your unit is ready. Visit https://example.invalid/private"});};
  try {
    const result=await readHistoryMessage(proof,"0820000000",request);assert.ok(result.body.includes("Your unit is ready"));assert.ok(!result.body.includes("https"));
    assert.equal((await readHistoryMessage({...proof,recipientHash:privacyHash("+27829999999")},null,request)).body,"");
    const count=calls;assert.equal((await readHistoryMessage({...proof,messageType:"PHONE_VERIFICATION"},null,request)).body,"");assert.equal(calls,count);
    const archived=await readHistoryMessage({...proof,provider:null,metadata:{historyEvidence:{version:1,text:"Retained booking email",subject:"Booking"}}},null,request);assert.equal(archived.body,"Retained booking email");assert.equal(calls,count);
  } finally {for(const [key,value]of Object.entries({TWILIO_ACCOUNT_SID:old.account,TWILIO_AUTH_TOKEN:old.token,AUTH_SECRET:old.auth})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
