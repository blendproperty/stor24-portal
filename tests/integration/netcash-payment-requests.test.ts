import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {encryptIntegrationSecret} from "../../src/lib/integrations/integration-secret-vault";
import {previewAccountPaymentRequest,createAccountPaymentRequest,readAccountPaymentRequest,listAccountPaymentRequests,PAYMENT_REQUEST_DOMAIN} from "../../src/lib/payments/netcash-payment-request-service";
test("isolated account payment requests preserve debt and claim only one provider attempt",async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
 process.env.AUTH_SECRET="synthetic-payment-request-auth-secret-at-least-32";process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="synthetic-payment-request-vault-key-at-least-32";process.env.NETCASH_PAYMENT_REQUEST_SANDBOX_ENABLED="true";
 const org=await db.organisation.create({data:{name:"Payment request CI",slug:randomUUID()}}),f=await db.facility.create({data:{organisationId:org.id,code:randomUUID(),name:"CI"}}),other=await db.facility.create({data:{organisationId:org.id,code:randomUUID(),name:"Other"}}),u=await db.user.create({data:{organisationId:org.id,email:randomUUID()+"@example.invalid",name:"CI"}}),key=randomUUID();
 const connection=await db.integrationConnection.create({data:{organisationId:org.id,category:"PAYMENTS",provider:"NETCASH",status:"HEALTHY",config:{environment:"test",transactionProcessingEnabled:true,merchantAccountEncrypted:encryptIntegrationSecret("53000000000"),payNowServiceKeyEncrypted:encryptIntegrationSecret(key)}}});
 const scope={organisationId:org.id,userId:u.id,facilityIds:[f.id],unrestrictedFacilities:false};
 async function account(){const c=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic"}}),a=await db.account.create({data:{customerId:c.id,accountNumber:randomUUID(),balance:100}});await db.tenancy.create({data:{accountId:a.id,customerId:c.id,facilityId:f.id,status:"ACTIVE",startDate:new Date("2026-01-01")}});await db.ledgerEntry.create({data:{accountId:a.id,type:"CHARGE",amount:100,description:"Synthetic approved debt",effectiveAt:new Date("2026-01-01")}});return a;}
 let calls=0;const native=globalThis.fetch;globalThis.fetch=async()=>{throw Error("Real provider transport forbidden")};
 const fake:typeof fetch=async(_url,options)=>{calls++;const body=String(options?.body),ref=body.match(/<P2>([^<]+)<\/P2>/)![1];assert.match(body,/<IgnoreAmount>false<\/IgnoreAmount>/);assert.match(body,/<M12>false<\/M12>/);assert.match(body,/<M13>false<\/M13>/);assert.ok(!body.includes("<M27>"));const xml=`<PayNowInvoices><ServiceKey>${key}</ServiceKey><FileToken>test-private-file</FileToken><Invoices><Invoice><ClientReference>${ref}</ClientReference><UniqueReference>test-provider-reference</UniqueReference><SecurityToken>${randomUUID()}</SecurityToken><SupportMessage/><PaymentMethods><PaymentMethod><Type>CreditCard</Type><Text>Card and wallets</Text><Data><Entry><Name>Pay online</Name><Value>https://paynow.netcash.co.za/site/paynow.aspx?token=test-private-token</Value></Entry></Data></PaymentMethod><PaymentMethod><Type>EFT</Type><Text>Bank EFT</Text><Data><Entry><Name>Bank</Name><Value>TEST BANK</Value></Entry></Data></PaymentMethod></PaymentMethods></Invoice></Invoices></PayNowInvoices>`;return new Response(`<Envelope><CreateInvoiceResult>${xml.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</CreateInvoiceResult></Envelope>`);};
 try{
 await t.test("review, fixed partial amount, encrypted provider result and repeated confirmation leave debt unchanged",async()=>{
  const a=await account(),review=await previewAccountPaymentRequest(scope,a.id,"40.00");assert.equal(review.preview.balance,"100.00");const before=await db.account.findUniqueOrThrow({where:{id:a.id}}),ledger=await db.ledgerEntry.findMany({where:{accountId:a.id}}),n=calls;
  const result=await createAccountPaymentRequest(scope,{preview:review.preview,confirmed:true},fake);assert.equal(result.status,"READY");assert.equal(result.sourceCurrent,true);assert.equal(result.methods.length,2);assert.equal(result.financialReceipt,false);assert.equal(calls,n+1);
  await createAccountPaymentRequest(scope,{preview:review.preview,confirmed:true},fake);assert.equal(calls,n+1);assert.deepEqual(await db.account.findUniqueOrThrow({where:{id:a.id}}),before);assert.deepEqual(await db.ledgerEntry.findMany({where:{accountId:a.id}}),ledger);
  const row=await db.configurationProfile.findFirstOrThrow({where:{domain:PAYMENT_REQUEST_DOMAIN,name:result.paymentId}});assert.ok(!JSON.stringify(row.config).includes("test-private-token"));assert.ok(!JSON.stringify(row.config).includes(key));assert.ok(!JSON.stringify(result).includes(key));assert.equal((await listAccountPaymentRequests(scope,a.id)).requests.length,1);
  await assert.rejects(readAccountPaymentRequest({...scope,facilityIds:[other.id]},a.id,result.paymentId),/FACILITY_FORBIDDEN/);
  await db.ledgerEntry.create({data:{accountId:a.id,type:"CREDIT",amount:10,description:"Changed source",effectiveAt:new Date("2026-01-01")}});await db.account.update({where:{id:a.id},data:{balance:90}});const stale=await readAccountPaymentRequest(scope,a.id,result.paymentId);assert.equal(stale.sourceCurrent,false);assert.equal(stale.methods.length,0);
 });
 await t.test("scope, altered review, changed ledger, and missing confirmation stop before provider contact",async()=>{
  const a=await account(),review=await previewAccountPaymentRequest(scope,a.id),n=calls;
  await assert.rejects(previewAccountPaymentRequest({...scope,facilityIds:[other.id]},a.id),/FACILITY_FORBIDDEN/);
  await assert.rejects(createAccountPaymentRequest(scope,{preview:{...review.preview,amount:"1.00"},confirmed:true},fake),/SOURCE_REVIEW/);
  await assert.rejects(createAccountPaymentRequest(scope,{preview:review.preview,confirmed:false},fake),/CONFIRMATION_REQUIRED/);
  await db.account.update({where:{id:a.id},data:{balance:50}});await assert.rejects(createAccountPaymentRequest(scope,{preview:review.preview,confirmed:true},fake),/BALANCE_REVIEW/);assert.equal(calls,n);
 });
 await t.test("timeout creates a durable uncertain hold and repeated confirmation cannot retry the provider",async()=>{
  const a=await account(),review=await previewAccountPaymentRequest(scope,a.id);let attempts=0;
  const fail:typeof fetch=async()=>{attempts++;throw Error("Synthetic timeout")};const result=await createAccountPaymentRequest(scope,{preview:review.preview,confirmed:true},fail);assert.equal(result.status,"UNCERTAIN");assert.equal(result.providerRequestAccepted,null);await createAccountPaymentRequest(scope,{preview:review.preview,confirmed:true},fail);assert.equal(attempts,1);await assert.rejects(previewAccountPaymentRequest(scope,a.id),/COLLECTION_REVIEW/);
 });
 await t.test("definite service rejection stays a test failure; concurrent confirmation has one provider attempt",async()=>{
  const rejected=await account(),review=await previewAccountPaymentRequest(scope,rejected.id);const r=await createAccountPaymentRequest(scope,{preview:review.preview,confirmed:true},async()=>new Response("<Envelope><CreateInvoiceResult>310</CreateInvoiceResult></Envelope>"));assert.equal(r.status,"REJECTED");assert.equal(r.paymentStatus,"FAILED");assert.equal(r.isTest,true);
  const a=await account(),p=await previewAccountPaymentRequest(scope,a.id),n=calls;const results=await Promise.allSettled([createAccountPaymentRequest(scope,{preview:p.preview,confirmed:true},fake),createAccountPaymentRequest(scope,{preview:p.preview,confirmed:true},fake)]);assert.ok(results.some(r=>r.status==="fulfilled"));assert.equal(calls,n+1);
 });
 await t.test("live mode and disabled creation are refused without affecting retained history",async()=>{
  const a=await account();process.env.NETCASH_PAYMENT_REQUEST_SANDBOX_ENABLED="false";await assert.rejects(previewAccountPaymentRequest(scope,a.id),/SANDBOX_DISABLED/);assert.deepEqual((await listAccountPaymentRequests(scope,a.id)).requests,[]);process.env.NETCASH_PAYMENT_REQUEST_SANDBOX_ENABLED="true";await db.integrationConnection.update({where:{id:connection.id},data:{config:{environment:"live",transactionProcessingEnabled:true,merchantAccountEncrypted:encryptIntegrationSecret("53000000000"),payNowServiceKeyEncrypted:encryptIntegrationSecret(key)}}});await assert.rejects(previewAccountPaymentRequest(scope,a.id),/SANDBOX_CONFIGURATION_REQUIRED/);
 });
 }finally{globalThis.fetch=native;await db.$disconnect()}
});
