import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { RequestScope } from "@/lib/scope";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export function leasingCustomerWhere(
  scope: RequestScope,
  facilityIds: string[],
): Prisma.CustomerWhereInput {
  const organisation = { organisationId: scope.organisationId };
  if (scope.unrestrictedFacilities) return organisation;
  return {
    ...organisation,
    OR: [
      { leads: { some: { facilityId: { in: facilityIds } } } },
      { reservations: { some: { facilityId: { in: facilityIds } } } },
      { tenancies: { some: { facilityId: { in: facilityIds } } } },
    ],
  };
}

/** Linked customers follow facility scope. A new unlinked record remains usable
 * only by its creator until it is linked; organisation owners retain full access. */
export async function requireLeasingCustomer(scope: RequestScope, customerId: string, client: Tx = db) {
  const customer = await client.customer.findFirst({
    where: { id: customerId, ...leasingCustomerWhere(scope, scope.facilityIds) },
  });
  if (customer) return customer;
  if (!scope.unrestrictedFacilities) {
    const created = await client.auditEvent.findFirst({ where: {
      organisationId: scope.organisationId, actorId: scope.userId,
      entityType: "Customer", entityId: customerId, action: "customer.created",
    }, select: { id: true } });
    if (created) {
      const unlinked = await client.customer.findFirst({ where: {
        id: customerId, organisationId: scope.organisationId,
        leads: { none: {} }, reservations: { none: {} }, tenancies: { none: {} },
      } });
      if (unlinked) return unlinked;
    }
  }
  throw new Error("FORBIDDEN");
}
