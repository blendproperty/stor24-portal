import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { currentRoleAccess } from "@/lib/current-role-access";
import { decryptPhoto, encryptPhoto, normaliseFacialPhoto } from "@/lib/facial-photo-security";
import { loadHikCentralRuntimeConfiguration } from "@/lib/integrations/hikcentral-configuration";
import { HikCentralAccessProvider } from "@/lib/integrations/hikcentral-provider";
import { integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import { requireLeasingCustomer } from "@/lib/leasing-customer-scope";
import { requireFacility, type RequestScope } from "@/lib/scope";
import { approveCustomerFaceVisit, customerFaceAccessReadiness, reconcileCustomerFaceAccess } from "@/lib/hikcentral-customer-access";

type Database = Prisma.TransactionClient;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const binding = (customerId: string, version: number) => `customer:${customerId}:hikcentral-face:${version}`;
export function hikCentralCustomerCode(organisationId: string, customerId: string) {
  const hash = createHash("sha256").update(`${organisationId}:${customerId}`).digest().subarray(0, 9).toString("hex");
  return `S24${BigInt(`0x${hash}`).toString(36).toUpperCase().padStart(13, "0").slice(-13)}`;
}
const policy = {
  version: "interim-hikcentral-face-20261118-v2",
  notice: "STOR24 will securely capture your facial photograph for your customer record. After staff check your identity and review the photo, an authorised operator can send it to HikCentral to create your person record or update your existing registered face. Updating an existing face may affect access already assigned to you. A successful upload does not prove that every reader has received or accepted the face, and no door permission is granted by this photo step. STOR24 deletes its live photo copy after HikCentral accepts it, or within 24 hours if it is not sent. Encrypted backups may keep a copy until their normal deletion cycle, which is still being confirmed. HikCentral and its readers may retain the face until staff separately remove it; this portal does not yet confirm provider or device erasure. You may decline and contact the facility manager about access. This interim notice awaits final policy review.",
  consentLabel: "I am the named person, I have read this notice, and I consent to my photograph being stored for staff review and sent to HikCentral to register or update my facial record.",
  alternativeContact: "For withdrawal, an access alternative, or provider deletion, contact bookings@stor24.co.za or the facility manager before proceeding.",
  retentionHours: 24,
  approvalReference: "Owner-authorised controlled field test; final policy review pending",
};
const policyHash = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
function handoffNotice(current: typeof policy, syntheticTestReason: string | null) {
  return syntheticTestReason ? { ...current, notice: `${current.notice} This is an authorised virtual-person access test. After staff review and HikCentral acceptance, STOR24 will assign the configured Block24 and Midpoint access levels automatically. The photograph is fictional and cannot verify physical face recognition.`, consentLabel: "I am the authorised test operator. This is a fictional photograph for a controlled live API access test; no real person's consent or identity is being claimed.", syntheticTestReason } : current;
}

async function currentPolicy(database: Database, organisationId: string) {
  const [control, maintenance] = await Promise.all([
    database.facialPhotoControl.findUnique({ where: { organisationId } }),
    database.facialPhotoMaintenance.findUnique({ where: { id: "expiry" } }),
  ]);
  if (!control?.enabled || !integrationEncryptionConfigured()) throw Error("PHOTO_POLICY_PENDING");
  if (!maintenance || maintenance.completedAt.getTime() < Date.now() - 90 * 60_000) throw Error("PHOTO_MAINTENANCE_REQUIRED");
  return { ...policy, hash: policyHash };
}

async function faceTarget(database: Database, scope: RequestScope, customerId: string) {
  const customer = await requireLeasingCustomer(scope, customerId, database);
  const link = await database.integrationIdentityLink.findUnique({ where: { customerId } });
  if (link && (link.organisationId !== scope.organisationId || ["DUPLICATE_SUSPECTED", "SUPERSEDED"].includes(link.status) || (link.hikCentralPersonId && link.status !== "ACTIVE"))) throw Error("HIKCENTRAL_PERSON_LINK_REQUIRED");
  if (!link?.hikCentralPersonId && (customer.type !== "INDIVIDUAL" || !customer.firstName?.trim() || !customer.lastName?.trim())) throw Error("HIKCENTRAL_PERSON_DETAILS_REQUIRED");
  return { customer, personId: link?.hikCentralPersonId ?? null };
}

function sameCustomerName(customer: { firstName: string | null; lastName: string | null }, snapshot: { firstNameSnapshot: string | null; lastNameSnapshot: string | null; personId: string | null }) {
  if (!snapshot.firstNameSnapshot && !snapshot.lastNameSnapshot) return !!snapshot.personId; // Legacy linked handoffs predate name snapshots.
  return customer.firstName?.trim() === snapshot.firstNameSnapshot && customer.lastName?.trim() === snapshot.lastNameSnapshot;
}

async function assertNoExistingCustomerCode(provider: HikCentralAccessProvider, organisationId: string, customerId: string) {
  const found = await provider.personByCode(hikCentralCustomerCode(organisationId, customerId));
  if (found.ok) throw Error("HIKCENTRAL_PERSON_REVIEW_REQUIRED");
  if (found.code !== "HIKCENTRAL_PERSON_NOT_FOUND") throw Error("HIKCENTRAL_PERSON_LOOKUP_FAILED");
}

async function lockCustomer(database: Database, customerId: string) {
  await database.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
}

export async function issueHikCentralFaceHandoff(scope: RequestScope, input: { facilityId: string; customerId: string; version: number; syntheticTest?: boolean; syntheticTestReason?: string }) {
  await requireFacility(scope, input.facilityId);
  if (input.syntheticTest && (!scope.unrestrictedFacilities || !input.syntheticTestReason || input.syntheticTestReason.trim().length < 8 || input.syntheticTestReason.trim().length > 200)) throw Error("HIKCENTRAL_TEST_GRANT_NOT_READY");
  if (input.syntheticTest) {
    const readiness = await customerFaceAccessReadiness(scope, input.customerId, input.facilityId);
    if (await db.tenancy.count({ where: { customerId: input.customerId } }) || !readiness.mapping || readiness.approvalExpiresAt || readiness.grants.some(grant => grant.status !== "REVOKED")) throw Error("HIKCENTRAL_TEST_GRANT_NOT_READY");
  }
  await currentPolicy(db, scope.organisationId);
  const { customer, personId } = await faceTarget(db, scope, input.customerId);
  if (customer.accessCompanyId && !await db.customer.findFirst({ where: { id: customer.accessCompanyId, organisationId: scope.organisationId, OR: [
    { leads: { some: { facilityId: input.facilityId } } }, { reservations: { some: { facilityId: input.facilityId } } }, { tenancies: { some: { facilityId: input.facilityId } } },
  ] }, select: { id: true } })) throw Error("FACILITY_FORBIDDEN");
  if (personId) {
    const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId));
    const verified = await provider.personById(personId);
    if (!verified.ok || (customer.lastName && verified.data.familyName && verified.data.familyName.trim().toLowerCase() !== customer.lastName.trim().toLowerCase())) throw Error("HIKCENTRAL_PERSON_LOOKUP_FAILED");
  }
  const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + 20 * 60_000);
  await db.$transaction(async tx => {
    await lockCustomer(tx, customer.id);
    const linked = await faceTarget(tx, scope, customer.id);
    const existing = await tx.hikCentralFaceCapture.findUnique({ where: { customerId: customer.id } });
    if (linked.personId !== personId || linked.customer.firstName?.trim() !== customer.firstName?.trim() || linked.customer.lastName?.trim() !== customer.lastName?.trim() || (existing?.version ?? 0) !== input.version || existing && ["WAITING_REVIEW", "SENDING", "PROVIDER_UNCERTAIN"].includes(existing.status)) throw Error("PHOTO_CHANGED");
    await tx.hikCentralFaceHandoff.deleteMany({ where: { customerId: customer.id, usedAt: null } });
    const handoff = await tx.hikCentralFaceHandoff.create({ data: { tokenHash: tokenHash(token), customerId: customer.id, organisationId: scope.organisationId, facilityId: input.facilityId, personId, firstNameSnapshot: customer.firstName?.trim() ?? null, lastNameSnapshot: customer.lastName?.trim() ?? null, photoVersion: input.version, issuedById: scope.userId, expiresAt } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "hikcentral_face.handoff_issued", entityType: "HikCentralFaceHandoff", entityId: handoff.id, after: { customerId: customer.id, personId, version: input.version, identityCheckedInPerson: !input.syntheticTest, syntheticTestReason: input.syntheticTest ? input.syntheticTestReason!.trim() : null, expiresAt: expiresAt.toISOString() } } });
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

async function activeHandoff(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error("PHOTO_CHANGED");
  const handoff = await db.hikCentralFaceHandoff.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!handoff || handoff.usedAt || handoff.expiresAt <= new Date()) throw Error("PHOTO_CHANGED");
  const issuer = await db.user.findFirst({ where: { id: handoff.issuedById, organisationId: handoff.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
  const access = currentRoleAccess(issuer?.roleAssignments.filter(a => a.role.organisationId === handoff.organisationId) ?? [], "access.manage", handoff.facilityId);
  if (!issuer || !access.allowed) throw Error("FORBIDDEN");
  const scope: RequestScope = { userId: issuer.id, organisationId: handoff.organisationId, facilityIds: access.allowedFacilityIds ?? [], unrestrictedFacilities: access.allowedFacilityIds === null };
  const { customer, personId } = await faceTarget(db, scope, handoff.customerId);
  if (personId !== handoff.personId || !sameCustomerName(customer, handoff) || ((await db.hikCentralFaceCapture.findUnique({ where: { customerId: customer.id } }))?.version ?? 0) !== handoff.photoVersion) throw Error("PHOTO_CHANGED");
  const issued = await db.auditEvent.findFirst({ where: { organisationId: scope.organisationId, action: "hikcentral_face.handoff_issued", entityType: "HikCentralFaceHandoff", entityId: handoff.id }, select: { after: true } });
  const syntheticTestReason = (issued?.after as { syntheticTestReason?: unknown } | null)?.syntheticTestReason;
  if (syntheticTestReason && (!scope.unrestrictedFacilities || !currentRoleAccess(issuer.roleAssignments.filter(a => a.role.organisationId === handoff.organisationId), "integrations.manage", handoff.facilityId).allowed)) throw Error("FORBIDDEN");
  return { handoff, scope, customer, syntheticTestReason: typeof syntheticTestReason === "string" ? syntheticTestReason : null };
}

export async function hikCentralFaceHandoff(token: string) {
  const { handoff, scope, customer, syntheticTestReason } = await activeHandoff(token);
  const current = await currentPolicy(db, scope.organisationId);
  const notice = handoffNotice(current, syntheticTestReason);
  return { name: customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer", unitNumber: "", purpose: "hikcentral" as const, notice: notice.notice, consentLabel: notice.consentLabel, alternativeContact: current.alternativeContact, retentionHours: current.retentionHours, policyHash: current.hash, expiresAt: handoff.expiresAt.toISOString() };
}

export async function captureHikCentralFaceHandoff(token: string, input: { policyHash: string; consent: boolean; image: File }) {
  const { handoff, scope, customer, syntheticTestReason } = await activeHandoff(token);
  if (!input.consent || input.policyHash !== policyHash) throw Error("PHOTO_CONSENT_REQUIRED");
  const image = await normaliseFacialPhoto(input.image);
  try {
    await db.$transaction(async tx => {
      await lockCustomer(tx, customer.id);
      const current = await currentPolicy(tx, scope.organisationId);
      const linked = await faceTarget(tx, scope, customer.id);
      const tokenRow = await tx.hikCentralFaceHandoff.findUnique({ where: { id: handoff.id } });
      const existing = await tx.hikCentralFaceCapture.findUnique({ where: { customerId: customer.id } });
      if (current.hash !== input.policyHash || linked.personId !== handoff.personId || !sameCustomerName(linked.customer, handoff) || !tokenRow || tokenRow.usedAt || tokenRow.expiresAt <= new Date() || (existing?.version ?? 0) !== handoff.photoVersion || existing && ["WAITING_REVIEW", "SENDING", "PROVIDER_UNCERTAIN"].includes(existing.status)) throw Error("PHOTO_CHANGED");
      const now = new Date(), version = handoff.photoVersion + 1;
      const values = { organisationId: scope.organisationId, facilityId: handoff.facilityId, personId: handoff.personId, firstNameSnapshot: handoff.firstNameSnapshot, lastNameSnapshot: handoff.lastNameSnapshot, version, status: "WAITING_REVIEW", encryptedImage: encryptPhoto(image, binding(customer.id, version)), imageSha256: createHash("sha256").update(image).digest("hex"), policyVersion: current.version, policyHash: current.hash, consentNotice: JSON.stringify(handoffNotice(current, syntheticTestReason)), consentAt: now, expiresAt: new Date(now.getTime() + current.retentionHours * 3600_000), reviewedAt: null, transferStartedAt: null, providerAcceptedAt: null, erasedAt: null };
      const photo = await tx.hikCentralFaceCapture.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id, ...values }, update: values });
      await tx.hikCentralFaceHandoff.update({ where: { id: handoff.id }, data: { usedAt: now } });
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: handoff.facilityId, actorId: scope.userId, action: "hikcentral_face.customer_submitted", entityType: "HikCentralFaceCapture", entityId: photo.id, after: { customerId: customer.id, personId: handoff.personId, version, syntheticTestReason, imageSha256: values.imageSha256, policyHash: current.hash, consentAt: now.toISOString(), expiresAt: values.expiresAt.toISOString() } } });
    });
  } finally { image.fill(0); }
}

