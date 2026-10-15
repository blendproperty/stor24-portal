import assert from "node:assert/strict";
import test from "node:test";
import {nativeTransferRows,transferReferenceIds,type TransferEvent,type TransferOccupancy} from "../src/lib/native-transfer-report";
import {defaultVisualQuery,evaluateVisualReport,REPORT_SOURCE_LIMIT} from "../src/lib/visual-report-engine";
import {queryFromTemplate,visualReportTemplates} from "../src/lib/visual-report-templates";
import {visualReportDatasets} from "../src/lib/visual-report-contract";
import {visualReportScope} from "../src/lib/visual-report-security";
const effective="2026-10-01T22:30:00.000Z",recorded=new Date("2026-10-04T08:00:00Z");
function fixture(){
  const event:TransferEvent={id:"event-1",entityId:"tenancy-1",facilityId:"store-1",facility:{name:"Synthetic store"},occurredAt:recorded,before:{unitId:"unit-1",occupancyId:"occ-1"},after:{unitId:"unit-2",occupancyId:"occ-2",effectiveAt:effective,monthlyRate:999,privateData:"excluded"}};
  const base={tenancyId:"tenancy-1",tenancy:{facilityId:"store-1",account:{accountNumber:"SYN-1"}}};
  const occupancies:TransferOccupancy[]=[{...base,id:"occ-1",unitId:"unit-1",startDate:new Date("2026-01-01Z"),endDate:new Date(effective),unit:{number:"Current A",facilityId:"store-1"}},{...base,id:"occ-2",unitId:"unit-2",startDate:new Date(effective),endDate:new Date("2026-10-20Z"),unit:{number:"Current B",facilityId:"store-1"}}];
  return{event,occupancies};
}
test("native pairs retain explicit identities, current labels and separate effective/recorded SAST dates without money",()=>{
  const f=fixture(),before=structuredClone(f);const [row]=nativeTransferRows([f.event],f.occupancies);assert.equal(row.verified,true);assert.equal(row.review,null);assert.equal(row.transfer,"event-1");assert.equal(row.fromOccupancy,"occ-1");assert.equal(row.toOccupancy,"occ-2");assert.equal(row.fromUnit,"Current A");assert.equal(row.toUnitId,"unit-2");assert.equal(row.account,"SYN-1");assert.equal(row.effective,"2026-10-02");assert.equal(row.date,"2026-10-04");assert.equal(row.effectiveAt,effective);assert.equal(row.recordedAt,recorded.toISOString());assert.equal("monthlyRate"in row,false);assert.ok(!JSON.stringify(row).includes("excluded"));assert.deepEqual(f,before);
  const q=defaultVisualQuery("transfers-native","2026-10-02","2026-10-02");assert.equal(evaluateVisualReport({...q,dateField:"effective"},[row]).matchedRows,1);assert.equal(evaluateVisualReport({...q,dateField:"date"},[row]).matchedRows,0);
  assert.deepEqual(transferReferenceIds([f.event]),["occ-1","occ-2"]);
});
test("bad payloads, original binding, dates and repeated links stay visible as review rows rather than invented pairs",()=>{
  for(const kind of ['missing','same-unit','same-occupancy','wrong-tenancy','wrong-store','wrong-unit','wrong-date','future-origin','missing-reference']){
    const f=fixture();if(kind==='missing')f.event.after={};if(kind==='same-unit')f.event.after={...(f.event.after as object),unitId:'unit-1'};if(kind==='same-occupancy')f.event.after={...(f.event.after as object),occupancyId:'occ-1'};if(kind==='wrong-tenancy')f.occupancies[1].tenancyId='foreign';if(kind==='wrong-store')f.occupancies[1].unit.facilityId='foreign';if(kind==='wrong-unit')f.occupancies[1].unitId='foreign';if(kind==='wrong-date')f.occupancies[0].endDate=new Date('2026-10-03Z');if(kind==='future-origin')f.occupancies[0].startDate=new Date('2026-10-03Z');if(kind==='missing-reference')f.occupancies.pop();
    const [row]=nativeTransferRows([f.event],f.occupancies);assert.equal(row.verified,false,kind);assert.ok(row.review,kind);assert.equal(row.transfer,'event-1');
  }
  const f=fixture();const duplicate={...f.event,id:'event-2'};assert.ok(nativeTransferRows([f.event,duplicate],f.occupancies).every(row=>row.review==='TRANSFER_DUPLICATE_LINK_REVIEW'));
  assert.throws(()=>nativeTransferRows([f.event,f.event],f.occupancies),/REPORT_TRANSFER_REVIEW_REQUIRED/);assert.throws(()=>nativeTransferRows([f.event],[...f.occupancies,f.occupancies[0]]),/REPORT_TRANSFER_REVIEW_REQUIRED/);
  f.event.after={};assert.throws(()=>nativeTransferRows([f.event],f.occupancies,true),/REPORT_TRANSFER_DATE_REVIEW/);assert.equal(nativeTransferRows([f.event],f.occupancies)[0].effective,null);
  assert.throws(()=>nativeTransferRows(Array.from({length:REPORT_SOURCE_LIMIT+1},(_,i)=>({...f.event,id:String(i)})),[]),/REPORT_LIMIT/);
});
test("transfer reports require intersecting operational/report grants and retain personal export classification",()=>{
  const dataset=visualReportDatasets.find(d=>d.key==='transfers-native')!,template=visualReportTemplates.find(t=>t.key==='transfers-native')!;assert.equal(queryFromTemplate(template,'2026-10-01','2026-10-31').dateField,'date');assert.ok(dataset.fields.find(field=>field.key==='account')?.personal);assert.ok(dataset.fields.find(field=>field.key==='tenancy')?.personal);assert.ok(!dataset.fields.some(field=>field.type==='money'));
  const role=(permissions:string[],facilityId:string)=>({facilityId,role:{name:'Synthetic role',permissions}});
  assert.throws(()=>visualReportScope([role(['reports.view'],'a'),role(['operations.view'],'b')],dataset,'u','org'),/FORBIDDEN/);assert.throws(()=>visualReportScope([role(['reports.view','operations.view'],'a')],dataset,'u','org',undefined,true),/FORBIDDEN/);
  assert.deepEqual(visualReportScope([role(['reports.view','operations.view','reports.export'],'a')],dataset,'u','org',undefined,true).facilityIds,['a']);
});
