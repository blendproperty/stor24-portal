import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {newPublicInitialRent} from "../src/lib/public-initial-rent";
import {confirmedFailedPricePayment,negotiatedMonthlyRate,reservationPriceBlockers,reservationPriceProposalSchema,reservationPriceAcceptanceSchema,proposedReservationPrice,requireIndependentPriceApproval,assertReservationQuotePatch} from "../src/lib/reservation-price-policy";
const now=new Date("2026-10-15T08:00:00Z"),moveIn=new Date("2026-10-20T10:00:00Z");
const original=()=>({source:"PUBLIC_VIEWING",status:"ACTIVE",journey:"RENTAL",convertedTenancyId:null,publicReference:"PUBLIC-ORIGINAL",quotedRate:1000,initialRentSnapshot:newPublicInitialRent(1000,moveIn),intendedMoveIn:moveIn,holdExpiresAt:new Date("2026-10-16"),contactVerifiedAt:now,emailVerifiedAt:now,signed:false,mandate:false,paymentSessions:0,financialActivity:false});
test("only a verified, held, unsigned and financially untouched original quote is eligible",()=>{
  assert.deepEqual(reservationPriceBlockers(original(),now),[]);
  for(const changed of [{signed:true},{status:"CONVERTED"},{convertedTenancyId:"tenancy"},{paymentSessions:1},{financialActivity:true},{mandate:true},{contactVerifiedAt:null},{holdExpiresAt:new Date("2026-10-14")},{initialRentSnapshot:null},{source:"UNKNOWN"},{journey:"UNKNOWN"}])assert.ok(reservationPriceBlockers({...original(),...changed},now).length>0);
  assert.ok(reservationPriceBlockers({...original(),quotedRate:999},now).some(text=>text.includes("snapshot")));
});
test("price proposals use whole cents and the existing proration policy",()=>{
  const input={reservationId:"booking",facilityId:"store",requestKey:randomUUID(),monthlyRate:"123.45",reason:"Negotiated quote recorded for review"};
  assert.equal(reservationPriceProposalSchema.safeParse(input).success,true);
  for(const monthlyRate of ["0","-1","1.001","1e3","10,00","10000000.01"])assert.equal(reservationPriceProposalSchema.safeParse({...input,monthlyRate}).success,false);
  assert.deepEqual(proposedReservationPrice("123.45",moveIn),newPublicInitialRent(123.45,moveIn));
  assert.equal(original().quotedRate,1000);
});
test("independent approval and exact customer acceptance cannot be replaced with implicit consent",()=>{
  assert.throws(()=>requireIndependentPriceApproval("staff","staff"),/INDEPENDENT/);assert.doesNotThrow(()=>requireIndependentPriceApproval("staff","reviewer"));
  const acceptance={reference:"booking",id:"proposal",identityAccessToken:"a".repeat(43),quoteFingerprint:"b".repeat(64),accepted:true,understandsNewAgreementRequired:true};
  assert.equal(reservationPriceAcceptanceSchema.safeParse(acceptance).success,true);
  for(const changed of [{accepted:false},{understandsNewAgreementRequired:false},{quoteFingerprint:""},{executePayment:true},{staffAcceptedForCustomer:true}])assert.equal(reservationPriceAcceptanceSchema.safeParse({...acceptance,...changed}).success,false);
});
test("generic reservation edits cannot silently change protected online particulars",()=>{
  const row={...original(),unitId:"unit",customerId:"customer",facilityId:"store",publicLease:null};
  assert.doesNotThrow(()=>assertReservationQuotePatch(row,{quotedRate:1000,intendedMoveIn:moveIn,unitId:"unit"}));
  for(const patch of [{quotedRate:900},{intendedMoveIn:new Date("2026-10-21")},{unitId:"other"},{customerId:"other"},{facilityId:"other"}])assert.throws(()=>assertReservationQuotePatch(row,patch),/GOVERNED_WORKFLOW/);
  assert.doesNotThrow(()=>assertReservationQuotePatch({...row,initialRentSnapshot:null},{quotedRate:900}));
});