async function staffPhoto(database: Database, scope: RequestScope, id: string) {
  const photo = await database.hikCentralFaceCapture.findUnique({ where: { id } });
  if (!photo || photo.organisationId !== scope.organisationId) throw Error("NOT_FOUND");
  await requireFacility(scope, photo.facilityId);
  await requireLeasingCustomer(scope, photo.customerId, database);
  return photo;
}

export async function previewHikCentralFace(scope: RequestScope, id: string, version: number) {
  return db.$transaction(async tx => {
    const first = await staffPhoto(tx, scope, id);
    await lockCustomer(tx, first.customerId);
    const photo = await staffPhoto(tx, scope, id);
    if (photo.version !== version || photo.status !== "WAITING_REVIEW" || !photo.encryptedImage || photo.expiresAt <= new Date()) throw Error("PHOTO_CHANGED");
    const image = decryptPhoto(photo.encryptedImage, binding(photo.customerId, version));
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: photo.facilityId, actorId: scope.userId, action: "hikcentral_face.previewed", entityType: "HikCentralFaceCapture", entityId: id, after: { version } } });
    return image;
  });
}

export async function decideHikCentralFace(scope: RequestScope, id: string, version: number, decision: "SEND" | "REJECT") {
  let newPersonDepartment: string | null = null;
  if (decision === "SEND") {
    const candidate = await staffPhoto(db, scope, id);
    if (!candidate.personId) {
      const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId));
      await assertNoExistingCustomerCode(provider, scope.organisationId, candidate.customerId);
      const organizations = await provider.listOrganizations();
      const matches = organizations.ok ? organizations.data.organizations.filter(item => item.name.trim().toUpperCase() === "STOR24") : [];
      if (matches.length !== 1 || !matches[0].indexCode || /^TEMP-/i.test(matches[0].indexCode)) throw Error("HIKCENTRAL_DEPARTMENT_REQUIRED");
      newPersonDepartment = matches[0].indexCode;
    }
  }
  const photo = await db.$transaction(async tx => {
    const first = await staffPhoto(tx, scope, id);
    await lockCustomer(tx, first.customerId);
    const current = await staffPhoto(tx, scope, id);
    const linked = await faceTarget(tx, scope, current.customerId);
    if (current.version !== version || current.status !== "WAITING_REVIEW" || !current.encryptedImage || current.expiresAt <= new Date() || linked.personId !== current.personId || !sameCustomerName(linked.customer, current)) throw Error("PHOTO_CHANGED");
    if (decision === "SEND") {
      if ((await currentPolicy(tx, scope.organisationId)).hash !== current.policyHash) throw Error("PHOTO_CONSENT_REQUIRED");
      const previewed = await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, actorId: scope.userId, entityType: "HikCentralFaceCapture", entityId: id, action: "hikcentral_face.previewed", after: { path: ["version"], equals: version } } });
      if (!previewed) throw Error("PHOTO_PREVIEW_REQUIRED");
    }
    const now = new Date();
    await tx.hikCentralFaceCapture.update({ where: { id }, data: decision === "SEND" ? { status: "SENDING", reviewedAt: now, transferStartedAt: now } : { status: "REJECTED", encryptedImage: null, erasedAt: now, reviewedAt: now } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: current.facilityId, actorId: scope.userId, action: decision === "SEND" ? "hikcentral_face.transfer_started" : "hikcentral_face.rejected", entityType: "HikCentralFaceCapture", entityId: id, after: { customerId: current.customerId, personId: current.personId, version } } });
    return decision === "SEND" ? current : null;
  });
  if (!photo) return { status: "REJECTED" };
  let accepted = false;
  let resolvedPersonId = photo.personId;
  const newPersonCode = photo.personId ? null : hikCentralCustomerCode(scope.organisationId, photo.customerId);
  try {
    const image = decryptPhoto(photo.encryptedImage!, binding(photo.customerId, version));
    try {
      const provider = new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId));
      if (newPersonCode && newPersonDepartment) {
        const result = await provider.createPersonWithFace({ organisationIndexCode: newPersonDepartment, personCode: newPersonCode, givenName: photo.firstNameSnapshot!, familyName: photo.lastNameSnapshot!, faceBase64: image.toString("base64") });
        if (result.ok) {
          const readback = await provider.personByCode(newPersonCode);
          accepted = readback.ok && readback.data.personId === result.data.personId && readback.data.organisationIndexCode === newPersonDepartment && readback.data.givenName.trim().toLowerCase() === photo.firstNameSnapshot!.toLowerCase() && readback.data.familyName.trim().toLowerCase() === photo.lastNameSnapshot!.toLowerCase();
          if (accepted) resolvedPersonId = result.data.personId;
        }
      } else if (photo.personId) {
        const result = await provider.updatePersonFace(photo.personId, image.toString("base64"));
        if (result.ok) {
          const readback = await provider.personById(photo.personId);
          accepted = readback.ok && readback.data.personId === photo.personId;
        }
      }
    } finally { image.fill(0); }
  } catch { /* A timeout may have occurred after HikCentral accepted the photo. Never retry blindly. */ }
  let status = accepted ? "PROVIDER_ACCEPTED" : "PROVIDER_UNCERTAIN";
  await db.$transaction(async tx => {
    await lockCustomer(tx, photo.customerId);
    if (accepted && newPersonCode && resolvedPersonId) {
      const target = await faceTarget(tx, scope, photo.customerId);
      if (target.personId !== null || !sameCustomerName(target.customer, photo) || await tx.integrationIdentityLink.findFirst({ where: { organisationId: scope.organisationId, hikCentralPersonId: resolvedPersonId, customerId: { not: photo.customerId } } })) { accepted = false; status = "PROVIDER_UNCERTAIN"; }
      else {
        const now = new Date();
        const link = await tx.integrationIdentityLink.upsert({ where: { customerId: photo.customerId }, create: { organisationId: scope.organisationId, customerId: photo.customerId, hikCentralPersonId: resolvedPersonId, status: "ACTIVE", linkedAt: now, resolvedById: scope.userId, resolutionNotes: "Created in STOR24 HikCentral department after staff ID check and customer face consent" }, update: { hikCentralPersonId: resolvedPersonId, status: "ACTIVE", linkedAt: now, resolvedById: scope.userId, resolutionNotes: "Created in STOR24 HikCentral department after staff ID check and customer face consent" } });
        await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: photo.facilityId, actorId: scope.userId, action: "integration.hikcentral.person_created", entityType: "IntegrationIdentityLink", entityId: link.id, after: { customerId: photo.customerId, personId: resolvedPersonId, personCode: newPersonCode, organisationIndexCode: newPersonDepartment, faceCaptureId: id } } });
      }
    }
    const updated = await tx.hikCentralFaceCapture.updateMany({ where: { id, version, status: "SENDING" }, data: { status, ...(accepted ? { personId: resolvedPersonId, encryptedImage: null, erasedAt: new Date(), providerAcceptedAt: new Date() } : {}) } });
    if (updated.count !== 1) throw Error("PHOTO_CHANGED");
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: photo.facilityId, actorId: scope.userId, action: accepted ? "hikcentral_face.api_accepted_person_readback" : "hikcentral_face.provider_uncertain", entityType: "HikCentralFaceCapture", entityId: id, after: { customerId: photo.customerId, personId: resolvedPersonId, version, deviceApplied: false } } });
  });
  let accessStatus: string | undefined;
  if (accepted) {
    try {
      const submitted = await db.auditEvent.findFirst({ where: { organisationId: scope.organisationId, entityType: "HikCentralFaceCapture", entityId: id, action: "hikcentral_face.customer_submitted", after: { path: ["version"], equals: version } }, orderBy: { occurredAt: "desc" }, select: { after: true } });
      const testReason = (submitted?.after as { syntheticTestReason?: unknown } | null)?.syntheticTestReason;
      if (typeof testReason === "string") {
        if (!scope.unrestrictedFacilities || !resolvedPersonId) throw Error("HIKCENTRAL_TEST_GRANT_NOT_READY");
        await approveCustomerFaceVisit(scope, photo.customerId, photo.facilityId, false, { expectedPersonId: resolvedPersonId, reason: testReason });
        const grants = (await customerFaceAccessReadiness(scope, photo.customerId, photo.facilityId)).grants;
        if (grants.length !== 2 || grants.some(grant => grant.status !== "GRANTED" || grant.personId !== resolvedPersonId)) throw Error("HIKCENTRAL_GRANT_UNCONFIRMED");
        accessStatus = "GRANTED";
      } else await reconcileCustomerFaceAccess(scope, photo.customerId, photo.facilityId);
    } catch (error) {
      accessStatus = "REVIEW_REQUIRED";
      await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: photo.facilityId, actorId: scope.userId, action: "hikcentral_face.access_reconcile_failed", entityType: "HikCentralFaceCapture", entityId: id, after: { customerId: photo.customerId, code: error instanceof Error ? error.message : "UNKNOWN" } } });
    }
  }
  return accessStatus ? { status, accessStatus } : { status };
}

