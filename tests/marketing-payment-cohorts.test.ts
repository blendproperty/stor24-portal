import test from "node:test";
import assert from "node:assert/strict";
import { marketingPaymentCohortRows, type CohortLead, type CohortOutcome } from "../src/lib/marketing-payment-cohorts";
import { newPublicInitialRent } from "../src/lib/public-initial-rent";
import { recordEnquiryLocation } from "../src/lib/enquiry-location";
import { visualReportDatasets, visualReportSchema } from "../src/lib/visual-report-contract";
import { visualReportScope } from "../src/lib/visual-report-security";
import { defaultVisualQuery, evaluateVisualReport } from "../src/lib/visual-report-engine";

const moveIn = new Date("2026-09-01T10:00:00Z");
const lead = (): CohortLead => ({id:"enquiry",facilityId:"store",facility:"Test store",customerId:"customer",source:"PUBLIC_QUOTE_FORM",stage:"WON",createdAt:moveIn,enquiryLocation:recordEnquiryLocation({city:"Cape Town",postalCode:"0012"},"PUBLIC_SELF_REPORTED",moveIn),bookings:[{id:"booking",facilityId:"store",customerId:"customer",status:"CONVERTED",quotedRate:"123.45",intendedMoveIn:moveIn,initialRentSnapshot:newPublicInitialRent(123.45,moveIn),convertedTenancyId:"tenancy",tenancy:{id:"tenancy",facilityId:"store",customerId:"customer",accountId:"account"}}]});
const outcome = (): CohortOutcome => ({accountId:"account",facilityId:"store",customerId:"customer",issue:null,overdueCents:125,netReceiptCents:12345,receiptCount:1,hold:null});
const attribution={version:1,consent:"granted",landingPage:"/",conversionPage:"/contact",pages:["/","/contact"],source:"google",medium:"cpc"};

test("cohorts preserve enquiry denominator, exact money, provenance and leading-zero postcodes",()=>{
  const unconverted={...lead(),id:"unconverted",bookings:[],enquiryLocation:null,stage:"NEW"};
  const rows=marketingPaymentCohortRows([lead(),unconverted],[{leadId:"enquiry",facilityId:"store",attribution,campaign:null}],[outcome()],"2026-09-30");
  assert.equal(rows.length,2);assert.equal(rows[0].postalCode,"0012");assert.equal(rows[0].locationSource,"PUBLIC_SELF_REPORTED");assert.equal(rows[0].originalMonthlyQuote,"123.45");assert.equal(rows[0].netReceipts,"123.45");assert.equal(rows[0].overdue,"1.25");assert.equal(rows[0].paymentOutcome,"OVERDUE");assert.equal(rows[0].acquisitionSource,"google");
  assert.equal(rows[1].paymentOutcome,"NOT_CONVERTED");assert.equal(rows[1].city,"Unknown");assert.equal(rows[1].netReceipts,null);
});
test("unverified receipt history never becomes a good-paying cohort or monetary total",()=>{
  const rows=marketingPaymentCohortRows([lead()],[],[{...outcome(),issue:"Receipt source requires reconciliation"}],"2026-09-30");
  assert.equal(rows[0].paymentOutcome,"REVIEW_REQUIRED");assert.equal(rows[0].netReceipts,null);assert.equal(rows[0].overdue,null);
  assert.throws(()=>marketingPaymentCohortRows([lead()],[],[{...outcome(),issue:"Missing receipt proof"}],"2026-09-30",true),/REPORT_COHORT_REVIEW/);
});
test("same customer/store identities are required and shared accounts cannot inflate cohorts",()=>{
  for(const changed of [{facilityId:"other"},{customerId:"other"}]){
    const rows=marketingPaymentCohortRows([lead()],[],[{...outcome(),...changed}],"2026-09-30");assert.equal(rows[0].netReceipts,null);assert.equal(rows[0].paymentOutcome,"REVIEW_REQUIRED");
  }
  const duplicate={...lead(),id:"second-lead"};
  assert.ok(marketingPaymentCohortRows([lead(),duplicate],[],[outcome()],"2026-09-30").every(row=>row.netReceipts===null&&row.paymentOutcome==="REVIEW_REQUIRED"));
  const multi=lead();multi.bookings.push({...multi.bookings[0],id:"second-booking"});assert.equal(marketingPaymentCohortRows([multi],[],[outcome()],"2026-09-30")[0].bookingCount,2);
  const broken=lead();broken.bookings[0].facilityId="foreign-store";
  const held=marketingPaymentCohortRows([broken],[],[outcome()],"2026-09-30")[0];assert.equal(held.booking,null);assert.equal(held.originalMonthlyQuote,null);assert.equal(held.netReceipts,null);
});
test("missing or edited original quotes and conflicting attribution remain review items",()=>{
  for(const snapshot of [null,{...newPublicInitialRent(500,moveIn)}]){
    const item=lead();item.bookings[0].initialRentSnapshot=snapshot;const row=marketingPaymentCohortRows([item],[],[outcome()],"2026-09-30")[0];assert.equal(row.originalMonthlyQuote,null);assert.equal(row.paymentOutcome,"REVIEW_REQUIRED");
  }
  const row=marketingPaymentCohortRows([lead()],[{leadId:"enquiry",facilityId:"store",attribution,campaign:null},{leadId:"enquiry",facilityId:"store",attribution:{...attribution,source:"bing"},campaign:null}],[outcome()],"2026-09-30")[0];
  assert.equal(row.acquisitionSource,"Unknown");assert.match(String(row.acquisitionReview),/Conflicting/);assert.equal(row.netReceipts,"123.45");
});
test("native cohort reports intersect all marketing and finance permissions by store",()=>{
  const dataset=visualReportDatasets.find(d=>d.key==="marketing-payment-cohorts")!;
  const grants=["reports.financial","leads.view","reports.sales","billing.view","collections.view"];
  const assignments=grants.map(permission=>({facilityId:"store",role:{permissions:[permission]}})) as Parameters<typeof visualReportScope>[0];
  assert.deepEqual(visualReportScope(assignments,dataset,"user","org").facilityIds,["store"]);
  for(let i=0;i<grants.length;i++)assert.throws(()=>visualReportScope(assignments.filter((_,j)=>j!==i),dataset,"user","org"),/FORBIDDEN/);
  const mixed=assignments.map((a,i)=>({...a,facilityId:i===4?"other":a.facilityId}));assert.throws(()=>visualReportScope(mixed,dataset,"user","org"),/FORBIDDEN/);
});
test("report filters and grouped outcome counts retain missing/unconverted records",()=>{
  const rows=marketingPaymentCohortRows([lead(),{...lead(),id:"new",bookings:[]}],[],[outcome()],"2026-09-30");
  const query=visualReportSchema.parse({...defaultVisualQuery("marketing-payment-cohorts","2026-09-01","2026-09-30"),groupBy:["source","paymentOutcome"],metrics:[{field:"*",operation:"count"}]});
  const result=evaluateVisualReport(query,rows);assert.equal(result.rows.length,2);
});
