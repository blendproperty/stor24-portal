import assert from "node:assert/strict";
import test from "node:test";
import { privacyHash } from "../src/lib/request-security";
import { needsProviderMessage, readHistoryMessage } from "../src/lib/customer-history-message";
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
    assert.equal(needsProviderMessage(proof),true);
    const multimedia={...proof,providerRef:"MM"+"c".repeat(32)};
    const mm=await readHistoryMessage(multimedia,null,async(url,options)=>{assert.ok(String(url).endsWith(multimedia.providerRef+".json"));assert.equal(options?.method,"GET");return Response.json({sid:multimedia.providerRef,account_sid:process.env.TWILIO_ACCOUNT_SID,direction:"outbound-api",to:"whatsapp:+27820000000",body:"Original WhatsApp message"});});assert.equal(mm.body,"Original WhatsApp message");assert.equal(needsProviderMessage(multimedia),true);
    assert.equal(needsProviderMessage({...multimedia,metadata:{historyEvidence:{version:1,text:"Stored body"}}}),false);
    assert.equal(needsProviderMessage({...multimedia,messageType:"PHONE_VERIFICATION"}),false);
    const count=calls;assert.equal((await readHistoryMessage({...proof,messageType:"PHONE_VERIFICATION"},null,request)).body,"");assert.equal(calls,count);
    const archived=await readHistoryMessage({...proof,provider:null,metadata:{historyEvidence:{version:1,text:"Retained booking email",subject:"Booking"}}},null,request);assert.equal(archived.body,"Retained booking email");assert.equal(calls,count);
  } finally {for(const [key,value]of Object.entries({TWILIO_ACCOUNT_SID:old.account,TWILIO_AUTH_TOKEN:old.token,AUTH_SECRET:old.auth})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});


test("history exports redact the Hostinger mailbox credential", t => {
  const original = process.env.HOSTINGER_SMTP_PASSWORD;
  t.after(() => { if (original === undefined) delete process.env.HOSTINGER_SMTP_PASSWORD; else process.env.HOSTINGER_SMTP_PASSWORD = original; });
  process.env.HOSTINGER_SMTP_PASSWORD = "smtp-test-secret";
  assert.equal(redactHistoryMessage("accidental smtp-test-secret"), "accidental [credential omitted]");
});
