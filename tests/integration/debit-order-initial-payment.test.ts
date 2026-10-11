import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { newPublicInitialRent } from "../../src/lib/public-initial-rent";

test("isolated database serialises initial debit-order checkout across devices without a provider charge", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({data:{name:"Debit initial CI",slug:key}});
  const customer = await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic"}});
  const facility = await db.facility.create({data:{organisationId:org.id,name:"CI facility",code:key}});
  const unitType = await db.unitType.create({data:{facilityId:facility.id,name:"CI",features:[]}});
  const unit = await db.unit.create({data:{facilityId:facility.id,unitTypeId:unitType.id,number:key,monthlyRate:1250}});
  const account = await db.account.create({data:{customerId:customer.id,accountNumber:`ST24-T-${key}`}});
  const intendedMoveIn = new Date("2026-10-31T00:00:00+02:00");
  await db.reservation.create({data:{id:key,facilityId:facility.id,customerId:customer.id,unitId:unit.id,quotedRate:1250,intendedMoveIn,initialRentSnapshot:newPublicInitialRent(1250,intendedMoveIn)}});
  let starts = 0;
  const state = {db,lease:{id:key,sourceSessionId:null,status:"SIGNED",paymentMethod:"DEBIT_ORDER",expiresAt:new Date(Date.now()+60000),reservation:{id:key,status:"ACTIVE",publicReference:`CI-${key}`,customerId:customer.id,quotedRate:1250,intendedMoveIn,initialRentSnapshot:newPublicInitialRent(1250,intendedMoveIn)}},start:async()=>{
    starts++;
    const payment = await db.payment.create({data:{accountId:account.id,status:"TEST_PENDING",environment:"sandbox",amount:1290.32,currency:"ZAR",method:"PAY_NOW",provider:"NETCASH",idempotencyKey:`netcash-public-test-${randomUUID()}`}});
    return {ok:true,paymentId:payment.id};
  }};
  const output = await build({entryPoints:["src/lib/debit-order-initial-payment.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"isolated-db-no-provider",setup(b){
    b.onResolve({filter:/^\.\/(db|debit-mandate-session|public-netcash-payment|public-lease-workflow)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db") ? "export const db=__state.db;" : a.path.endsWith("/debit-mandate-session") ? "export const findMandateLease=async()=>__state.lease;" : a.path.endsWith("/public-lease-workflow") ? 'export const preparePublicReservationLease=async()=>({ok:true,status:"SIGNED"});' : "export const startPublicNetcashSandboxPayment=__state.start;"}));
  }}]});
  const loaded = {exports:{} as {startDebitOrderInitialPayment:(token:string)=>Promise<unknown>;debitOrderInitialPaymentStatus:(token:string)=>Promise<{status:string}>}};
  new Function("require","module","exports","__state",output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,state);
  try {
    const results = await Promise.allSettled([loaded.exports.startDebitOrderInitialPayment("synthetic"),loaded.exports.startDebitOrderInitialPayment("synthetic")]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(results.filter(r=>r.status==="rejected" && /INITIAL_PAYMENT_ALREADY_STARTED/.test(String(r.reason))).length,1);
    assert.equal(starts,1);
    assert.equal(await db.payment.count({where:{accountId:account.id}}),1);
    assert.equal((await loaded.exports.debitOrderInitialPaymentStatus("synthetic")).status,"TEST_PENDING");
    await db.payment.updateMany({where:{accountId:account.id},data:{status:"SUCCEEDED"}});
    assert.equal((await loaded.exports.debitOrderInitialPaymentStatus("synthetic")).status,"TEST_SUCCEEDED");
    await assert.rejects(loaded.exports.startDebitOrderInitialPayment("synthetic"),/INITIAL_PAYMENT_ALREADY_STARTED/);
    await db.payment.updateMany({where:{accountId:account.id},data:{status:"FAILED"}});
    await assert.rejects(loaded.exports.startDebitOrderInitialPayment("synthetic"),/INITIAL_PAYMENT_ALREADY_STARTED/);
    assert.equal(starts,1);
    assert.equal(await db.ledgerEntry.count({where:{accountId:account.id}}),0);
  } finally {await db.$disconnect();}
});
