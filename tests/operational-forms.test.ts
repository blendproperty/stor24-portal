import assert from "node:assert/strict";
import test from "node:test";
import {maintenanceReportSchema,visitorEntrySchema,emptyMaintenanceReport,sastInstant} from "../src/lib/operational-form-policy";
const report={...emptyMaintenanceReport,area:"Synthetic reception",actionRequired:"Review synthetic fixture",discoveredOn:"2026-01-02"};
const visit={kind:"VISITOR",businessDate:"2026-01-02",timeIn:"10:15",name:"Synthetic client",unitId:null,contact:"Synthetic contact",signatureName:"Synthetic client",clientConfirmed:true,policyReference:"Synthetic policy"};
test("maintenance forms preserve unknown values and require external decision and certificate references",()=>{
  assert.equal(maintenanceReportSchema.parse(report).quoteAmount,null);assert.equal(maintenanceReportSchema.parse(report).certificateExpiresOn,null);
  for(const value of [{...report,reportedOn:"2026-01-01"},{...report,resolvedOn:"2026-01-01"},{...report,quoteAmount:"1e5"},{...report,quoteAmount:"-1.00"},{...report,quoteAmount:"1.001"},{...report,quoteDecision:"APPROVED_EXTERNALLY"},{...report,certificateExpiresOn:"2027-01-01"},{...report,pictureReferences:["same","same"]}])assert.equal(maintenanceReportSchema.safeParse(value).success,false);
  assert.ok(maintenanceReportSchema.safeParse({...report,quoteAmount:"0.00",quoteDecision:"REJECTED",quoteReference:"Synthetic decision"}).success);
});
test("visitor and client attendance capture different original fields and explicit typed acknowledgement",()=>{
  assert.ok(visitorEntrySchema.safeParse(visit).success);assert.equal(visitorEntrySchema.safeParse({...visit,contact:""}).success,false);assert.equal(visitorEntrySchema.safeParse({...visit,clientConfirmed:false}).success,false);assert.equal(visitorEntrySchema.safeParse({...visit,signatureName:""}).success,false);
  assert.equal(visitorEntrySchema.safeParse({...visit,kind:"CLIENT_ATTENDANCE"}).success,false);assert.ok(visitorEntrySchema.safeParse({...visit,kind:"CLIENT_ATTENDANCE",contact:""}).success);assert.equal(visitorEntrySchema.safeParse({...visit,name:"Injected\nName"}).success,false);
});
test("South African register times are explicit and invalid calendar/time values are rejected",()=>{
  assert.equal(sastInstant("2026-01-02","10:15").toISOString(),"2026-01-02T08:15:00.000Z");for(const [d,t] of [["2026-02-30","10:00"],["2026-01-02","24:00"],["2026-01-02","10:99"]])assert.throws(()=>sastInstant(d,t));
});
