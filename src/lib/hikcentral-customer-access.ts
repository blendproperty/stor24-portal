import { db } from "@/lib/db";
import { HikCentralAccessProvider } from "@/lib/integrations/hikcentral-provider";
import { BLOCK24_FACE_DOORS, MIDPOINT_NON_TENANT_DOORS, STOR24_FACE_DOORS } from "@/lib/integrations/hikcentral-door-scope";
import { HIKCENTRAL_CATEGORY, HIKCENTRAL_PROVIDER, loadHikCentralRuntimeConfiguration } from "@/lib/integrations/hikcentral-configuration";
import { requireFacility, type RequestScope } from "@/lib/scope";
import { requireLeasingCustomer } from "@/lib/leasing-customer-scope";
import { verifiedArrearsAccessReview } from "@/lib/collections-service";
import { hikCentralOvernightWindow } from "@/lib/hikcentral-overnight-window";
import { hikCentralLockPolicy, hikCentralLockPolicyHash } from "@/lib/hikcentral-lock-policy";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { sendHikCentralLockedNotice, sendHikCentralLockWarning } from "@/lib/hikcentral-lock-notifications";

export async function customerFaceAccessReadiness(scope: RequestScope, customerId: string, facilityId: string, now = new Date()) {
  await requireFacility(scope, facilityId);
  await requireLeasingCustomer(scope, customerId);
  const customer = await db.customer.findFirst({ where: { id: customerId, organisationId: scope.organisationId }, select: { id: true, accessCompanyId: true } });
  if (!customer) throw Error("NOT_FOUND");
  const [link, photo, tenancies, approval, manualLock, mapping, grants] = await Promise.all([
    db.integrationIdentityLink.findUnique({ where: { customerId } }),
    db.hikCentralFaceCapture.findUnique({ where: { customerId } }),
    db.tenancy.findMany({ where: { customerId: customer.accessCompanyId ?? customerId, facilityId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, occupancies: { some: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, accessState: { not: "REVOKED" } } } }, select: { id: true, accountId: true, occupancies: { where: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] }, accessState: { not: "REVOKED" } }, select: { id: true } } } }),
    db.hikCentralAccessApproval.findUnique({ where: { customerId_facilityId: { customerId, facilityId } } }),
    db.hikCentralAccessLock.findUnique({ where: { customerId_facilityId: { customerId, facilityId } } }),
    db.integrationConnection.findFirst({ where: { organisationId: scope.organisationId, facilityId, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER } }),
    db.hikCentralAccessGrant.findMany({ where: { organisationId: scope.organisationId, facilityId, customerId } }),
  ]);
  const handovers = tenancies.length ? await db.auditEvent.findMany({ where: { organisationId: scope.organisationId, facilityId, entityType: "Tenancy", action: "tenancy.key_handover_confirmed", entityId: { in: tenancies.map(item => item.id) } }, select: { entityId: true } }) : [];
  const handedOver = new Set(handovers.map(item => item.entityId));
  const approvedVisit = !!approval && !!photo && !approval.revokedAt && approval.expiresAt > now && approval.photoId === photo.id && approval.photoVersion === photo.version && ["WAITING_REVIEW", "PROVIDER_ACCEPTED"].includes(photo.status);
  const manuallyLocked = !!manualLock && !manualLock.unlockedAt;
  let activeTenancy = false;
  for (const tenancy of tenancies) {
    if (!handedOver.has(tenancy.id)) continue;
    const decisions = await db.accessDecision.findMany({ where: { occupancyId: { in: tenancy.occupancies.map(item => item.id) }, state: "CONFIRMED" }, orderBy: { createdAt: "desc" }, select: { occupancyId: true, action: true } });
    const latest = new Map<string, string>();
    for (const decision of decisions) if (!latest.has(decision.occupancyId)) latest.set(decision.occupancyId, decision.action);
    if (tenancy.occupancies.some(item => !["SUSPEND", "REVOKE"].includes(latest.get(item.id) ?? ""))) activeTenancy = true;
  }
  const lockPolicy = await hikCentralLockPolicy(scope.organisationId, facilityId);
  let arrearsLocked = false, arrearsNoticePending = false, financialEvidenceUnavailable = false, paymentCleared = true, financialLockSourceChargeId: string | null = null;
  const warningCandidates: { accountId: string; sourceChargeId: string; reviewOn: string }[] = [];
  for (const tenancy of tenancies) {
    if (!handedOver.has(tenancy.id)) continue;
    try {
      const review = await verifiedArrearsAccessReview(scope, tenancy.accountId, southAfricaDateKey(now));
      if (!review.paymentCleared && review.sourceChargeId && review.reviewOn && review.blockers.every(item => item.startsWith("Seven calendar days have not elapsed"))) warningCandidates.push({ accountId: tenancy.accountId, sourceChargeId: review.sourceChargeId, reviewOn: review.reviewOn });
      if (review.eligible) {
        const notices = await db.communicationLog.findMany({ where: { organisationId: scope.organisationId, facilityId, customerId: customer.accessCompanyId ?? customerId, messageType: "FACE_ACCESS_LOCK_WARNING", status: "SUCCEEDED", deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" }, take: 10, select: { metadata: true, deliveredAt: true } });
        const noticeReady = !!lockPolicy && notices.some(notice => { const evidence = notice.metadata as { sourceChargeId?: unknown; approvalReference?: unknown; policyHash?: unknown } | null; return evidence?.sourceChargeId === review.sourceChargeId && evidence.approvalReference === lockPolicy.approvalReference && evidence.policyHash === hikCentralLockPolicyHash(lockPolicy) && !!notice.deliveredAt && notice.deliveredAt.getTime() <= now.getTime() - lockPolicy.noticeHours * 60 * 60_000; });
        if (noticeReady) { arrearsLocked = true; financialLockSourceChargeId = review.sourceChargeId; } else arrearsNoticePending = true;
      }
      if (!review.paymentCleared) paymentCleared = false;
    }
    catch { financialEvidenceUnavailable = true; paymentCleared = false; }
  }
  const config = (mapping?.config ?? {}) as { organisationIndexCode?: unknown; doorIndexCodes?: unknown; accessLevelIds?: unknown; nightlyClearanceRequired?: unknown };
  const mappedDoors = Array.isArray(config.doorIndexCodes) ? config.doorIndexCodes : [];
  const mapped = config.organisationIndexCode === "97" && config.nightlyClearanceRequired === true && mappedDoors.length === STOR24_FACE_DOORS.length && STOR24_FACE_DOORS.every(id => mappedDoors.includes(id)) && Array.isArray(config.accessLevelIds) && config.accessLevelIds.length === 2;
  const blockers = [
    !link?.hikCentralPersonId || link.status !== "ACTIVE" ? "HikCentral person is not linked" : null,
    photo?.status !== "PROVIDER_ACCEPTED" || photo.personId !== link?.hikCentralPersonId ? "Face is not confirmed in HikCentral" : null,
    !activeTenancy && !approvedVisit ? "No active handed-over tenancy or current manager-approved visit" : null,
    arrearsLocked ? "Verified charge remains unpaid seven days after the due date" : null,
    arrearsNoticePending ? "Seven-day arrears review is due, but an approved lockout warning has not been delivered and linked to the charge" : null,
    manuallyLocked ? "Manager has locked facial entry for this customer" : null,
    financialEvidenceUnavailable ? "Payment evidence could not be checked" : null,
    !mapped ? "Block24 and Midpoint non-tenant readers or nightly site clearance are not fully configured" : null,
  ].filter((value): value is string => Boolean(value));
  return { eligible: blockers.length === 0, accessClearance: (activeTenancy || approvedVisit) && !arrearsLocked && !manuallyLocked, approvalExpiresAt: approvedVisit ? approval.expiresAt : null, syntheticTestActive: approvedVisit && approval.reason.startsWith("Synthetic API assignment test:"), arrearsLocked, arrearsNoticePending, financialLockSourceChargeId, warningCandidates, billingCustomerId: customer.accessCompanyId ?? customerId, manuallyLocked, accessLocked: arrearsLocked || manuallyLocked, restorationReady: activeTenancy && paymentCleared && !financialEvidenceUnavailable && !manuallyLocked, blockers, personId: link?.hikCentralPersonId ?? null, grants, mapping: mapped ? { accessLevelIds: config.accessLevelIds as string[], doorIndexCodes: config.doorIndexCodes as string[] } : null };
}

export async function hikCentralSiteClearance(scope: RequestScope, facilityId: string, now = new Date()) {
  await requireFacility(scope, facilityId);
  const window = hikCentralOvernightWindow(now);
  if (!window) return { confirmed: false, window: null };
  const event = await db.auditEvent.findFirst({ where: { organisationId: scope.organisationId, facilityId, action: "hikcentral_face.site_empty_confirmed", entityType: "Facility", entityId: facilityId, actorId: { not: null }, occurredAt: { gte: new Date(Math.max(window.start.getTime(), now.getTime() - 10 * 60_000)), lte: now } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  return { confirmed: !!event, window, confirmedAt: event?.occurredAt ?? null };
}

export async function confirmHikCentralSiteEmpty(scope: RequestScope, facilityId: string, now = new Date()) {
  const state = await hikCentralSiteClearance(scope, facilityId, now);
  if (!scope.userId || !state.window) throw Error("HIKCENTRAL_SITE_CLEARANCE_CLOSED");
  if (state.confirmed) return state;
  const event = await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "hikcentral_face.site_empty_confirmed", entityType: "Facility", entityId: facilityId, after: { date: state.window.date, end: state.window.end.toISOString() }, occurredAt: now } });
  return { ...state, confirmed: true, confirmedAt: event.occurredAt };
}

export async function setCustomerFaceManualLock(scope: RequestScope, customerId: string, facilityId: string, locked: boolean, reason: string, now = new Date()) {
  await requireFacility(scope, facilityId);
  await requireLeasingCustomer(scope, customerId);
  if (!scope.userId || reason.trim().length < 8 || reason.trim().length > 200) throw Error("HIKCENTRAL_LOCK_REASON_REQUIRED");
  const current = await db.hikCentralAccessLock.findUnique({ where: { customerId_facilityId: { customerId, facilityId } } });
  if (locked) {
    await db.hikCentralAccessLock.upsert({ where: { customerId_facilityId: { customerId, facilityId } }, create: { organisationId: scope.organisationId, facilityId, customerId, lockedAt: new Date(), lockedById: scope.userId, reason: reason.trim() }, update: { lockedAt: new Date(), lockedById: scope.userId, unlockedAt: null, unlockedById: null, reason: reason.trim() } });
  } else {
    if (!current || current.unlockedAt) throw Error("HIKCENTRAL_LOCK_NOT_ACTIVE");
    await db.hikCentralAccessLock.update({ where: { id: current.id }, data: { unlockedAt: new Date(), unlockedById: scope.userId } });
  }
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: locked ? "hikcentral_face.manager_locked" : "hikcentral_face.manager_unlocked", entityType: "Customer", entityId: customerId, after: { reason: reason.trim() } } });
  return reconcileCustomerFaceAccess(scope, customerId, facilityId, now);
}