test("negotiated amounts and discounts are rounded once to cents and cannot create zero or negative rent",()=>{
  assert.equal(negotiatedMonthlyRate("1250.00",{mode:"AMOUNT",value:"1100"}),"1100.00");
  assert.equal(negotiatedMonthlyRate("1250.00",{mode:"DISCOUNT_AMOUNT",value:"150.25"}),"1099.75");
  assert.equal(negotiatedMonthlyRate("1250.00",{mode:"DISCOUNT_PERCENT",value:"12.5"}),"1093.75");
  assert.equal(negotiatedMonthlyRate("1.01",{mode:"DISCOUNT_PERCENT",value:"50"}),"0.51");
  for(const value of ["0","100","100.01","-1","1.001","1e2"])assert.throws(()=>negotiatedMonthlyRate("1250.00",{mode:"DISCOUNT_PERCENT",value}),/INVALID/);
  assert.throws(()=>negotiatedMonthlyRate("1250.00",{mode:"DISCOUNT_AMOUNT",value:"1250"}),/INVALID/);
  assert.throws(()=>negotiatedMonthlyRate("1250.00",{mode:"AMOUNT",value:"10000000.01"}),/INVALID/);
});
test("staff quotes require explicit preparation and retain signed, paid and expired holds",()=>{
  const staff={...original(),source:"INTERNAL",contactVerifiedAt:null,emailVerifiedAt:null,initialRentSnapshot:null,publicReference:null};
  assert.ok(reservationPriceBlockers(staff,now).length>0);
  assert.deepEqual(reservationPriceBlockers(staff,now,true),[]);
  assert.deepEqual(reservationPriceBlockers({...staff,publicReference:"PREPARED",initialRentSnapshot:original().initialRentSnapshot},now),[]);
  for(const patch of [{signed:true},{mandate:true},{financialActivity:true},{paymentSessions:1},{holdExpiresAt:now}])assert.ok(reservationPriceBlockers({...staff,...patch},now,true).length>0);
});

test("unsigned unpaid Pay now quotes are eligible while other quote guards remain",()=>{
  assert.deepEqual(reservationPriceBlockers({...original(),source:"PUBLIC_WEBSITE"},now),[]);
  const viewing={...original(),journey:"VIEWING",intendedMoveIn:null,initialRentSnapshot:null,emailVerifiedAt:null};
  assert.ok(reservationPriceBlockers(viewing,now).length>0);
  assert.deepEqual(reservationPriceBlockers(viewing,now,true),[]);
  assert.deepEqual(reservationPriceBlockers({...original(),journey:"VIEWING"},now),[]);
  assert.ok(reservationPriceBlockers({...original(),source:"INTERNAL",journey:"VIEWING"},now).length>0);
  assert.deepEqual(reservationPriceBlockers({...original(),source:"INTERNAL"},now),[]);
});

test("only recorded terminal declines are confirmed failures; pending and ambiguous outcomes stay blocked",()=>{
  const declined={status:"FAILED",failureCode:"DECLINED",processedAt:now};
  assert.equal(confirmedFailedPricePayment(declined),true);
  assert.equal(confirmedFailedPricePayment({...declined,status:"DECLINED"}),true);
  for(const change of [{status:"PENDING"},{status:"TEST_PENDING"},{status:"SUCCEEDED"},{status:"TEST_SUCCEEDED"},{status:"REFUNDED"},{status:"CANCELLED"},{failureCode:"TIMEOUT"},{failureCode:"CHECKOUT_CREATE_FAILED"},{failureCode:"NETCASH_CUSTOMER_CANCELLED"},{failureCode:null},{processedAt:null}])assert.equal(confirmedFailedPricePayment({...declined,...change}),false);
});
