import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { leasingCustomerWhere } from "@/lib/leasing-service";
import { requireFacility, requirePermissionScope } from "@/lib/scope";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams; const facilityId = params.get("facilityId") || ""; const query = (params.get("q") || "").trim().slice(0,100);
    if (!facilityId || query.length < 2) return Response.json({data: []}, {headers: {"Cache-Control": "private, no-store"}});
    const scope = await requirePermissionScope("leads.create", facilityId); await requireFacility(scope, facilityId);
    const created = await db.auditEvent.findMany({where: {organisationId: scope.organisationId, actorId: scope.userId, entityType: "Customer", action: "customer.created"}, select: {entityId: true}});
    const data = await db.customer.findMany({where: {organisationId: scope.organisationId, AND: [
      {OR: [leasingCustomerWhere(scope, scope.facilityIds), {id: {in: created.map(c=>c.entityId)}, leads: {none: {}}, reservations: {none: {}}, tenancies: {none: {}}}]},
      {OR: ["firstName", "lastName", "companyName", "email", "phone"].map(key=>({[key]: {contains: query, mode: "insensitive"}}))}
    ]}, select: {id: true, firstName: true, lastName: true, companyName: true, email: true, phone: true}, take: 25, orderBy: {updatedAt: "desc"}});
    return Response.json({data}, {headers: {"Cache-Control": "private, no-store"}});
  } catch(error) {return apiError(error);}
}