export async function approveCustomerFaceVisit(scope: RequestScope, customerId: string, facilityId: string, photoMatchesId: boolean, syntheticTest?: { expectedPersonId: string; reason: string }) {
  await requireFacility(scope, facilityId);
  await requireLeasingCustomer(scope, customerId);
  if (!scope.userId || (!photoMatchesId && !syntheticTest) || await db.tenancy.count({ where: { customerId } })) throw Error("HIKCENTRAL_VISIT_NOT_READY");
  const photo = await db.hikCentralFaceCapture.findUnique({ where: { customerId } });
  if (!photo || photo.facilityId !== facilityId || !(syntheticTest ? photo.status === "PROVIDER_ACCEPTED" : photo.status === "WAITING_REVIEW" ? photo.expiresAt > new Date() : photo.status === "PROVIDER_ACCEPTED" && photo.providerAcceptedAt && photo.providerAcceptedAt > new Date(Date.now() - 2 * 60 * 60_000))) throw Error("HIKCENTRAL_VISIT_NOT_READY");
  if (syntheticTest) {
    const link = await db.integrationIdentityLink.findUnique({ where: { customerId } });
    const readiness = await customerFaceAccessReadiness(scope, customerId, facilityId);
    if (!scope.unrestrictedFacilities || photo.status !== "PROVIDER_ACCEPTED" || !syntheticTest.expectedPersonId || syntheticTest.expectedPersonId !== photo.personId || link?.hikCentralPersonId !== photo.personId || link.status !== "ACTIVE" || syntheticTest.reason.trim().length < 8 || syntheticTest.reason.trim().length > 200 || readiness.grants.some(item => item.status !== "REVOKED") || readiness.blockers.some(item => item !== "No active handed-over tenancy or current manager-approved visit")) throw Error("HIKCENTRAL_TEST_GRANT_NOT_READY");
  }
  const preview = await db.auditEvent.findFirst({ where: { organisationId: scope.organisationId, ...(!syntheticTest ? { actorId: scope.userId } : {}), entityType: "HikCentralFaceCapture", entityId: photo.id, action: "hikcentral_face.previewed", after: { path: ["version"], equals: photo.version } } });
  if (!preview) throw Error("PHOTO_PREVIEW_REQUIRED");
  const existing = await db.hikCentralAccessApproval.findUnique({ where: { customerId_facilityId: { customerId, facilityId } } });
  if (existing && !existing.revokedAt && existing.expiresAt > new Date()) throw Error("HIKCENTRAL_VISIT_ALREADY_APPROVED");
  // shortcut: the approval table requires an expiry; synthetic grants use a distant sentinel until manually revoked.
  const expiresAt = syntheticTest ? new Date("9999-12-31T23:59:59.000Z") : new Date(Date.now() + 120 * 60_000);
  const reason = syntheticTest ? `Synthetic API assignment test: ${syntheticTest.reason.trim()}` : "Supervised customer face-reader visit";
  const approval = await db.hikCentralAccessApproval.upsert({ where: { customerId_facilityId: { customerId, facilityId } }, create: { organisationId: scope.organisationId, facilityId, customerId, approvedById: scope.userId, reason, photoId: photo.id, photoVersion: photo.version, expiresAt }, update: { approvedById: scope.userId, reason, photoId: photo.id, photoVersion: photo.version, expiresAt, revokedAt: null } });
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: syntheticTest ? "hikcentral_face.synthetic_test_approved" : "hikcentral_face.visit_approved", entityType: "HikCentralAccessApproval", entityId: approval.id, after: { customerId, photoId: photo.id, photoVersion: photo.version, expiresAt: expiresAt.toISOString(), ...(syntheticTest ? { personId: syntheticTest.expectedPersonId, reason: syntheticTest.reason.trim() } : {}) } } });
  if (photo.status === "PROVIDER_ACCEPTED") await reconcileCustomerFaceAccess(scope, customerId, facilityId);
  return { expiresAt };
}

