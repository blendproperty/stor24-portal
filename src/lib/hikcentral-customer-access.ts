import { db } from "@/lib/db";
import { HikCentralAccessProvider } from "@/lib/integrations/hikcentral-provider";
import { HIKCENTRAL_CATEGORY, HIKCENTRAL_PROVIDER, loadHikCentralRuntimeConfiguration } from "@/lib/integrations/hikcentral-configuration";
import { requireFacility, type RequestScope } from "@/lib/scope";
import { requireLeasingCustomer } from "@/lib/leasing-customer-scope";
import { verifiedArrearsAccessReview } from "@/lib/collections-service";

const BLOCK24_DOORS = new Set(["1239", "1244", "1249"]);

export async function customerFaceAccessReadiness(scope: RequestScope, customerId: string, facilityId: string) {
  await requireFacility(scope, facilityId);
  await requireLeasingCustomer(scope, customerId);
  const [customer, link, photo, tenancies, mapping, grants] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, organisationId: scope.organisationId }, select: { id: true } }),
    db.integrationIdentityLink.findUnique({ where: { customerId } }),
    db.hikCentralFaceCapture.findUnique({ where: { customerId } }),
    db.tenancy.findMany({ where: { customerId, facilityId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, occupancies: { some: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, accessState: { not: "REVOKED" } } } }, select: { id: true, accountId: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, accessState: { not: "REVOKED" } }, select: { id: true } } } }),
    db.integrationConnection.findFirst({ where: { organisationId: scope.organisationId, facilityId, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER } }),
    db.hikCentralAccessGrant.findMany({ where: { organisationId: scope.organisationId, facilityId, customerId } }),
  ]);
  if (!customer) throw Error("NOT_FOUND");
  const handovers = tenancies.length ? await db.auditEvent.findMany({ where: { organisationId: scope.organisationId, facilityId, entityType: "Tenancy", action: "tenancy.key_handover_confirmed", entityId: { in: tenancies.map(item => item.id) } }, select: { entityId: true } }) : [];
  const handedOver = new Set(handovers.map(item => item.entityId));
  let activeTenancy = false;
  for (const tenancy of tenancies) {
    if (!handedOver.has(tenancy.id)) continue;
    const decisions = await db.accessDecision.findMany({ where: { occupancyId: { in: tenancy.occupancies.map(item => item.id) }, state: "CONFIRMED" }, orderBy: { createdAt: "desc" }, select: { occupancyId: true, action: true } });
    const latest = new Map<string, string>();
    for (const decision of decisions) if (!latest.has(decision.occupancyId)) latest.set(decision.occupancyId, decision.action);
    if (tenancy.occupancies.some(item => !["SUSPEND", "REVOKE"].includes(latest.get(item.id) ?? ""))) activeTenancy = true;
  }
  let arrearsLocked = false, financialEvidenceUnavailable = false, paymentCleared = true;
  for (const tenancy of tenancies) {
    if (!handedOver.has(tenancy.id)) continue;
    try { const review = await verifiedArrearsAccessReview(scope, tenancy.accountId); if (review.eligible) arrearsLocked = true; if (!review.paymentCleared) paymentCleared = false; }
    catch { financialEvidenceUnavailable = true; paymentCleared = false; }
  }
  const config = (mapping?.config ?? {}) as { organisationIndexCode?: unknown; doorIndexCodes?: unknown; accessLevelIds?: unknown; freeEgressConfirmed?: unknown };
  const mapped = config.organisationIndexCode === "97" && config.freeEgressConfirmed === true && Array.isArray(config.doorIndexCodes) && config.doorIndexCodes.length === 5 && Array.isArray(config.accessLevelIds) && config.accessLevelIds.length === 2;
  const blockers = [
    !link?.hikCentralPersonId || link.status !== "ACTIVE" ? "HikCentral person is not linked" : null,
    photo?.status !== "PROVIDER_ACCEPTED" || photo.personId !== link?.hikCentralPersonId ? "Face is not confirmed in HikCentral" : null,
    !activeTenancy ? "No active, handed-over tenancy with access clearance" : null,
    arrearsLocked ? "Verified charge remains unpaid seven days after the due date" : null,
    financialEvidenceUnavailable ? "Payment evidence could not be checked" : null,
    !mapped ? "Block24 and Midpoint visitor face readers or free exit are not fully confirmed" : null,
  ].filter((value): value is string => Boolean(value));
  return { eligible: blockers.length === 0, accessClearance: activeTenancy && !arrearsLocked, arrearsLocked, restorationReady: activeTenancy && paymentCleared && !financialEvidenceUnavailable, freeEgressConfirmed: config.freeEgressConfirmed === true, blockers, personId: link?.hikCentralPersonId ?? null, grants, mapping: mapped ? { accessLevelIds: config.accessLevelIds as string[], doorIndexCodes: config.doorIndexCodes as string[] } : null };
}

