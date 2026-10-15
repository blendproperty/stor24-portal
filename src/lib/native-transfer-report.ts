import { z } from "zod";
import { ReportError, REPORT_SOURCE_LIMIT } from "./visual-report-engine";
import type { VisualReportRow } from "./visual-report-contract";
import { southAfricaDateKey } from "./south-africa-time";

const identity=z.string().min(1).max(100);
const beforeSchema=z.object({unitId:identity,occupancyId:identity});
const afterSchema=beforeSchema.extend({effectiveAt:z.iso.datetime()});
export type TransferEvent={id:string;entityId:string;facilityId:string|null;facility:{name:string}|null;occurredAt:Date;before:unknown;after:unknown};
export type TransferOccupancy={id:string;tenancyId:string;unitId:string;startDate:Date;endDate:Date|null;unit:{number:string;facilityId:string};tenancy:{facilityId:string;account:{accountNumber:string}}};
export function transferReferenceIds(events:TransferEvent[]){
  const ids=new Set<string>();
  for(const event of events){const before=beforeSchema.safeParse(event.before),after=afterSchema.safeParse(event.after);if(before.success)ids.add(before.data.occupancyId);if(after.success)ids.add(after.data.occupancyId)}
  return [...ids];
}
/** Pair only explicit transactional transfer events; never infer a pair from dates. */
export function nativeTransferRows(events:TransferEvent[],occupancies:TransferOccupancy[],effectiveDateFilter=false):VisualReportRow[]{
  if(events.length>REPORT_SOURCE_LIMIT)throw new ReportError("REPORT_LIMIT");
  if(new Set(events.map(event=>event.id)).size!==events.length||new Set(occupancies.map(row=>row.id)).size!==occupancies.length)throw new ReportError("REPORT_TRANSFER_REVIEW_REQUIRED");
  const indexed=new Map(occupancies.map(row=>[row.id,row]));
  const sources=new Set<string>(),destinations=new Set<string>();
  const references=events.map(event=>({event,before:beforeSchema.safeParse(event.before),after:afterSchema.safeParse(event.after)}));
  const duplicateSources=new Set<string>(),duplicateDestinations=new Set<string>();
  for(const {before,after} of references){if(before.success){if(sources.has(before.data.occupancyId))duplicateSources.add(before.data.occupancyId);sources.add(before.data.occupancyId)}if(after.success){if(destinations.has(after.data.occupancyId))duplicateDestinations.add(after.data.occupancyId);destinations.add(after.data.occupancyId)}}
  return references.map(({event,before,after})=>{
    if(effectiveDateFilter&&!after.success)throw new ReportError("REPORT_TRANSFER_DATE_REVIEW");
    const from=before.success?indexed.get(before.data.occupancyId):undefined,to=after.success?indexed.get(after.data.occupancyId):undefined;
    const effective=after.success?after.data.effectiveAt:null;
    const paired=before.success&&after.success&&before.data.unitId!==after.data.unitId&&before.data.occupancyId!==after.data.occupancyId;
    const bound=paired&&from&&to&&!!event.facilityId&&from.tenancyId===event.entityId&&to.tenancyId===event.entityId&&from.tenancy.facilityId===event.facilityId&&to.tenancy.facilityId===event.facilityId&&from.unit.facilityId===event.facilityId&&to.unit.facilityId===event.facilityId&&from.unitId===before.data.unitId&&to.unitId===after.data.unitId;
    const dates=bound&&from.endDate?.getTime()===Date.parse(effective!)&&to.startDate.getTime()===Date.parse(effective!)&&from.startDate<=to.startDate;
    const reused=before.success&&after.success&&(duplicateSources.has(before.data.occupancyId)||duplicateDestinations.has(after.data.occupancyId));
    const review=!paired?"TRANSFER_PAYLOAD_REVIEW":!bound?"TRANSFER_REFERENCE_REVIEW":!dates?"TRANSFER_DATE_REVIEW":reused?"TRANSFER_DUPLICATE_LINK_REVIEW":null;
    return{facility:event.facility?.name??"Unassigned",transfer:event.id,tenancy:event.entityId,account:bound?from.tenancy.account.accountNumber:null,date:southAfricaDateKey(event.occurredAt),recordedAt:event.occurredAt.toISOString(),effective:effective?southAfricaDateKey(new Date(effective)):null,effectiveAt:effective,fromUnit:bound?from.unit.number:null,toUnit:bound?to.unit.number:null,fromUnitId:before.success?before.data.unitId:null,toUnitId:after.success?after.data.unitId:null,fromOccupancy:before.success?before.data.occupancyId:null,toOccupancy:after.success?after.data.occupancyId:null,verified:review===null,review};
  });
}