export async function revokeCustomerFaceVisit(scope: RequestScope, customerId: string, facilityId: string, now = new Date()) {
  await requireFacility(scope, facilityId);
  await requireLeasingCustomer(scope, customerId);
  const approval = await db.hikCentralAccessApproval.findUnique({ where: { customerId_facilityId: { customerId, facilityId } } });
  if (!approval || approval.revokedAt) throw Error("HIKCENTRAL_VISIT_NOT_READY");
  await db.hikCentralAccessApproval.update({ where: { id: approval.id }, data: { revokedAt: new Date() } });
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "hikcentral_face.visit_revoked", entityType: "HikCentralAccessApproval", entityId: approval.id, after: { customerId } } });
  return reconcileCustomerFaceAccess(scope, customerId, facilityId, now);
}

export function assertExactFaceAccessLevels(all: { id: string; name: string; resourceIds: string[] }[], ids: string[], expected: string[]) {
  const levels = ids.map(id => all.find(level => level.id === id));
  if (levels.some(level => !level)) throw Error("HIKCENTRAL_ACCESS_LEVEL_MISSING");
  const block24 = levels.find(level => level?.name === "Block24");
  if (!block24 || block24.resourceIds.length !== BLOCK24_FACE_DOORS.length || !block24.resourceIds.every(id => BLOCK24_FACE_DOORS.includes(id))) throw Error("HIKCENTRAL_BLOCK24_SCOPE_CHANGED");
  const midpoint = levels.find(level => level?.name === "DRIVERS");
  if (!midpoint || midpoint.resourceIds.length !== MIDPOINT_NON_TENANT_DOORS.length || !midpoint.resourceIds.every(id => MIDPOINT_NON_TENANT_DOORS.includes(id))) throw Error("HIKCENTRAL_MIDPOINT_SCOPE_CHANGED");
  const union = levels.flatMap(level => level!.resourceIds);
  if (new Set(union).size !== STOR24_FACE_DOORS.length || new Set(expected).size !== STOR24_FACE_DOORS.length || union.some(id => !expected.includes(id)) || !STOR24_FACE_DOORS.every(id => expected.includes(id))) throw Error("HIKCENTRAL_ACCESS_SCOPE_MISMATCH");
  return levels.map(level => level!);
}