export function assertExactFaceAccessLevels(all: { id: string; name: string; resourceIds: string[] }[], ids: string[], expected: string[]) {
  const levels = ids.map(id => all.find(level => level.id === id));
  if (levels.some(level => !level)) throw Error("HIKCENTRAL_ACCESS_LEVEL_MISSING");
  const block24 = levels.find(level => level?.name === "Block24");
  if (!block24 || block24.resourceIds.length !== 3 || !block24.resourceIds.every(id => BLOCK24_DOORS.has(id))) throw Error("HIKCENTRAL_BLOCK24_SCOPE_CHANGED");
  const union = levels.flatMap(level => level!.resourceIds);
  if (new Set(union).size !== 5 || new Set(expected).size !== 5 || union.some(id => !expected.includes(id)) || ![...BLOCK24_DOORS].every(id => expected.includes(id))) throw Error("HIKCENTRAL_ACCESS_SCOPE_MISMATCH");
  return levels.map(level => level!);
}

async function verifiedLevels(provider: HikCentralAccessProvider, ids: string[], expected: string[]) {
  const result = await provider.listAccessLevels();
  if (!result.ok) throw Error("HIKCENTRAL_ACCESS_LEVEL_LOOKUP_FAILED");
  return assertExactFaceAccessLevels(result.data.levels, ids, expected);
}

/** Reconciles only grants created by STOR24; an existing manual membership is never claimed or removed. */
export async function reconcileCustomerFaceAccess(scope: RequestScope, customerId: string, facilityId: string) {
  const readiness = await customerFaceAccessReadiness(scope, customerId, facilityId);
  const owned = readiness.grants.filter(grant => !["EXTERNAL", "REVOKED", "LOCKED"].includes(grant.status));
  if (!readiness.eligible && (!owned.length || readiness.accessClearance)) return { status: "NOT_ELIGIBLE", blockers: readiness.blockers };
  const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId));
  if (!readiness.eligible) {
    if (!readiness.freeEgressConfirmed) throw Error("HIKCENTRAL_FREE_EXIT_UNCONFIRMED");
    for (const grant of owned) {
      await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: "REVOKE_PENDING" } });
      const result = await provider.removePersonFromAccessLevel(grant.accessLevelId, grant.personId);
      const membership = result.ok ? await provider.accessLevelHasPerson(grant.accessLevelId, grant.personId) : null;
      if (!result.ok || !membership?.ok || membership.data.member) {
        await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: "REVIEW_REQUIRED", lastError: "Revocation could not be confirmed" } });
        throw Error("HIKCENTRAL_REVOCATION_UNCONFIRMED");
      }
      await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: readiness.arrearsLocked ? "LOCKED" : "REVOKED", revokedAt: new Date(), lastError: null } });
      await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId || null, action: "hikcentral_face.access_revoked", entityType: "HikCentralAccessGrant", entityId: grant.id, after: { customerId, personId: grant.personId, accessLevelId: grant.accessLevelId } } });
    }
    return { status: readiness.arrearsLocked ? "LOCKED" : "REVOKED", blockers: readiness.blockers };
  }
  const levels = await verifiedLevels(provider, readiness.mapping!.accessLevelIds, readiness.mapping!.doorIndexCodes);
  const person = await provider.personById(readiness.personId!);
  if (!person.ok || person.data.personId !== readiness.personId) throw Error("HIKCENTRAL_PERSON_LOOKUP_FAILED");
  let external = false;
  for (const level of levels) {
    const existing = readiness.grants.find(grant => grant.accessLevelId === level.id);
    if (existing && ["REVIEW_REQUIRED", "REVOKE_PENDING", "PENDING", "LOCKED"].includes(existing.status) || existing && existing.personId !== readiness.personId) throw Error("HIKCENTRAL_GRANT_REVIEW_REQUIRED");
    const membership = await provider.accessLevelHasPerson(level.id, readiness.personId!);
    if (!membership.ok) throw Error("HIKCENTRAL_MEMBERSHIP_UNCONFIRMED");
    if (membership.data.member) {
      if (existing?.status === "REVOKED") throw Error("HIKCENTRAL_GRANT_REVIEW_REQUIRED");
      if (!existing) await db.hikCentralAccessGrant.create({ data: { organisationId: scope.organisationId, facilityId, customerId, personId: readiness.personId!, accessLevelId: level.id, status: "EXTERNAL" } });
      if (!existing || existing.status === "EXTERNAL") external = true;
      continue;
    }
    if (existing?.status === "GRANTED" || existing?.status === "EXTERNAL") throw Error("HIKCENTRAL_GRANT_REVIEW_REQUIRED");
    const grant = existing ? await db.hikCentralAccessGrant.update({ where: { id: existing.id }, data: { status: "PENDING", lastError: null } }) : await db.hikCentralAccessGrant.create({ data: { organisationId: scope.organisationId, facilityId, customerId, personId: readiness.personId!, accessLevelId: level.id, status: "PENDING" } });
    const result = await provider.addPersonToAccessLevel(level.id, readiness.personId!);
    const confirmed = result.ok ? await provider.accessLevelHasPerson(level.id, readiness.personId!) : null;
    if (!result.ok || !confirmed?.ok || !confirmed.data.member) {
      await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: "REVIEW_REQUIRED", lastError: "Grant could not be confirmed" } });
      throw Error("HIKCENTRAL_GRANT_UNCONFIRMED");
    }
    await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: "GRANTED", grantedAt: new Date(), revokedAt: null } });
    await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId || null, action: "hikcentral_face.access_granted", entityType: "HikCentralAccessGrant", entityId: grant.id, after: { customerId, personId: readiness.personId, accessLevelId: level.id, doors: level.resourceIds, deviceApplied: false } } });
  }
  return { status: external ? "EXTERNAL" : "GRANTED", blockers: [] };
}

