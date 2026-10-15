import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {newPublicInitialRent} from "../src/lib/public-initial-rent";
import {reservationPriceBlockers,reservationPriceProposalSchema,reservationPriceAcceptanceSchema,proposedReservationPrice,requireIndependentPriceApproval,assertReservationQuotePatch} from "../src/lib/reservation-price-policy";
const now=new Date("2026-10-15T08:00:00Z"),moveIn=new Date("2026-10-20T10:00:00Z");
const original=()=>({source:"PUBLIC_WEBSITE",status:"ACTIVE",journey:"RENTAL",convertedTenancyId:null,publicReference:"PUBLIC-ORIGINAL",quotedRate:1000,initialRentSnapshot:newPublicInitialRent(1000,moveIn),intendedMoveIn:moveIn,holdExpiresAt:new Date("2026-10-16"),contactVerifiedAt:now,emailVerifiedAt:now,signed:false,mandate:false,paymentSessions:0,financialActivity:false});
test("only a verified, held, unsigned and financially untouched original quote is eligible",()=>{
  assert.deepEqual(reservationPriceBlockers(original(),now),[]);
  for(const changed of [{signed:true},{status:"CONVERTED"},{convertedTenancyId:"tenancy"},{paymentSessions:1},{financialActivity:true},{mandate:true},{contactVerifiedAt:null},{emailVerifiedAt:null},{holdExpiresAt:new Date("2026-10-14")},{initialRentSnapshot:null},{source:"INTERNAL"},{journey:"VIEWING"}])assert.ok(reservationPriceBlockers({...original(),...changed},now).length>0);
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
