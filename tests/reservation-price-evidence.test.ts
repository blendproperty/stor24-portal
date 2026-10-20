import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {bookingPriceEvidence,type PriceHistoryItem,type PriceHistoryAudit} from "../src/lib/reservation-price-evidence";
import {encryptIntegrationSecret} from "../src/lib/integrations/integration-secret-vault";
import {newPublicInitialRent} from "../src/lib/public-initial-rent";
import {marketingPaymentCohortRows} from "../src/lib/marketing-payment-cohorts";

const canonical=(value:unknown):string=>JSON.stringify(value,(_,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const hash=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
const moveIn=new Date("2026-10-20T10:00:00Z"),reviewedAt=new Date("2026-10-15T08:00:00Z"),acceptedAt=new Date("2026-10-15T08:01:00Z");
function fixture(structured=false){
  const original={version:1,reservationId:"booking",organisationId:"org",facilityId:"store",customerId:"customer",quotedRate:"1000.00",initialRentSnapshot:newPublicInitialRent(1000,moveIn),intendedMoveIn:moveIn.toISOString()};
  const proposed={version:1,monthlyRate:"900.25",initialRentSnapshot:newPublicInitialRent(900.25,moveIn),reason:"Synthetic approved negotiation",...(structured?{adjustment:{mode:"DISCOUNT_AMOUNT" as const,value:"99.75"},reasonSelection:{type:"CAMPAIGN" as const,campaignId:"summer",campaignName:"Summer campaign"}}:{})};
  const sourceFingerprint=hash(original),expiresAt=new Date("2026-10-16T08:00:00Z"),quoteFingerprint=hash({reservationId:"booking",sourceFingerprint,proposed,expiresAt:expiresAt.toISOString()});
  const item:PriceHistoryItem={id:"change",organisationId:"org",facilityId:"store",reservationId:"booking",sourceFingerprint,quoteFingerprint,originalEncrypted:encryptIntegrationSecret(canonical(original)),proposedEncrypted:encryptIntegrationSecret(canonical(proposed)),proposedById:"proposer",reviewedById:"reviewer",reviewedAt,reviewReference:"Synthetic review",acceptedCustomerId:"customer",acceptedAt,acceptanceFingerprint:quoteFingerprint,expiresAt,createdAt:new Date("2026-10-15T07:00:00Z")};
  const audits:PriceHistoryAudit[]=[{entityId:item.id,facilityId:"store",actorId:"reviewer",action:"reservation.price_approved",after:{reservationId:"booking",quoteFingerprint,reference:item.reviewReference,financialPosting:false}},{entityId:item.id,facilityId:"store",actorId:null,action:"reservation.price_customer_accepted",after:{reservationId:"booking",customerId:"customer",quoteFingerprint,verifiedAt:"2026-10-15T08:00:30.000Z",acceptedAt:acceptedAt.toISOString(),newAgreementRequired:true,financialPosting:false}}];
  const booking={id:"booking",facilityId:"store",customerId:"customer",quotedRate:"900.25",initialRentSnapshot:proposed.initialRentSnapshot,intendedMoveIn:moveIn};
  return {item,audits,booking};
}
test("immutable quote evidence preserves original price and customer acceptance as-of boundaries",()=>{
  const old=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString("hex");
  try{
    const {item,audits,booking}=fixture(),after=new Date("2026-10-16T00:00:00Z");
    const evidence=bookingPriceEvidence("org",booking,[item],audits,after);
    assert.equal(evidence.issue,null);assert.equal(evidence.original?.quotedRate,"1000.00");assert.equal(evidence.latestAcceptedQuote,"900.25");assert.equal(evidence.acceptedChanges,1);
    const own={...item,reviewedById:item.proposedById};assert.equal(bookingPriceEvidence("org",booking,[own],audits.map(a=>a.action==="reservation.price_approved"?{...a,actorId:own.reviewedById}:a),after).issue,null);
    const campaign=fixture(true);assert.equal(bookingPriceEvidence("org",campaign.booking,[campaign.item],campaign.audits,after).issue,null);
    const earlier=bookingPriceEvidence("org",booking,[item],audits,acceptedAt);assert.equal(earlier.original?.quotedRate,"1000.00");assert.equal(earlier.acceptedChanges,0);assert.equal(earlier.latestAcceptedQuote,null);
    const lead={id:"lead",facilityId:"store",facility:"Synthetic",customerId:"customer",source:"PUBLIC_QUOTE_FORM",stage:"NEW",createdAt:reviewedAt,enquiryLocation:null,bookings:[{...booking,status:"ACTIVE",convertedTenancyId:null,tenancy:null,priceEvidence:evidence}]};
    const row=marketingPaymentCohortRows([lead],[],[],"2026-10-16")[0];assert.equal(row.originalMonthlyQuote,"1000.00");assert.equal(row.latestAcceptedQuote,"900.25");assert.equal(row.acceptedPriceChanges,1);
    for(const changed of [{...item,sourceFingerprint:"0".repeat(64)},{...item,acceptedCustomerId:"other"},{...item,reviewedById:item.proposedById},{...item,acceptanceFingerprint:"0".repeat(64)},{...item,expiresAt:reviewedAt},{...item,facilityId:"other"}])assert.match(bookingPriceEvidence("org",booking,[changed],audits,after).issue!,/review/);
    for(const broken of [audits.slice(0,1),[...audits,audits[1]],audits.map(a=>({...a,actorId:"other"}))])assert.match(bookingPriceEvidence("org",booking,[item],broken,after).issue!,/review/);
    const held=bookingPriceEvidence("org",{...booking,quotedRate:"1.00"},[item],audits,after);assert.equal(held.original,null);assert.ok(held.issue);
    assert.throws(()=>marketingPaymentCohortRows([{...lead,bookings:[{...lead.bookings[0],priceEvidence:held}]}],[],[],"2026-10-16",true),/REPORT_COHORT_REVIEW/);
  }finally{if(old===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=old;}
});