export async function expireHikCentralFaceCaptures() {
  const due = await db.hikCentralFaceCapture.findMany({ where: { encryptedImage: { not: null }, expiresAt: { lte: new Date() } }, select: { id: true, customerId: true }, take: 100 });
  for (const item of due) await db.$transaction(async tx => {
    await lockCustomer(tx, item.customerId);
    const photo = await tx.hikCentralFaceCapture.findFirst({ where: { id: item.id, encryptedImage: { not: null }, expiresAt: { lte: new Date() } } });
    if (!photo) return;
    await tx.hikCentralFaceCapture.update({ where: { id: photo.id }, data: { encryptedImage: null, erasedAt: new Date(), status: ["SENDING", "PROVIDER_UNCERTAIN"].includes(photo.status) ? "PROVIDER_UNCERTAIN" : "EXPIRED" } });
    await tx.auditEvent.create({ data: { organisationId: photo.organisationId, facilityId: photo.facilityId, action: "hikcentral_face.local_photo_erased", entityType: "HikCentralFaceCapture", entityId: photo.id, after: { customerId: photo.customerId, version: photo.version } } });
  });
  await db.hikCentralFaceHandoff.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  if (await db.hikCentralFaceCapture.count({ where: { encryptedImage: { not: null }, expiresAt: { lte: new Date() } } })) throw Error("PHOTO_EXPIRY_MORE_DUE");
  return due.length;
}