export async function approveCustomerFaceAccessRestoration(scope: RequestScope, customerId: string, facilityId: string) {
  const readiness = await customerFaceAccessReadiness(scope, customerId, facilityId);
  if (!readiness.eligible || !readiness.restorationReady || !readiness.freeEgressConfirmed || readiness.grants.filter(item => item.status === "LOCKED").length !== 2) throw Error("HIKCENTRAL_RESTORATION_NOT_READY");
  await db.hikCentralAccessGrant.updateMany({ where: { organisationId: scope.organisationId, facilityId, customerId, status: "LOCKED" }, data: { status: "REVOKED" } });
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "hikcentral_face.access_restoration_approved", entityType: "Customer", entityId: customerId, after: { customerId, previousStatus: "LOCKED", financialEvidenceRechecked: true } } });
  return reconcileCustomerFaceAccess(scope, customerId, facilityId);
}

/** Called by the existing private five-minute photo worker; never creates a grant. */
export async function processHikCentralAccessLocks() {
  // shortcut: inspect 50 grant rows per tick; partition the scan if enrolment grows beyond the pilot scale.
  const rows = await db.hikCentralAccessGrant.findMany({ where: { status: "GRANTED" }, orderBy: [{ lastCheckedAt: "asc" }, { id: "asc" }], take: 50, select: { organisationId: true, facilityId: true, customerId: true } });
  const seen = new Set<string>();
  let locked = 0, revoked = 0, failed = 0;
  for (const row of rows) {
    if (locked || revoked || failed) break;
    const key = `${row.customerId}:${row.facilityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scope: RequestScope = { userId: "", organisationId: row.organisationId, facilityIds: [], unrestrictedFacilities: true };
    try {
      const readiness = await customerFaceAccessReadiness(scope, row.customerId, row.facilityId);
      if (readiness.arrearsLocked || !readiness.accessClearance) {
        const result = await reconcileCustomerFaceAccess(scope, row.customerId, row.facilityId);
        if (result.status === "LOCKED") locked++;
        if (result.status === "REVOKED") revoked++;
      }
    } catch (error) {
      failed++;
      await db.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, action: "hikcentral_face.access_worker_failed", entityType: "Customer", entityId: row.customerId, after: { code: error instanceof Error ? error.message : "UNKNOWN" } } });
    } finally {
      await db.hikCentralAccessGrant.updateMany({ where: { customerId: row.customerId, facilityId: row.facilityId, status: "GRANTED" }, data: { lastCheckedAt: new Date() } });
    }
  }
  return { checked: seen.size, locked, revoked, failed };
}
