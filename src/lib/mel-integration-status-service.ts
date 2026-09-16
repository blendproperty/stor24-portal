import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";

/**
 * Read-only queries backing the Stage 6 MEL/HikCentral integration status
 * panel (see docs/MEL_INTEGRATION_STATUS_2026-09-15.md). This module has no
 * write path: nothing here creates, updates or deletes an
 * IntegrationIdentityLink or AccessDecision row. Those rows are only ever
 * created by src/lib/access-decision-service.ts (not yet wired into any live
 * caller) and by whatever future identity-linking flow lands with a real MEL
 * provider agreement. Until then, both queries below will typically return
 * empty results — that is expected and is surfaced honestly in the UI rather
 * than implied to be a fault.
 */

export async function listIdentityLinks(scope: RequestScope) {
  return db.integrationIdentityLink.findMany({
    where: { organisationId: scope.organisationId },
    include: { customer: true, resolvedBy: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export async function listAccessDecisions(scope: RequestScope) {
  return db.accessDecision.findMany({
    where: {
      organisationId: scope.organisationId,
      ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }),
    },
    include: {
      facility: true,
      occupancy: { include: { unit: true, tenancy: { include: { customer: true } } } },
      requestedBy: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
