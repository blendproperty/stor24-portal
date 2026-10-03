import test from "node:test";
import assert from "node:assert/strict";
import { createLeadSchema } from "../src/lib/validators";
import { leadReport } from "../src/lib/lead-reporting";
const enquiry = {facilityId:"store",source:"Walk-in",firstName:"Jane",lastName:"Example",phone:"+27000000000",email:""};
test("inline lead capture accepts a new phone contact or an existing customer and requires Other detail",()=>{
 assert.equal(createLeadSchema.safeParse(enquiry).success,true);
 assert.equal(createLeadSchema.safeParse({facilityId:"store",source:"Phone in",customerId:"existing"}).success,true);
 assert.equal(createLeadSchema.safeParse({...enquiry,firstName:""}).success,false);
 assert.equal(createLeadSchema.safeParse({...enquiry,source:"Unknown arbitrary label"}).success,false);
 assert.equal(createLeadSchema.safeParse({...enquiry,source:"Other"}).success,false);
 assert.equal(createLeadSchema.safeParse({...enquiry,source:"Other",sourceDetail:"   "}).success,false);
 assert.equal(createLeadSchema.safeParse({...enquiry,source:"Other",sourceDetail:"School newsletter"}).success,true);
});
test("historical source aliases group together and manual ads remain separate from website attribution",()=>{
 const base={stage:"NEW",createdAt:"2026-10-03T08:00:00Z",nextActionAt:null,attribution:null,reservations:[]};
 const report=leadReport([{...base,source:"Phone"},{...base,source:"Phone in"},{...base,source:"Google Ad"},{...base,source:"Website",attribution:{source:"google",medium:"cpc",landingPage:"/",conversionPage:"/book"}}]);
 assert.equal(report.sources.find(s=>s.label==="Phone in")?.total,2);
 assert.equal(report.sources.find(s=>s.label==="Google Ad")?.total,1);
 assert.equal(report.sources.find(s=>s.label.includes("Google Ad")&&s.label.includes("website"))?.total,1);
 assert.equal(report.attributed,1);
});

test("paid channels are automatic rather than manual choices",()=>{ for(const source of ["Google Ad","Facebook Ad","Instagram Ad"]) assert.equal(createLeadSchema.safeParse({facilityId:"store",source,customerId:"existing"}).success,false); });

import { leadAttributionSchema } from "../src/lib/lead-attribution";
import { websiteSourceLabel } from "../src/lib/lead-sources";
test("CRM accepts normalized automatic acquisition and labels paid channels",()=>{
 for(const source of ["google","facebook","instagram","tiktok","linkedin","youtube","x","pinterest"]){
  const payload={version:1,consent:"granted",landingPage:"/",conversionPage:"/contact",pages:["/"],source,medium:"paid_social",method:"utm"};
  assert.equal(leadAttributionSchema.safeParse(payload).success,true);
  assert.match(websiteSourceLabel(payload),/ Ad$/);
  assert.equal(leadAttributionSchema.safeParse({...payload,method:"manual"}).success,false);
  assert.equal(leadAttributionSchema.safeParse({...payload,utm_campaign:"private@example.com"}).success,false);
 }
 assert.equal(websiteSourceLabel({source:"facebook",medium:"social"}),"Facebook Social");
});