async function verifiedLevels(provider: HikCentralAccessProvider, ids: string[], expected: string[]) {
  const result = await provider.listAccessLevels();
  if (!result.ok) throw Error("HIKCENTRAL_ACCESS_LEVEL_LOOKUP_FAILED");
  return assertExactFaceAccessLevels(result.data.levels, ids, expected);
}

/** Reconciles only grants created by STOR24; an existing manual membership is never claimed or removed. */
export async function reconcileCustomerFaceAccess(scope: RequestScope, customerId: string, facilityId: string, now = new Date()) {
  const readiness = await customerFaceAccessReadiness(scope, customerId, facilityId, now);
  const owned = readiness.grants.filter(grant => !["EXTERNAL", "REVOKED", "LOCKED"].includes(grant.status));
  if (!readiness.eligible && (!owned.length || readiness.accessClearance)) return { status: "NOT_ELIGIBLE", blockers: readiness.blockers };
  const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId));
  if (!readiness.eligible) {
    const clearance = await hikCentralSiteClearance(scope, facilityId, now);
    if (!clearance.confirmed) return { status: "DEFERRED", blockers: ["Face access remains active until staff confirm Block24 empty during the 19:00–07:00 SAST lockout window"] };
    for (const grant of owned) {
      await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: "REVOKE_PENDING" } });
      const result = await provider.removePersonFromAccessLevel(grant.accessLevelId, grant.personId);
      const membership = result.ok ? await provider.accessLevelHasPerson(grant.accessLevelId, grant.personId) : null;
      if (!result.ok || !membership?.ok || membership.data.member) {
        await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: "REVIEW_REQUIRED", lastError: "Revocation could not be confirmed" } });
        throw Error("HIKCENTRAL_REVOCATION_UNCONFIRMED");
      }
      await db.hikCentralAccessGrant.update({ where: { id: grant.id }, data: { status: readiness.accessLocked ? "LOCKED" : "REVOKED", revokedAt: new Date(), lastError: null } });
      await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId || null, action: "hikcentral_face.access_revoked", entityType: "HikCentralAccessGrant", entityId: grant.id, after: { customerId, personId: grant.personId, accessLevelId: grant.accessLevelId } } });
    }
    if (readiness.arrearsLocked && readiness.financialLockSourceChargeId) {
      let notified = false;
      try { notified = await sendHikCentralLockedNotice(scope, readiness.billingCustomerId, facilityId, readiness.financialLockSourceChargeId); } catch { /* A failed notice cannot undo a confirmed provider revocation. */ }
      if (!notified) await db.task.create({ data: { organisationId: scope.organisationId, facilityId, customerId: readiness.billingCustomerId, title: "Face lock notice needs delivery review", description: "HikCentral access was removed, but the customer lock notice was not confirmed. Review the communication log and contact the customer through an approved channel.", priority: "HIGH" } });
    }
    return { status: readiness.accessLocked ? "LOCKED" : "REVOKED", blockers: readiness.blockers };
  }
  const levels = await verifiedLevels(provider, readiness.mapping!.accessLevelIds, readiness.mapping!.doorIndexCodes);
  const person = await provider.personById(readiness.personId!);
  if (!person.ok || person.data.personId !== readiness.personId) throw Error("HIKCENTRAL_PERSON_LOOKUP_FAILED");
  let external = false;
  for (const level of levels) {
    const existing = readiness.grants.find(grant => grant.accessLevelId === level.id);
    if (existing && ["REVIEW_REQUIRED", "REVOKE_PENDING", "PENDING"].includes(existing.status) || existing && existing.personId !== readiness.personId) throw Error("HIKCENTRAL_GRANT_REVIEW_REQUIRED");
    const membership = await provider.accessLevelHasPerson(level.id, readiness.personId!);
    if (!membership.ok) throw Error("HIKCENTRAL_MEMBERSHIP_UNCONFIRMED");
    if (membership.data.member) {
      if (existing?.status === "REVOKED" || existing?.status === "LOCKED") throw Error("HIKCENTRAL_GRANT_REVIEW_REQUIRED");
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

/** A company handover or move-out changes eligibility for each of its named people. */
export async function reconcileCustomerAndCompanyPeople(scope: RequestScope, customerId: string, facilityId: string) {
  const people = await db.customer.findMany({ where: { accessCompanyId: customerId, organisationId: scope.organisationId }, select: { id: true } });
  const results = await Promise.allSettled([customerId, ...people.map(person => person.id)].map(id => reconcileCustomerFaceAccess(scope, id, facilityId)));
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

export async function approveCustomerFaceAccessRestoration(scope: RequestScope, customerId: string, facilityId: string) {
  const readiness = await customerFaceAccessReadiness(scope, customerId, facilityId);
  if (!readiness.eligible || !readiness.restorationReady || readiness.grants.filter(item => item.status === "LOCKED").length !== 2) throw Error("HIKCENTRAL_RESTORATION_NOT_READY");
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "hikcentral_face.access_restoration_approved", entityType: "Customer", entityId: customerId, after: { customerId, previousStatus: "LOCKED", financialEvidenceRechecked: true } } });
  return reconcileCustomerFaceAccess(scope, customerId, facilityId);
}

