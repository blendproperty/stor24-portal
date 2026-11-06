import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";

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
