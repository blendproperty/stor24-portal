import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import type { Prisma } from "@/generated/prisma/client";

/** Handover evidence is tied to both tenancy and facility, never just signature or status. */
export async function handoverKeys(scope: RequestScope, tenancyIds: string[]) {
  if (!tenancyIds.length) return new Set<string>();
  const ids = [...new Set(tenancyIds)];
  const keys = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const events = await db.auditEvent.findMany({
      where: { organisationId: scope.organisationId, entityType: "Tenancy", entityId: { in: ids.slice(offset, offset + 1000) }, action: "tenancy.key_handover_confirmed", ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) },
      select: { entityId: true, facilityId: true },
    });
    events.forEach(event => keys.add(`${event.facilityId}:${event.entityId}`));
  }
  return keys;
}

/** Use the first recorded handover so historical occupancy cannot start at signature. */
export async function handoverTimes(scope: RequestScope, tenancyIds: string[]) {
  const ids = [...new Set(tenancyIds)];
  const times = new Map<string, Date>();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const events = await db.auditEvent.findMany({
      where: { organisationId: scope.organisationId, entityType: "Tenancy", entityId: { in: ids.slice(offset, offset + 1000) }, action: "tenancy.key_handover_confirmed", ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) },
      select: { entityId: true, facilityId: true, occurredAt: true }, orderBy: { occurredAt: "asc" },
    });
    for (const event of events) { const key = `${event.facilityId}:${event.entityId}`; if (!times.has(key)) times.set(key, event.occurredAt); }
  }
  return times;
}

/** Explicit staff-selected legacy lead links, checked against the original customer and store. */
export async function legacyHandedOverLeadIds(scope:RequestScope,leads:{id:string;facilityId:string;customerId:string|null}[],database:Prisma.TransactionClient=db) {
  const result=new Set<string>();
  const eligible=leads.filter(l=>l.customerId && (scope.unrestrictedFacilities || scope.facilityIds.includes(l.facilityId)));
  for(let offset=0;offset<eligible.length;offset+=200){
    const batch=eligible.slice(offset,offset+200),byId=new Map(batch.map(l=>[l.id,l]));
    const events=await database.auditEvent.findMany({where:{organisationId:scope.organisationId,entityType:"Tenancy",action:"tenancy.key_handover_confirmed",facilityId:{in:[...new Set(batch.map(l=>l.facilityId))]},OR:batch.map(l=>({after:{path:["leadId"],equals:l.id}}))},select:{entityId:true,facilityId:true,after:true}});
    const ids=[...new Set(events.map(e=>e.entityId))];
    const tenancies=ids.length?await database.tenancy.findMany({where:{id:{in:ids},facility:{organisationId:scope.organisationId},customer:{organisationId:scope.organisationId}},select:{id:true,facilityId:true,customerId:true,account:{select:{customerId:true}}}}):[];
    const indexed=new Map(tenancies.map(t=>[t.id,t]));
    for(const event of events){const leadId=(event.after as {leadId?:unknown}|null)?.leadId;if(typeof leadId!=="string")continue;const lead=byId.get(leadId),tenancy=indexed.get(event.entityId);if(lead&&tenancy&&event.facilityId===lead.facilityId&&tenancy.facilityId===lead.facilityId&&tenancy.customerId===lead.customerId&&tenancy.account.customerId===lead.customerId)result.add(lead.id);}
  }
  return result;
}
