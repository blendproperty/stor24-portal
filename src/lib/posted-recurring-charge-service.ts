import {z} from 'zod';
import {db} from '@/lib/db';
import {facilityWhere,requireFacility,type RequestScope} from './scope';
import {billingPeriodSchema,periodDates} from './monthly-billing-policy';
import {postedRecurringRows} from './posted-recurring-charge-policy';
import type {ReportParameters} from './reporting';
import type {ReportRow} from './report-data-service';

export function postedBillingPeriods(from:string,to:string){
 if(!z.iso.date().safeParse(from).success||!z.iso.date().safeParse(to).success||from>to)throw Error('POSTED_REPORT_PERIOD_INVALID');
 const periods:string[]=[];let year=Number(from.slice(0,4)),month=Number(from.slice(5,7));
 while(`${year}-${String(month).padStart(2,'0')}`<=to.slice(0,7)){
  const period=`${year}-${String(month).padStart(2,'0')}`;billingPeriodSchema.parse(period);periods.push(period);if(periods.length>60)throw Error('POSTED_REPORT_LIMIT');
  if(++month===13){year++;month=1;}
 }
 return periods;
}
export async function postedRecurringChargeReport(scope:RequestScope,parameters:ReportParameters){
 if(parameters.facilityId)await requireFacility(scope,parameters.facilityId);
 const periods=postedBillingPeriods(parameters.from,parameters.to),from=new Date(`${parameters.from}T00:00:00.000+02:00`),to=new Date(`${parameters.to}T23:59:59.999+02:00`),snapshotTakenAt=new Date().toISOString();
 return db.$transaction(async tx=>{
  const events=await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,action:'billing.month_posted',entityType:'Account',facility:{AND:[facilityWhere(scope),...(parameters.facilityId?[{id:parameters.facilityId}]:[])]},OR:[...periods.map(period=>({after:{path:['period'],equals:period}})),{occurredAt:{gte:from,lte:to}}]},include:{facility:{select:{id:true,name:true,code:true}}},orderBy:[{occurredAt:'asc'},{id:'asc'}],take:501});
  if(events.length>500)throw Error('POSTED_REPORT_LIMIT');
  const rows:ReportRow[]=[],seen=new Set<string>();
  for(const event of events){
   const data=event.after as {period?:unknown;documentId?:unknown;invoiceNumber?:unknown}|null;
   const parsed=billingPeriodSchema.safeParse(data?.period);
   if(parsed.success){const effective=periodDates(parsed.data).effectiveAt;if(effective<from||effective>to)continue;}
   const account=await tx.account.findFirst({where:{id:event.entityId,customer:{organisationId:scope.organisationId}},select:{id:true,currency:true,tenancy:{select:{id:true,customerId:true}},customerId:true}});
   let document=null,entries:Parameters<typeof postedRecurringRows>[0]['entries']=[];
   if(account?.tenancy&&account.currency==='ZAR'&&account.customerId===account.tenancy.customerId&&parsed.success&&typeof data?.documentId==='string'&&typeof data.invoiceNumber==='string'){
    document=await tx.document.findFirst({where:{id:data.documentId,tenancyId:account.tenancy.id,type:'INVOICE',idempotencyKey:`monthly-invoice:${account.id}:${parsed.data}`},select:{id:true,externalId:true,content:true,sha256:true}});
    const lines=await tx.ledgerEntry.findMany({where:{accountId:account.id,type:{in:['CHARGE','CREDIT']},metadata:{path:['billingPeriod'],equals:parsed.data},OR:[{externalRef:`RENT-${parsed.data}`},{externalRef:{startsWith:`BILL-${parsed.data}-`}}]},orderBy:{id:'asc'},take:101});
    entries=lines.map(line=>({...line,amount:line.amount.toFixed(2),taxAmount:line.taxAmount.toFixed(2),effectiveAt:line.effectiveAt.toISOString()}));
   }
   const result=postedRecurringRows({facility:event.facility!.name,facilityId:event.facility!.id,accountId:event.entityId,recordedAt:event.occurredAt.toISOString(),posting:event.after,document,entries},snapshotTakenAt);
   const key=`${event.entityId}:${parsed.success?parsed.data:event.id}`;
   if(seen.has(key))throw Error('POSTED_REPORT_DUPLICATE_SOURCE');seen.add(key);
   rows.push(...result.map(row=>({...row,facilityCode:event.facility!.code,postingId:event.id,dateBasis:'Billing effective date; unavailable periods use recorded-date review exceptions'})));
   if(rows.length>5000)throw Error('POSTED_REPORT_LIMIT');
  }
  return rows;
 },{isolationLevel:'RepeatableRead',timeout:20000});
}
