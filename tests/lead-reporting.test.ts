import test from "node:test";
import assert from "node:assert/strict";
import { leadReport } from "../src/lib/lead-reporting";
import { leadAttributionSchema } from "../src/lib/lead-attribution";
const lead = { stage: "NEW", source: "Phone", createdAt: "2026-10-01T08:00:00Z", nextActionAt: null, attribution: null, reservations: [] };
test("sales reports use the selected cohort and completed outcomes, not page clicks",()=>{
  const report=leadReport([lead,{...lead,stage:"WON"},{...lead,nextActionAt:"2026-10-01T09:00:00Z",reservations:[{status:"ACTIVE",quotedRate:1200,convertedTenancyId:null}]},{...lead,stage:"LOST",nextActionAt:"2026-09-30T00:00:00Z"}],new Date("2026-10-02T10:00:00Z"));
  assert.equal(report.total,4);assert.equal(report.open,2);assert.equal(report.won,1);assert.equal(report.conversionRate,25);assert.equal(report.overdue,1);assert.equal(report.pipelineValue,1200);assert.equal(report.attributed,0);assert.equal(report.sources[0].total,4);assert.equal(report.weeks.reduce((n,w)=>n+w.count,0),4);
  assert.equal(leadReport([]).conversionRate,0);
});
test("journey schema accepts public paths and rejects private tokens, queries and contact data",()=>{
  const base={version:1,consent:"granted",landingPage:"/business-storage",conversionPage:"/book",pages:["/business-storage","/contact"],source:"google",medium:"cpc"};
  assert.equal(leadAttributionSchema.safeParse(base).success,true);
  for(const path of ["/my","/book/sign/secret","/pay/result","/contact?email=private@example.com","https://evil.test/"])assert.equal(leadAttributionSchema.safeParse({...base,landingPage:path}).success,false);
  assert.equal(leadAttributionSchema.safeParse({...base,email:"private@example.com"}).success,false);
  assert.equal(leadAttributionSchema.safeParse({...base,consent:"denied"}).success,false);
  assert.equal(leadAttributionSchema.safeParse({...base,pages:Array(13).fill("/")}).success,false);
});
