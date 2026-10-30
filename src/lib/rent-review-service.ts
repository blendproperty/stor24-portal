import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { southAfricaDateKey } from './south-africa-time';
import { completedMonths, daysBetween, increasedRate, rateForPeriod, rentReviewInput, rentScheduleSchema, rentReviewStateSchema, rentReviewStateInput, validateNoticePeriod, type RentSchedule } from './rent-review-policy';
type Client=Prisma.TransactionClient;
const DOMAIN='OCCUPANCY_RENT_SCHEDULE';
const REVIEW_DOMAIN='OCCUPANCY_RENT_REVIEW';
export async function rentReviewReport(org: string, facilityId: string, client:Client=db, now=new Date()) {
  const facility=await client.facility.findFirst({where:{id:facilityId,organisationId:org},select:{id:true,name:true}}); if(!facility)throw Error('FORBIDDEN');
  const occupancies=await client.occupancy.findMany({where:{tenancy:{facilityId,facility:{organisationId:org},customer:{organisationId:org},status:{in:['ACTIVE','NOTICE_GIVEN']}},status:{in:['ACTIVE','NOTICE_GIVEN']},endDate:null},include:{unit:{select:{number:true,facilityId:true,combinedIntoUnitId:true,monthlyRate:true,unitType:{select:{name:true,facilityId:true,areaSqMetres:true}}}},tenancy:{select:{account:{select:{accountNumber:true,currency:true}},customer:{select:{companyName:true,firstName:true,lastName:true}}}}},orderBy:{id:'asc'},take:1001});
  if(occupancies.length>1000)throw Error('RENT_REVIEW_LIMIT');
  const profiles=await client.configurationProfile.findMany({where:{organisationId:org,facilityId,domain:{in:[DOMAIN,REVIEW_DOMAIN]},name:{in:occupancies.map(o=>o.id)}}});
  const inventory=await client.unit.findMany({where:{facilityId,facility:{organisationId:org},combinedIntoUnitId:null,unitType:{facilityId}},select:{status:true,unitType:{select:{areaSqMetres:true}}},orderBy:{id:'asc'},take:10001});
  if(inventory.length>10000)throw Error('RENT_REVIEW_LIMIT');
  // Current unit-state occupancy across all standalone units of the same recorded area, including service units.
  const sizes=new Map<number,{total:number;occupied:number}>();
  for(const unit of inventory){const area=unit.unitType.areaSqMetres===null?null:Number(unit.unitType.areaSqMetres);if(area===null||area<=0)continue;const size=sizes.get(area)??{total:0,occupied:0};size.total++;if(unit.status==='OCCUPIED')size.occupied++;sizes.set(area,size);}
  const today=southAfricaDateKey(now);
  const rows=occupancies.map(o=>{
    const profile=profiles.find(p=>p.name===o.id&&p.domain===DOMAIN),review=profiles.find(p=>p.name===o.id&&p.domain===REVIEW_DOMAIN);
    const schedule=profile?rentScheduleSchema.parse(profile.config):null,reviewState=review?rentReviewStateSchema.parse(review.config):null;
    const start=southAfricaDateKey(o.startDate),lastChange=schedule?.changes.filter(c=>c.period+'-01'<=today).sort((a,b)=>b.period.localeCompare(a.period))[0]?.period;
    const baseline=Number(o.monthlyRate),currentRate=rateForPeriod(baseline,schedule,today.slice(0,7)),customer=o.tenancy.customer;
    const validUnit=o.unit.facilityId===facilityId&&o.unit.unitType.facilityId===facilityId&&o.unit.combinedIntoUnitId===null;
    const area=validUnit&&o.unit.unitType.areaSqMetres!==null&&Number(o.unit.unitType.areaSqMetres)>0?Number(o.unit.unitType.areaSqMetres):null;
    const size=area===null?null:sizes.get(area),standard=Number(o.unit.monthlyRate),standardRate=validUnit&&Number.isFinite(standard)&&standard>=0?standard:null;
    return {id:o.id,unit:o.unit.number,unitType:o.unit.unitType.name,areaSqMetres:area,sizeUnitCount:size?.total??null,sizeOccupiedCount:size?.occupied??null,sizeOccupancyPercent:size?Math.round(size.occupied/size.total*10000)/100:null,standardRate,varianceAmount:standardRate===null||o.tenancy.account.currency!=='ZAR'?null:Math.round((currentRate-standardRate)*100)/100,variancePercent:standardRate&&o.tenancy.account.currency==='ZAR'?Math.round((currentRate/standardRate-1)*10000)/100:null,reviewStatus:reviewState?.status??'PENDING',reviewReason:reviewState?.reason??null,reviewUpdatedAt:review?.updatedAt.toISOString()??null,customer:customer.companyName||[customer.firstName,customer.lastName].filter(Boolean).join(' ')||'Customer',account:o.tenancy.account.accountNumber,start,daysInUnit:daysBetween(start,today),monthsInUnit:completedMonths(start,today),lastPriceChange:lastChange?lastChange+'-01':null,daysSincePriceChange:lastChange?daysBetween(lastChange+'-01',today):null,currentRate,baseline,schedule,currency:o.tenancy.account.currency,validUnit,updatedAt:o.updatedAt.toISOString()};
  });
  const events=await client.auditEvent.findMany({where:{organisationId:org,facilityId,action:'rent.group_increase.approved',entityType:'Facility',entityId:facilityId},orderBy:{occurredAt:'desc'},take:25,select:{id:true,occurredAt:true,after:true}});
  const history=events.map(e=>{const data=e.after as {batchId?:string;approvalReference?:string;request?:{effectivePeriod?:string;type?:string;value?:number};changes?:{occupancyId:string;before:number;after:number}[]}|null;return {id:e.id,approvedAt:e.occurredAt.toISOString(),batchId:data?.batchId??null,approvalReference:data?.approvalReference??null,effectivePeriod:data?.request?.effectivePeriod??null,type:data?.request?.type??null,value:data?.request?.value??null,changes:Array.isArray(data?.changes)?data.changes:[]};});
  return {facility,today,rows,history};
}
async function preview(org:string,input:unknown,client:Client=db,now=new Date()){
  const request=rentReviewInput.parse(input);validateNoticePeriod(request.effectivePeriod,now);
  const report=await rentReviewReport(org,request.facilityId,client,now);
  if(request.selectedOccupancyIds.some(id=>!report.rows.some(row=>row.id===id)))throw Error('RENT_SELECTION_INVALID');
  const rows=report.rows.map(row=>{const months=request.basis==='TIME_IN_UNIT'?row.monthsInUnit:row.lastPriceChange?completedMonths(row.lastPriceChange,report.today):null;
    let reason=row.reviewStatus==='DISMISSED'?'Dismissed from review':!row.validUnit?'Unit facility mismatch or combined component':row.currency!=='ZAR'?'Currency requires review':months===null?'Last price change unknown':months<request.minimumMonths?'Below selected duration':row.schedule?.changes.some(c=>c.period>=request.effectivePeriod)?'Existing scheduled change requires review':row.schedule&&row.schedule.changes.length>=100?'History limit requires review':null;
    const previousRate=rateForPeriod(row.baseline,row.schedule,request.effectivePeriod);let newRate:number|null=null;if(reason===null){try{newRate=increasedRate(previousRate,request.type,request.value);}catch{reason='Increase rounds to unchanged rent or exceeds the allowed rate; review separately';}}return {...row,eligible:reason===null,selected:request.selectedOccupancyIds.includes(row.id),reason,previousRate,newRate};});
  const fingerprint=createHash('sha256').update(JSON.stringify({org,request,today:report.today,rows})).digest('hex');return {...report,request,rows,fingerprint,eligibleCount:rows.filter(r=>r.eligible).length,selectedCount:rows.filter(r=>r.eligible&&r.selected).length};
}
export async function previewRentReview(org:string,input:unknown){return preview(org,input);}
export async function approveRentReview(org:string,actorId:string,input:unknown,fingerprint:string,approvalReference:string){
  if(!/^[a-f0-9]{64}$/.test(fingerprint)||approvalReference.trim().length<5||approvalReference.length>250)throw Error('RENT_APPROVAL_REQUIRED');
  return db.$transaction(async tx=>{const request=rentReviewInput.parse(input); await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id"=${request.facilityId} AND "organisationId"=${org} FOR UPDATE`;
    const result=await preview(org,request,tx);if(result.fingerprint!==fingerprint)throw Error('RENT_PREVIEW_CHANGED');if(result.rows.some(r=>r.selected&&!r.eligible))throw Error('RENT_SELECTION_REQUIRES_REVIEW');if(!result.selectedCount)throw Error('RENT_SELECT_OCCUPANCIES');const selected=result.rows.filter(r=>r.eligible&&r.selected),batchId=randomUUID(),approvedAt=new Date().toISOString();
    for(const row of selected){const schedule:RentSchedule={baseline:row.baseline,changes:[...(row.schedule?.changes??[]),{period:request.effectivePeriod,rate:row.newRate!,approvedAt,approvalReference:approvalReference.trim(),batchId}]};rentScheduleSchema.parse(schedule);await tx.configurationProfile.upsert({where:{organisationId_facilityId_domain_name:{organisationId:org,facilityId:request.facilityId,domain:DOMAIN,name:row.id}},create:{organisationId:org,facilityId:request.facilityId,domain:DOMAIN,name:row.id,status:'READY',config:schedule},update:{status:'READY',config:schedule}});}
    await tx.auditEvent.create({data:{organisationId:org,facilityId:request.facilityId,actorId,action:'rent.group_increase.approved',entityType:'Facility',entityId:request.facilityId,after:{batchId,request,approvalReference:approvalReference.trim(),fingerprint,changes:selected.map(r=>({occupancyId:r.id,before:r.previousRate,after:r.newRate}))}}});return {batchId,approvedCount:result.selectedCount,effectivePeriod:request.effectivePeriod};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000});
}
export async function changeRentReviewState(org:string,actorId:string,input:unknown){
  const request=rentReviewStateInput.parse(input);
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id"=${request.facilityId} AND "organisationId"=${org} FOR UPDATE`;
    const report=await rentReviewReport(org,request.facilityId,tx),row=report.rows.find(r=>r.id===request.occupancyId);
    if(!row)throw Error('RENT_SELECTION_INVALID');
    if(row.reviewUpdatedAt!==request.expectedUpdatedAt||row.reviewStatus===request.status)throw Error('RENT_REVIEW_CHANGED');
    const config=rentReviewStateSchema.parse({version:1,status:request.status,reason:request.reason});
    await tx.configurationProfile.upsert({where:{organisationId_facilityId_domain_name:{organisationId:org,facilityId:request.facilityId,domain:REVIEW_DOMAIN,name:row.id}},create:{organisationId:org,facilityId:request.facilityId,domain:REVIEW_DOMAIN,name:row.id,status:'READY',config},update:{status:'READY',config}});
    await tx.auditEvent.create({data:{organisationId:org,facilityId:request.facilityId,actorId,action:'rent.review.status_changed',entityType:'Occupancy',entityId:row.id,before:{status:row.reviewStatus,reason:row.reviewReason},after:config}});
    return {status:config.status};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000});
}
export async function rentRatesForBilling(client:Client,org:string,facilityId:string,occupancies:{id:string;monthlyRate:Prisma.Decimal}[],period:string){const profiles=await client.configurationProfile.findMany({where:{organisationId:org,facilityId,domain:DOMAIN,name:{in:occupancies.map(o=>o.id)}}});return new Map(occupancies.map(o=>{const profile=profiles.find(p=>p.name===o.id);return [o.id,rateForPeriod(Number(o.monthlyRate),profile?rentScheduleSchema.parse(profile.config):null,period)];}));}
