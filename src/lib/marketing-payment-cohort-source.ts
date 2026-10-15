import { bookingPriceEvidence } from "./reservation-price-evidence";
import { db } from "./db";
import { facilityWhere, requireFacility, type RequestScope } from "./scope";
import { collectionCohortOutcomes } from "./collections-service";
import { marketingPaymentCohortRows, type CohortAttribution } from "./marketing-payment-cohorts";
import { leadAttributionSchema } from "./lead-attribution";
import { REPORT_SOURCE_LIMIT, ReportError } from "./visual-report-engine";
import type { VisualReportQuery } from "./visual-report-contract";

export async function marketingPaymentCohortSource(scope: RequestScope, query: VisualReportQuery) {
  if (query.facilityId) await requireFacility(scope,query.facilityId);
  const bounded = <T>(rows: T[]) => { if (rows.length > REPORT_SOURCE_LIMIT) throw new ReportError("REPORT_LIMIT"); return rows; };
  const facility = {...facilityWhere(scope), ...(query.facilityId ? {id: query.facilityId} : {})};
  try { return await db.$transaction(async tx => {
    const org = await tx.organisation.findUniqueOrThrow({where:{id:scope.organisationId}, select:{currency:true}});
    if (org.currency !== "ZAR") throw new ReportError("REPORT_COHORT_CURRENCY");
    const leads = bounded(await tx.lead.findMany({where:{facility, createdAt:{gte:new Date(`${query.from}T00:00:00+02:00`),lt:new Date(new Date(`${query.to}T00:00:00+02:00`).getTime()+86400000)}},take:REPORT_SOURCE_LIMIT+1,orderBy:{id:"asc"},select:{id:true,facilityId:true,facility:{select:{name:true}},customerId:true,source:true,stage:true,createdAt:true,enquiryLocation:true}}));
    const bookings = leads.length ? bounded(await tx.reservation.findMany({where:{leadId:{in:leads.map(l=>l.id)}},take:REPORT_SOURCE_LIMIT+1,orderBy:{id:"asc"},select:{leadId:true,id:true,facilityId:true,customerId:true,status:true,quotedRate:true,intendedMoveIn:true,initialRentSnapshot:true,convertedTenancyId:true,convertedTenancy:{select:{id:true,facilityId:true,customerId:true,accountId:true}}}})) : [];
    const priceItems=bookings.length?bounded(await tx.reservationPriceAmendment.findMany({where:{organisationId:scope.organisationId,reservationId:{in:bookings.map(b=>b.id)},status:"APPLIED"},take:REPORT_SOURCE_LIMIT+1,orderBy:[{createdAt:"asc"},{id:"asc"}]})):[];
    const priceAudits=priceItems.length?bounded(await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,entityType:"ReservationPriceAmendment",entityId:{in:priceItems.map(i=>i.id)},action:{in:["reservation.price_approved","reservation.price_customer_accepted"]}},take:REPORT_SOURCE_LIMIT+1,select:{entityId:true,facilityId:true,actorId:true,action:true,after:true}})):[];
    const priceAsOf=new Date(new Date(`${query.to}T00:00:00+02:00`).getTime()+86400000);
    const prices=new Map(bookings.map(b=>[b.id,bookingPriceEvidence(scope.organisationId,b,priceItems.filter(i=>i.reservationId===b.id),priceAudits,priceAsOf)]));
    const bookingsByLead = new Map<string, typeof bookings>();
    for(const booking of bookings)if(booking.leadId){const group=bookingsByLead.get(booking.leadId)??[];group.push(booking);bookingsByLead.set(booking.leadId,group);}
    const events = leads.length ? bounded(await tx.auditEvent.findMany({where:{organisationId:scope.organisationId,entityType:"Lead",entityId:{in:leads.map(l=>l.id)},action:{in:["public_lead.created","lead.attribution.captured"]}},take:REPORT_SOURCE_LIMIT+1,select:{entityId:true,facilityId:true,after:true}})) : [];
    const campaignIds = [...new Set(events.flatMap(e=>{const p=leadAttributionSchema.safeParse((e.after as {attribution?:unknown}|null)?.attribution);return p.success&&p.data.campaignId?[p.data.campaignId]:[];}))];
    const campaigns = campaignIds.length ? await tx.marketingCampaign.findMany({where:{id:{in:campaignIds},organisationId:scope.organisationId,facility},select:{id:true,facilityId:true,name:true}}) : [];
    const indexed = new Map(campaigns.map(c=>[c.id,c]));
    const evidence: CohortAttribution[] = events.flatMap(e=>{
      const attribution=(e.after as {attribution?:unknown}|null)?.attribution;
      if(attribution===undefined)return [];
      const parsed=leadAttributionSchema.safeParse(attribution);
      return [{leadId:e.entityId,facilityId:e.facilityId,attribution,campaign:parsed.success&&parsed.data.campaignId?indexed.get(parsed.data.campaignId)??null:null}];
    });
    const ids = [...new Set(bookings.flatMap(r=>r.convertedTenancy?[r.convertedTenancy.accountId]:[]))];
    const outcomes = await collectionCohortOutcomes(tx,scope,ids,query.to);
    // Repeated links outside this date cohort must not disappear from deduplication.
    const links = ids.length ? bounded(await tx.reservation.findMany({where:{status:"CONVERTED",facility,convertedTenancy:{accountId:{in:ids}},leadId:{not:null}},take:REPORT_SOURCE_LIMIT+1,select:{convertedTenancy:{select:{accountId:true}}}})) : [];
    const counts=new Map<string,number>();for(const link of links)if(link.convertedTenancy)counts.set(link.convertedTenancy.accountId,(counts.get(link.convertedTenancy.accountId)??0)+1);
    return marketingPaymentCohortRows(leads.map(l=>({...l,facility:l.facility.name,bookings:(bookingsByLead.get(l.id)??[]).map(r=>({...r,tenancy:r.convertedTenancy,priceEvidence:prices.get(r.id)}))})),evidence,outcomes.map(o=>({...o,issue:(counts.get(o.accountId)??0)>1?"Account appears in multiple retained enquiry/booking links":o.issue})),query.to,query.metrics.some(m=>["originalMonthlyQuote","latestAcceptedQuote","netReceipts","overdue"].includes(m.field)));
  },{isolationLevel:"RepeatableRead",timeout:30000}); }
  catch(error){if(error instanceof Error&&error.message==="COLLECTION_DATE")throw new ReportError("REPORT_ASOF_FUTURE");if(error instanceof Error&&error.message==="COLLECTION_LIMIT")throw new ReportError("REPORT_LIMIT");throw error;}
}