/** Called by the existing private five-minute photo worker; never creates a grant. */
export async function processHikCentralAccessLocks(now = new Date()) {
  // shortcut: inspect 50 grant rows per tick; partition the scan if enrolment grows beyond the pilot scale.
  const rows = await db.hikCentralAccessGrant.findMany({ where: { status: { in: ["GRANTED", "LOCKED"] } }, orderBy: [{ lastCheckedAt: "asc" }, { id: "asc" }], take: 50, select: { organisationId: true, facilityId: true, customerId: true } });
  const seen = new Set<string>();
  let locked = 0, revoked = 0, restored = 0, failed = 0;
  for (const row of rows) {
    const key = `${row.customerId}:${row.facilityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scope: RequestScope = { userId: "", organisationId: row.organisationId, facilityIds: [], unrestrictedFacilities: true };
    try {
      const readiness = await customerFaceAccessReadiness(scope, row.customerId, row.facilityId, now);
      if (readiness.syntheticTestActive) continue;
      for (const candidate of readiness.warningCandidates) await sendHikCentralLockWarning(scope, readiness.billingCustomerId, row.facilityId, candidate, now);
      if (readiness.accessLocked || !readiness.accessClearance) {
        const result = await reconcileCustomerFaceAccess(scope, row.customerId, row.facilityId, now);
        if (result.status === "LOCKED") locked++;
        if (result.status === "REVOKED") revoked++;
      } else if (readiness.eligible && readiness.restorationReady && readiness.grants.some(item => item.status === "LOCKED")) {
        const result = await reconcileCustomerFaceAccess(scope, row.customerId, row.facilityId);
        if (result.status === "GRANTED") restored++;
      }
    } catch (error) {
      failed++;
      await db.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, action: "hikcentral_face.access_worker_failed", entityType: "Customer", entityId: row.customerId, after: { code: error instanceof Error ? error.message : "UNKNOWN" } } });
    } finally {
      await db.hikCentralAccessGrant.updateMany({ where: { customerId: row.customerId, facilityId: row.facilityId, status: { in: ["GRANTED", "LOCKED"] } }, data: { lastCheckedAt: new Date() } });
    }
  }
  return { checked: seen.size, locked, revoked, restored, failed };
}
