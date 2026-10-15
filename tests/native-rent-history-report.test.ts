import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {nativeRentHistoryRows,rentHistoryReferenceIds,type RentApprovalEvent,type RentHistoryOccupancy} from "../src/lib/native-rent-history-report";
import {defaultVisualQuery,evaluateVisualReport,REPORT_SOURCE_LIMIT} from "../src/lib/visual-report-engine";
import {visualReportDatasets} from "../src/lib/visual-report-contract";
import {visualReportScope} from "../src/lib/visual-report-security";
import {visualReportErrorResponse} from "../src/lib/visual-report-errors";
function fixture(){
 const event:RentApprovalEvent={id:"approval-1",entityId:"store-1",facilityId:"store-1",facility:{name:"Synthetic store"},occurredAt:new Date("2026-10-04T22:30:00Z"),after:{batchId:randomUUID(),approvalReference:"Synthetic finance reference",fingerprint:"a".repeat(64),request:{facilityId:"store-1",effectivePeriod:"2026-12",type:"AMOUNT",value:12.34,minimumMonths:0,basis:"TIME_IN_UNIT"},changes:[{occupancyId:"occ-1",before:100,after:112.34}],privateData:"excluded"}};
 const occupancy:RentHistoryOccupancy={id:"occ-1",tenancyId:"tenancy-1",unitId:"unit-1",unit:{number:"Current A",facilityId:"store-1"},tenancy:{facilityId:"store-1",account:{accountNumber:"SYN-1",currency:"ZAR"}}};
 return{event,occupancy};
}
test("approved rent history preserves original approval amounts, exact cents, current labels and separate SAST/effective dates",()=>{
 const f=fixture(),before=structuredClone(f),[row]=nativeRentHistoryRows([f.event],[f.occupancy]);assert.equal(row.verified,true);assert.equal(row.previousRate,"100.00");assert.equal(row.newRate,"112.34");assert.equal(row.changeAmount,"12.34");assert.equal(row.date,"2026-10-05");assert.equal(row.effective,"2026-12-01");assert.equal(row.recordedAt,"2026-10-04T22:30:00.000Z");assert.equal(row.unit,"Current A");assert.equal(row.occupancy,"occ-1");assert.ok(!JSON.stringify(row).includes("excluded"));assert.deepEqual(f,before);assert.deepEqual(rentHistoryReferenceIds([f.event]),["occ-1"]);
 const q=defaultVisualQuery("approved-rent-history-native","2026-12-01","2026-12-01");assert.equal(evaluateVisualReport({...q,dateField:"effective"},[row]).matchedRows,1);assert.equal(evaluateVisualReport({...q,dateField:"date"},[row]).matchedRows,0);
});
test("missing or inconsistent sources remain explicit review rows and cannot produce partial money totals",()=>{
 for(const kind of ["missing","wrong-store","wrong-entity","wrong-request","foreign-currency","duplicate-occupancy","decrease","inconsistent-increase","fraction","bad-month"]){
  const f=fixture(),a=f.event.after as {request:{facilityId:string;effectivePeriod:string};changes:{occupancyId:string;before:number;after:number}[]};
  if(kind==="wrong-store")f.occupancy.unit.facilityId="foreign";if(kind==="wrong-entity")f.event.entityId="foreign";if(kind==="wrong-request")a.request.facilityId="foreign";if(kind==="foreign-currency")f.occupancy.tenancy.account.currency="USD";if(kind==="duplicate-occupancy")a.changes.push({...a.changes[0]});if(kind==="decrease")a.changes[0].after=99;if(kind==="inconsistent-increase")a.changes[0].after=150;if(kind==="fraction")a.changes[0].before=100.001;if(kind==="bad-month")a.request.effectivePeriod="2026-13";
  const occupancies=kind==="missing"?[]:[f.occupancy],rows=nativeRentHistoryRows([f.event],occupancies);assert.ok(rows.every(row=>!row.verified&&row.review&&row.previousRate===null&&row.newRate===null&&row.currency===null),kind);assert.throws(()=>nativeRentHistoryRows([f.event],occupancies,{totalingMoney:true}),/REPORT_RATE_REVIEW_REQUIRED/);
  if(kind==="bad-month")assert.throws(()=>nativeRentHistoryRows([f.event],occupancies,{effectiveDateFilter:true}),/REPORT_RATE_DATE_REVIEW/);
 }
});
test("reused batches across dates and duplicate input identities cannot inflate approval history",()=>{
 const f=fixture(),other={...f.event,id:"approval-2",occurredAt:new Date("2026-09-01Z")};assert.ok(nativeRentHistoryRows([f.event,other],[f.occupancy]).every(row=>row.reviewCode==="RATE_APPROVAL_DUPLICATE_REVIEW"));assert.throws(()=>nativeRentHistoryRows([f.event,f.event],[f.occupancy]),/REPORT_RATE_REVIEW_REQUIRED/);assert.throws(()=>nativeRentHistoryRows([f.event],[f.occupancy,f.occupancy]),/REPORT_RATE_REVIEW_REQUIRED/);
});
test("approval input, expanded rows and reference lookups are bounded without silently dropping history",()=>{
 const f=fixture();assert.throws(()=>nativeRentHistoryRows(Array.from({length:REPORT_SOURCE_LIMIT+1},(_,i)=>({...f.event,id:String(i)})),[]),/REPORT_LIMIT/);
 const events=Array.from({length:6},(_,i)=>({...f.event,id:String(i),after:{...(f.event.after as object),batchId:randomUUID(),changes:Array.from({length:1000},(_,j)=>({occupancyId:`occ-${i}-${j}`,before:1,after:2}))}}));assert.throws(()=>rentHistoryReferenceIds(events),/REPORT_LIMIT/);assert.throws(()=>nativeRentHistoryRows(events,[]),/REPORT_LIMIT/);
});
test("rent approval reports require intersecting financial and billing scope with protected personal exports",()=>{
 const dataset=visualReportDatasets.find(d=>d.key==="approved-rent-history-native")!,role=(permissions:string[],facilityId:string)=>({facilityId,role:{name:"Synthetic role",permissions}});
 assert.ok(dataset.fields.find(field=>field.key==="account")?.personal);assert.ok(dataset.fields.find(field=>field.key==="occupancy")?.personal);
 assert.throws(()=>visualReportScope([role(["reports.financial"],"a"),role(["billing.view"],"b")],dataset,"u","org"),/FORBIDDEN/);assert.throws(()=>visualReportScope([role(["reports.financial","billing.view"],"a")],dataset,"u","org",undefined,true),/FORBIDDEN/);assert.deepEqual(visualReportScope([role(["reports.financial","billing.view","reports.export"],"a")],dataset,"u","org",undefined,true).facilityIds,["a"]);
 for(const code of ["REPORT_RATE_REVIEW_REQUIRED","REPORT_RATE_DATE_REVIEW","REPORT_RATE_HISTORY_SOURCE"])assert.equal(visualReportErrorResponse(Error(code)).status,422);
});
