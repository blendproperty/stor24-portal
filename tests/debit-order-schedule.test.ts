import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { debitOrderSchedule } from "../src/lib/debit-order-schedule";
import { newPublicInitialRent } from "../src/lib/public-initial-rent";
import { initialPaymentState } from "../src/lib/debit-order-initial-payment";
import { debitOrderInitialPaymentStatus, startDebitOrderInitialPayment } from "../src/lib/debit-order-initial-payment";
import { db } from "../src/lib/db";
import { requestPublicDebitOrderSetup } from "../src/lib/public-debit-order-request";
import { hostedMandateStatus } from "../src/lib/public-hosted-mandate";

function stub(target: object, name: string, fn: (...args: unknown[]) => Promise<unknown>) {
  const original = Reflect.get(target, name); Reflect.set(target, name, fn);
  return () => Reflect.set(target, name, original);
}

const intendedMoveIn = new Date("2026-10-31T00:00:00+02:00");
const booking = { intendedMoveIn, quotedRate: 1250, initialRentSnapshot: newPublicInitialRent(1250, intendedMoveIn) };
test("31 October initial invoice covers October and November; recurring rent starts December", () => {
  const result = debitOrderSchedule(booking, { firstCollectionDate: "2026-12-01", collectionDay: 1 }, "2026-10-11", [1]);
  assert.equal(result.ready, true);
  assert.deepEqual(result.initialPayment, { lines: [{ period: "2026-10", amount: 40.32 }, { period: "2026-11", amount: 1250 }], goods: 0, total: 1290.32 });
  assert.equal(result.earliestDate, "2026-12-01");
  assert.equal(result.suggestedDate, "2026-12-01");
});
test("reject prepaid months, mismatched days, unapproved days and past dates", () => {
  for (const preferences of [{firstCollectionDate:"2026-10-31",collectionDay:1},{firstCollectionDate:"2026-11-01",collectionDay:1},{firstCollectionDate:"2026-12-15",collectionDay:15},{firstCollectionDate:"2026-12-02",collectionDay:1}]) assert.equal(debitOrderSchedule(booking, preferences,"2026-10-11",[1]).ready,false);
  assert.equal(debitOrderSchedule(booking,{firstCollectionDate:"2026-12-01",collectionDay:1},"2026-12-02",[1]).ready,false);
});
test("future-year provider limitations block without silently shortening covered periods", () => {
  const date = new Date("2026-12-31T00:00:00+02:00");
  const result = debitOrderSchedule({quotedRate:3100,intendedMoveIn:date,initialRentSnapshot:newPublicInitialRent(3100,date)}, {firstCollectionDate:"2027-02-01",collectionDay:1}, "2026-12-01", [1]);
  assert.equal(result.ready,false); assert.equal(result.earliestDate,"2027-02-01");
});
test("missing or changed saved pricing requires invoice review and never reprices", () => {
  for (const value of [{quotedRate:1250}, {...booking,quotedRate:1300}, {...booking,initialRentSnapshot:{version:1}}]) {
    const result = debitOrderSchedule(value,{firstCollectionDate:"2026-12-01",collectionDay:1},"2026-10-11",[1]);
    assert.equal(result.code,"MANDATE_INITIAL_RENT_REVIEW_REQUIRED"); assert.equal(result.initialPayment,null); assert.equal(result.ready,false);
  }
});
test("initial receipt state cannot convert sandbox success or ambiguous attempts into settled rent", () => {
  const payment = {id:"p",status:"SUCCEEDED",amount:1290.32,currency:"ZAR",environment:"sandbox",idempotencyKey:"key"};
  assert.equal(initialPaymentState([payment],1290.32).status,"TEST_SUCCEEDED");
  assert.equal(initialPaymentState([{...payment,environment:"live"}],1290.32).isTest,false);
  assert.equal(initialPaymentState([payment,payment],1290.32).status,"REVIEW_REQUIRED");
  assert.equal(initialPaymentState([payment],1250).status,"REVIEW_REQUIRED");
  assert.equal(initialPaymentState([],1290.32).status,"NOT_STARTED");
});
test("status exposes invalid saved dates and save rejects prepaid periods before any write", async () => {
  const lease = {id:"lease",status:"SIGNED",paymentMethod:"DEBIT_ORDER",expiresAt:new Date(Date.now()+60000),mandate:null,debitOrderPreferences:{firstCollectionDate:"2026-10-31",collectionDay:1},reservation:{...booking,status:"ACTIVE",customer:{organisationId:"test-org"},unit:{number:"166"}}};
  const restore = stub(db.publicReservationLease,"findUnique",async()=>lease);
  const restoreTx = stub(db,"$transaction",async()=>{throw new Error("UNEXPECTED_WRITE");});
  try {
    assert.equal((await hostedMandateStatus("fake-token")).schedule.ready,false);
    const result = await requestPublicDebitOrderSetup("fake-token",{firstCollectionDate:"2099-12-02",collectionDay:1});
    assert.equal(result.ok,false); assert.equal(!result.ok && result.code,"MANDATE_SCHEDULE_REVIEW_REQUIRED");
  } finally {restore();restoreTx();}
});
test("unsigned and expired capabilities cannot start the initial checkout; account ownership is checked", async () => {
  let lease: unknown = {status:"READY",paymentMethod:"DEBIT_ORDER"};
  const restore = stub(db.publicReservationLease,"findUnique",async()=>lease);
  const network = mock.method(globalThis,"fetch",async()=>{throw new Error("UNEXPECTED_PROVIDER_CALL");});
  const restoreAccount = stub(db.account,"findUnique",async()=>({customerId:"other-customer",payments:[]}));
  try {
    await assert.rejects(startDebitOrderInitialPayment("fake-token"),/MANDATE_BOOKING_UNAVAILABLE/);
    lease = {id:"lease",status:"SIGNED",paymentMethod:"DEBIT_ORDER",expiresAt:new Date(0),reservation:{...booking,id:"booking",status:"ACTIVE",customerId:"owner"}};
    await assert.rejects(startDebitOrderInitialPayment("fake-token"),/INITIAL_PAYMENT_REVIEW_REQUIRED/);
    await assert.rejects(debitOrderInitialPaymentStatus("fake-token"),/NETCASH_ACCOUNT_CONFLICT/);
    assert.equal(network.mock.callCount(),0);
  } finally {restore();restoreAccount();network.mock.restore();}
});
test("existing authority cannot expose a signing link for covered months or a changed recurring amount", async () => {
  let terms = {amount:"1250.00",commencementMonth:10,debitDay:1};
  let preferences = {firstCollectionDate:"2026-10-31",collectionDay:1};
  const restore = stub(db.publicReservationLease,"findUnique",async()=>({id:"lease",status:"SIGNED",paymentMethod:"DEBIT_ORDER",expiresAt:new Date(Date.now()+60000),debitOrderPreferences:preferences,reservation:{...booking,status:"ACTIVE",customer:{organisationId:"test-org"}},mandate:{status:"AWAITING_SIGNATURE",reference:"synthetic",hostedUrl:"https://short.surf/example",verifiedAt:null,terms}}));
  try {
    let result = await hostedMandateStatus("fake-token");
    assert.equal(result.mandate?.hostedUrl,null); assert.equal(result.mandate?.reviewRequired,true);
    preferences = {firstCollectionDate:"2026-12-01",collectionDay:1}; terms = {amount:"1300.00",commencementMonth:12,debitDay:1};
    result = await hostedMandateStatus("fake-token");
    assert.equal(result.mandate?.hostedUrl,null); assert.equal(result.mandate?.reviewRequired,true);
  } finally {restore();}
});
test("a valid older mandate keeps its date without being recreated", async () => {
  const date = new Date("2026-06-30T00:00:00+02:00");
  const restore = stub(db.publicReservationLease,"findUnique",async()=>({id:"lease",status:"SIGNED",paymentMethod:"DEBIT_ORDER",expiresAt:new Date(Date.now()+60000),debitOrderPreferences:{firstCollectionDate:"2026-08-01",collectionDay:1},reservation:{quotedRate:1250,intendedMoveIn:date,initialRentSnapshot:newPublicInitialRent(1250,date),status:"ACTIVE",customer:{organisationId:"test-org"}},mandate:{status:"AWAITING_SIGNATURE",reference:"synthetic",hostedUrl:"https://short.surf/example",verifiedAt:null,terms:{amount:"1250.00",commencementMonth:8,debitDay:1}}}));
  try {
    const result = await hostedMandateStatus("fake-token");
    assert.equal(result.mandate?.reviewRequired,false); assert.equal(result.mandate?.hostedUrl,"https://short.surf/example");
  } finally {restore();}
});
