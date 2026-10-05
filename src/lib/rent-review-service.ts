import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { southAfricaDateKey } from './south-africa-time';
import { completedMonths, daysBetween, increasedRate, rateForPeriod, rentReviewInput, rentScheduleSchema, validateNoticePeriod, type RentSchedule } from './rent-review-policy';
type Client=Prisma.TransactionClient;
const DOMAIN='OCCUPANCY_RENT_SCHEDULE';
export async function rentReviewReport(org: string, facilityId: string, client:Client=db, now=new Date()) {
  const facility=await client.facility.findFirst({where:{id:facilityId,organisationId:org},select:{id:true,name:true}}); if(!facility)throw Error('FORBIDDEN');
  const occupancies=await client.occupancy.findMany({where:{tenancy:{facilityId,facility:{organisationId:org},customer:{organisationId:org},status:{in:['ACTIVE','NOTICE_GIVEN']}},status:{in:['ACTIVE','NOTICE_GIVEN']},endDate:null},include:{unit:{select:{number:true,facilityId:true}},tenancy:{select:{account:{select:{accountNumber:true,currency:true}},customer:{select:{companyName:true,firstName:true,lastName:true}}}}},orderBy:{id:'asc'},take:1001});
  if(occupancies.length>1000)throw Error('RENT_REVIEW_LIMIT');
  const profiles=await client.configurationProfile.findMany({where:{organisationId:org,facilityId,domain:DOMAIN,name:{in:occupancies.map(o=>o.id)}}});
  const today=southAfricaDateKey(now);
  const rows=occupancies.map(o=>{const profile=profiles.find(p=>p.name===o.id);const schedule=profile?rentScheduleSchema.parse(profile.config):null; const start=southAfricaDateKey(o.startDate); const lastChange=schedule?.changes.filter(c=>c.period+'-01'<=today).sort((a,b)=>b.period.localeCompare(a.period))[0]?.period; const baseline=Number(o.monthlyRate);const customer=o.tenancy.customer;return {id:o.id,unit:o.unit.number,customer:customer.companyName||[customer.firstName,customer.lastName].filter(Boolean).join(' ')||'Customer',account:o.tenancy.account.accountNumber,start,daysInUnit:daysBetween(start,today),monthsInUnit:completedMonths(start,today),lastPriceChange:lastChange?lastChange+'-01':null,daysSincePriceChange:lastChange?daysBetween(lastChange+'-01',today):null,currentRate:rateForPeriod(baseline,schedule,today.slice(0,7)),baseline,schedule,currency:o.tenancy.account.currency,validUnit:o.unit.facilityId===facilityId,updatedAt:o.updatedAt.toISOString()};});
  const events=await client.auditEvent.findMany({where:{organisationId:org,facilityId,action:'rent.group_increase.approved',entityType:'Facility',entityId:facilityId},orderBy:{occurredAt:'desc'},take:25,select:{id:true,occurredAt:true,after:true}});
  const history=events.map(e=>{const data=e.after as {batchId?:string;approvalReference?:string;request?:{effectivePeriod?:string;type?:string;value?:number};changes?:{occupancyId:string;before:number;after:number}[]}|null;return {id:e.id,approvedAt:e.occurredAt.toISOString(),batchId:data?.batchId??null,approvalReference:data?.approvalReference??null,effectivePeriod:data?.request?.effectivePeriod??null,type:data?.request?.type??null,value:data?.request?.value??null,changes:Array.isArray(data?.changes)?data.changes:[]};});
  return {facility,today,rows,history};
}
async function preview(org:string,input:unknown,client:Client=db,now=new Date()){
  const request=rentReviewInput.parse(input);validateNoticePeriod(request.effectivePeriod,now);
  const report=await rentReviewReport(org,request.facilityId,client,now);
  const rows=report.rows.map(row=>{const months=request.basis==='TIME_IN_UNIT'?row.monthsInUnit:row.lastPriceChange?completedMonths(row.lastPriceChange,report.today):null;
    let reason=!row.validUnit?'Unit facility mismatch':row.currency!=='ZAR'?'Currency requires review':months===null?'Last price change unknown':months<request.minimumMonths?'Below selected duration':row.schedule?.changes.some(c=>c.period>=request.effectivePeriod)?'Existing scheduled change requires review':row.schedule&&row.schedule.changes.length>=100?'History limit requires review':null;
    const previousRate=rateForPeriod(row.baseline,row.schedule,request.effectivePeriod);let newRate:number|null=null;if(reason===null){try{newRate=increasedRate(previousRate,request.type,request.value);}catch{reason='Increase rounds to unchanged rent or exceeds the allowed rate; review separately';}}return {...row,eligible:reason===null,reason,previousRate,newRate};});
  const fingerprint=createHash('sha256').update(JSON.stringify({org,request,today:report.today,rows})).digest('hex');return {...report,request,rows,fingerprint,eligibleCount:rows.filter(r=>r.eligible).length};
}
export async function previewRentReview(org:string,input:unknown){return preview(org,input);}
export async function approveRentReview(org:string,actorId:string,input:unknown,fingerprint:string,approvalReference:string){
  if(!/^[a-f0-9]{64}$/.test(fingerprint)||approvalReference.trim().length<5||approvalReference.length>250)throw Error('RENT_APPROVAL_REQUIRED');
  return db.$transaction(async tx=>{const request=rentReviewInput.parse(input); await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id"=${request.facilityId} AND "organisationId"=${org} FOR UPDATE`;
    const result=await preview(org,request,tx);if(result.fingerprint!==fingerprint)throw Error('RENT_PREVIEW_CHANGED');if(!result.eligibleCount)throw Error('RENT_NO_ELIGIBLE_OCCUPANCIES');const batchId=randomUUID(),approvedAt=new Date().toISOString();
    for(const row of result.rows.filter(r=>r.eligible)){const schedule:RentSchedule={baseline:row.baseline,changes:[...(row.schedule?.changes??[]),{period:request.effectivePeriod,rate:row.newRate!,approvedAt,approvalReference:approvalReference.trim(),batchId}]};rentScheduleSchema.parse(schedule);await tx.configurationProfile.upsert({where:{organisationId_facilityId_domain_name:{organisationId:org,facilityId:request.facilityId,domain:DOMAIN,name:row.id}},create:{organisationId:org,facilityId:request.facilityId,domain:DOMAIN,name:row.id,status:'READY',config:schedule},update:{status:'READY',config:schedule}});}
    await tx.auditEvent.create({data:{organisationId:org,facilityId:request.facilityId,actorId,action:'rent.group_increase.approved',entityType:'Facility',entityId:request.facilityId,after:{batchId,request,approvalReference:approvalReference.trim(),fingerprint,changes:result.rows.filter(r=>r.eligible).map(r=>({occupancyId:r.id,before:r.previousRate,after:r.newRate}))}}});return {batchId,approvedCount:result.eligibleCount,effectivePeriod:request.effectivePeriod};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000});
}
export async function rentRatesForBilling(client:Client,org:string,facilityId:string,occupancies:{id:string;monthlyRate:Prisma.Decimal}[],period:string){const profiles=await client.configurationProfile.findMany({where:{organisationId:org,facilityId,domain:DOMAIN,name:{in:occupancies.map(o=>o.id)}}});return new Map(occupancies.map(o=>{const profile=profiles.find(p=>p.name===o.id);return [o.id,rateForPeriod(Number(o.monthlyRate),profile?rentScheduleSchema.parse(profile.config):null,period)];}));}
