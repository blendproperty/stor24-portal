import { db } from "@/lib/db";
import { leasingCustomerWhere } from "@/lib/leasing-service";
import type { RequestScope } from "@/lib/scope";

/** Unassigned historical messages still require a visible customer relationship. */
export function listCommunicationLogs(scope: RequestScope) {
  return db.communicationLog.findMany({
    where: {
      organisationId: scope.organisationId,
      channel: { in: ["EMAIL", "SMS", "WHATSAPP"] },
      ...(scope.unrestrictedFacilities ? {} : { OR: [
        { facilityId: { in: scope.facilityIds } },
        { facilityId: null, customer: leasingCustomerWhere(scope, scope.facilityIds) },
      ] }),
    },
    include: { customer: { select: { firstName: true, lastName: true, companyName: true } }, facility: { select: { name: true } } },
    orderBy: { queuedAt: "desc" }, take: 100,
  });
}
