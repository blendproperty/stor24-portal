import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {parsePayNowInvoice,projectPayNowInstructions} from "../src/lib/payments/netcash-invoice-response";
const serviceKey="11111111-1111-4111-8111-111111111111",token="22222222-2222-4222-8222-222222222222",reference="ST24-TEST-INVOICE";
const method=(type:string,name:string,value:string)=>`<PaymentMethod><Type>${type}</Type><Text>${type} payment</Text><Data><Entry><Name>${name}</Name><Value>${value}</Value></Entry></Data></PaymentMethod>`;
function xml(methods=method("CreditCard","Pay online",`https://paynow.netcash.co.za/site/paynow.aspx?token=${token}&amp;reference=${reference}`)){
 return`<?xml version="1.0" encoding="utf-8"?><PayNowInvoices><ServiceKey>${serviceKey}</ServiceKey><FileToken>private-file-token</FileToken><Invoices><Invoice><ClientReference>${reference}</ClientReference><UniqueReference>provider-invoice-id</UniqueReference><SecurityToken>${token}</SecurityToken><SupportMessage/><PaymentMethods>${methods}</PaymentMethods></Invoice></Invoices></PayNowInvoices>`;
}
const parse=(value:string)=>parsePayNowInvoice(value,{serviceKey,reference});
test("malformed repeated XML attributes finish within an isolated process deadline",()=>{
 const inputs=[`<A\t${'xmlns:A=""\t'.repeat(28)}!>`, `<A ${Array.from({length:2000},(_,i)=>`xmlns:${'A'.repeat(1+Math.floor(i/26))}${String.fromCharCode(65+i%26)}=""`).join(' ')} !>`];
 const child=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",`import assert from 'node:assert/strict';import {parsePayNowInvoice} from './src/lib/payments/netcash-invoice-response.ts';for(const xml of JSON.parse(process.env.PARSER_ATTACKS)){assert.throws(()=>parsePayNowInvoice(xml,{serviceKey:'${serviceKey}',reference:'${reference}'}),/SOURCE_REVIEW/);}`],{cwd:process.cwd(),env:{...process.env,PARSER_ATTACKS:JSON.stringify(inputs)},timeout:5000,encoding:"utf8"});
 assert.equal(child.error,undefined,child.error?.message);assert.equal(child.status,0,child.stderr);
});
test("ordinary empty namespaces, prefixed attributes and both quote forms remain valid",()=>{
 const result=parse(xml().replace('<PayNowInvoices>',`<PayNowInvoices xmlns='' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`).replace('<SupportMessage/>',`<SupportMessage xsi:nil='true' />`));
 assert.equal(result.originalReference,reference);
 for(const root of[`<PayNowInvoices xmlns='' xmlns=''>`,`<PayNowInvoices xmlns='&#102;oreign'>`,`<PayNowInvoices xmlns:A='unterminated>`])assert.throws(()=>parse(xml().replace('<PayNowInvoices>',root)),/SOURCE_REVIEW/);
});
test("single invoice response binds original merchant/reference and projects all returned method groups without raw keys or tokens",()=>{
 const value=xml(method("CreditCard","Pay online",`https://paynow.netcash.co.za/site/paynow.aspx?token=${token}`)+method("EFT","Bank","TEST BANK")+method("Retail","Barcode","000000000000")+method("QR","Pay QR",`https://paynow.netcash.co.za/site/paynow.aspx?token=${token}`));
 const privateInvoice=parse(value),projected=projectPayNowInstructions(privateInvoice,[serviceKey]);assert.equal(privateInvoice.originalReference,reference);assert.equal(privateInvoice.securityToken,token);assert.deepEqual(projected.map(m=>m.type),["CreditCard","EFT","Retail","QR"]);assert.equal(projected[0].links.length,1);assert.equal(projected[1].instructions[0].value,"TEST BANK");assert.ok(projected.every(m=>!m.requiresReview));const output=JSON.stringify(projected);assert.ok(!output.includes(serviceKey));assert.ok(!output.includes('"securityToken"'));assert.ok(!output.includes("private-file-token"));
});
test("wrong merchant, unrelated references, duplicate roots/fields and multiple invoices are held",()=>{
 for(const value of[xml().replace(serviceKey,"33333333-3333-4333-8333-333333333333"),xml().replace(`<ClientReference>${reference}</ClientReference>`,`<ClientReference>unrelated</ClientReference>`),xml().replace("<FileToken>","<FileToken>x</FileToken><FileToken>"),xml()+xml(),xml().replace("</Invoices>","<Invoice/></Invoices>"),xml().replace("<PayNowInvoices>","<PayNowInvoices xmlns='foreign-schema'>")])assert.throws(()=>parse(value),/SOURCE_REVIEW/);
});
test("external entities, declarations, unbalanced XML, unknown markup, invalid character entities and size/depth attacks are held",()=>{
 for(const value of["<!DOCTYPE root SYSTEM 'file:///private'>"+xml(),xml().replace("<FileToken>","<Unknown/><FileToken>"),xml().replace("</Invoices>","</InvoiceS>"),xml().replace("private-file-token","&#0;"),xml().replace("private-file-token","&unknown;"),xml().replace("private-file-token","x".repeat(65000)),xml().replace("private-file-token","<a>".repeat(12)+"</a>".repeat(12))])assert.throws(()=>parse(value),/SOURCE_REVIEW/);
});
test("unsafe hosts/protocols/credentials and service-key echo never become clickable links or instructions",()=>{
 for(const value of[`http://paynow.netcash.co.za/pay`,`https://paynow.netcash.co.za.evil.invalid/pay`,`https://user:password@paynow.netcash.co.za/pay`,`https://paynow.netcash.co.za/pay#m1`,`https://paynow.netcash.co.za/pay?M1=${serviceKey}`,serviceKey]){
  const projected=projectPayNowInstructions(parse(xml(method("CreditCard","Pay online",value))),[serviceKey]);assert.equal(projected[0].links.length,0);assert.equal(projected[0].requiresReview,true);assert.ok(!JSON.stringify(projected).includes(serviceKey));
 }
 const projected=projectPayNowInstructions(parse(xml(method("CreditCard","Security token",token))),[serviceKey]);assert.equal(projected[0].instructions.length,0);assert.equal(projected[0].requiresReview,true);
});
test("unknown provider methods remain visible as requiring review instead of silently disappearing",()=>{
 const result=projectPayNowInstructions(parse(xml(method("NewWallet","Provider instruction","TEST INSTRUCTION"))),[serviceKey]);assert.equal(result.length,1);assert.equal(result[0].type,"NewWallet");assert.equal(result[0].requiresReview,true);
});
