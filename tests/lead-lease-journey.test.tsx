import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadLeaseJourney, type JourneyBooking } from "../src/components/lead-lease-journey";

const base: JourneyBooking = { id:"booking /1",status:"ACTIVE",journey:"RENTAL",quotedRate:100,convertedTenancyId:null,unit:{number:"101"} };
const render=(bookings:JourneyBooking[],step=3)=>renderToStaticMarkup(<LeadLeaseJourney bookings={bookings} customerId="customer" step={step} setStep={()=>{}} bookingId="" setBookingId={()=>{}} canReserve busy={false} reserving={false} onReserve={()=>{}}/>);
test("lease progress uses completed document evidence and keeps the exact booking",()=>{
 const unsigned=render([{...base,publicLease:{id:"lease",status:"SIGNED",signedAt:"2026-10-01",signedPdfSha256:null}}]);
 assert.match(unsigned,/Continue to agreement details/);
 assert.doesNotMatch(unsigned,/View signed agreement|Lease agreement signed/);
 assert.match(unsigned,/reservation=booking%20%2F1/);
 const signed={...base,publicLease:{id:"lease",status:"SIGNED",signedAt:"2026-10-01",signedPdfSha256:"hash"}};
 assert.match(render([signed]),/View signed agreement/);
 assert.match(render([signed],4),/Continue in Move In/);
});
test("converted draft uses its existing account without implying occupancy or sending another lease",()=>{
 const html=render([{...base,status:"CONVERTED",convertedTenancyId:"tenancy",convertedTenancy:{status:"DRAFT",accountId:"account /1",documents:[]}}]);
 assert.match(html,/accountId=account%20%2F1/);
 assert.match(html,/Open pending lease/);
 assert.doesNotMatch(html,/Unit and tenancy active|Continue to agreement details|Lease agreement signed/);
});
test("multiple bookings require a deliberate selection and cancelled bookings cannot continue",()=>{
 const html=render([base,{...base,id:"second"}],2);
 assert.match(html,/Choose the correct booking/);
 assert.doesNotMatch(html,/Continue to lease agreement/);
 assert.doesNotMatch(render([{...base,status:"CANCELLED"}]),/Continue to agreement details|reservation=booking/);
});
test("active tenancy cannot mark key handover complete without its saved audit",()=>{
 const active={...base,status:"CONVERTED",convertedTenancyId:"tenancy",convertedTenancy:{status:"ACTIVE",accountId:"account",documents:[{id:"lease",status:"SIGNED",signedAt:"2026-10-01"}]}};
 assert.match(render([active],4),/Active tenancy · check handover/);
 assert.doesNotMatch(render([active],4),/Key handover recorded/);
 assert.match(render([{...active,handedOver:true}],4),/Key handover recorded/);
});


test("an unlinked enquiry cannot offer a reservation action",()=>{
 const html=renderToStaticMarkup(<LeadLeaseJourney bookings={[]} step={2} setStep={()=>{}} bookingId="" setBookingId={()=>{}} canReserve busy={false} reserving={false} onReserve={()=>{}}/>);
 assert.match(html,/needs a linked customer/);
 assert.doesNotMatch(html,/Choose an available unit<\/button>/);
});
