import { photoControlSnapshot, setPhotoCollection, resolvedPhotoPolicy } from "../../src/lib/facial-photo-control";
import { getMoveInProgress } from "../../src/lib/move-in-progress";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../../src/lib/db";
import { confirmReservationMoveIn, getReservationMoveInReadiness } from "../../src/lib/reservation-move-in";
import { facialPhotoPolicy } from "../../src/lib/facial-photo-security";
import { submitTenantPhoto, tenantPhotoStatus, withdrawTenantPhoto, listFacialPhotos, previewFacialPhoto, reviewFacialPhoto, expireFacialPhotos } from "../../src/lib/facial-photo-service";

test("isolated PostgreSQL private facial photo lifecycle", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "ci-facial-photo-key-not-for-production";
  await expireFacialPhotos();
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "CI only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key } });
    const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "CI staff" } });
    const customer = await db.customer.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, emailVerifiedAt: new Date() } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: key, features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: key, monthlyRate: 100, status: "RESERVED" } });
    const content = "Immutable CI signed agreement";
    const pdf = Buffer.from("CI signed PDF bytes");
    const startDate = new Date(Date.now() - 86400000);
    const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: startDate, publicLease: { create: {
      status: "SIGNED", version: "ci", paymentMethod: "EFT", content, clauses: [], sha256: createHash("sha256").update(content).digest("hex"), signingToken: randomUUID(), expiresAt: new Date(), signedAt: new Date(), signedPdf: pdf, signedPdfSha256: createHash("sha256").update(pdf).digest("hex"),
    } } } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ST24-T-${reservation.id}`, balance: -100 } });
    const payment = await db.payment.create({ data: { accountId: account.id, amount: 100, method: "EFT", status: "SUCCEEDED", processedAt: new Date(), idempotencyKey: key } });
    const receipt = await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: 100, description: "CI receipt", effectiveAt: new Date(), externalRef: key, createdById: user.id } });
    const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    process.env.FACIAL_ACCESS_POLICIES_JSON = JSON.stringify({ ...JSON.parse(process.env.FACIAL_ACCESS_POLICIES_JSON ?? "{}"), [org.id]: { enabled: true, version: "ci-v1", notice: "Synthetic CI policy only. This does not represent legal approval or a real customer consent.", consentLabel: "Synthetic consent checkbox only", approvalReference: "CI-only", retentionHours: 24, alternativeContact: "CI staff assisted alternative" } });
    const session = { organisationId: org.id, email: customer.email!, customerIds: [customer.id] };
    const image = new File([new Uint8Array(await sharp({ create: { width: 240, height: 320, channels: 3, background: "#808080" } }).png().toBuffer())], "synthetic.png", { type: "image/png" });
    const upload = { reservationId: reservation.id, policyHash: facialPhotoPolicy(org.id)!.hash, consent: true, expectedVersion: 0, image };
    return { org, facility, customer, unit, reservation, account, payment, receipt, scope, session, upload };
  }

  try {
    await t.test("owner switch is shared, pinned, audited; tenancy retention and deletion continue while off", async () => {
      const f=await fixture();
      const role=await db.role.create({data:{organisationId:f.org.id,name:"Organisation owner",permissions:["*"]}});
      await db.roleAssignment.create({data:{userId:f.scope.userId,roleId:role.id}});
      await db.moveInTrainingControl.create({data:{organisationId:f.org.id,controllerUserId:f.scope.userId}});
      const other=await db.user.create({data:{organisationId:f.org.id,email:randomUUID()+"@example.invalid",name:"Another owner",roleAssignments:{create:{roleId:role.id}}}});
      assert.equal((await photoControlSnapshot(f.org.id,other.id)).canToggle,false);
      await assert.rejects(setPhotoCollection(other.id,true,0),/FORBIDDEN/);
      await setPhotoCollection(f.scope.userId,true,0);
      assert.equal((await photoControlSnapshot(f.org.id,other.id)).enabled,true);
      await assert.rejects(setPhotoCollection(f.scope.userId,false,0),/PHOTO_CONTROL_CHANGED/);
      const policy=await resolvedPhotoPolicy(db,f.org.id);
      const photo=await submitTenantPhoto(f.session,{...f.upload,policyHash:policy!.hash});
      assert.equal(photo.expiresAt,null);
      await setPhotoCollection(f.scope.userId,false,1);
      assert.equal((await tenantPhotoStatus(f.session,f.reservation.id)).available,false);
      await assert.rejects(submitTenantPhoto(f.session,{...f.upload,policyHash:policy!.hash,expectedVersion:1}),/PHOTO_POLICY_PENDING/);
      assert.equal((await resolvedPhotoPolicy(db,f.org.id))!.hash,policy!.hash);
      await previewFacialPhoto(f.scope,photo.id,1);
      await reviewFacialPhoto(f.scope,photo.id,1,"APPROVE");
      assert.equal((await getReservationMoveInReadiness(f.scope,f.reservation.id)).ready,true);
      const moved=await confirmReservationMoveIn(f.scope,f.reservation.id);
      await db.reservation.update({where:{id:f.reservation.id},data:{holdExpiresAt:new Date(0)}});
      await expireFacialPhotos();
      assert.ok((await db.facialPhotoSubmission.findUniqueOrThrow({where:{id:photo.id}})).encryptedImage);
      await db.tenancy.update({where:{id:moved.tenancyId},data:{status:"CLOSED"}});
      await expireFacialPhotos();
      assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({where:{id:photo.id}})).encryptedImage,null);
      assert.equal(await db.auditEvent.count({where:{organisationId:f.org.id,action:{in:["facial_photo.collection_enabled","facial_photo.collection_disabled"]}}}),2);
      await db.roleAssignment.deleteMany({where:{userId:f.scope.userId}});
      await assert.rejects(setPhotoCollection(f.scope.userId,true,2),/FORBIDDEN/);
    });
    await t.test("handover requires current staff approval and leaves blocked bookings untouched", async () => {
      const f = await fixture();
      async function blocked() {
        const readiness = await getReservationMoveInReadiness(f.scope, f.reservation.id);
        assert.equal(readiness.ready, false);
        assert.ok(readiness.blockers.some(value => value.includes("staff-approved access photo")));
        await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
        assert.equal(await db.tenancy.count({ where: { accountId: f.account.id } }), 0);
        assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } })).status, "RESERVED");
        assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "tenancy.key_handover_confirmed" } }), 0);
      }
      await blocked();
      const photo = await submitTenantPhoto(f.session, f.upload);
      await blocked();
      await previewFacialPhoto(f.scope, photo.id, 1);
      await reviewFacialPhoto(f.scope, photo.id, 1, "APPROVE");
      const approved = await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } });
      assert.equal((await getReservationMoveInReadiness(f.scope, f.reservation.id)).ready, true);
      for (const change of [{ status: "REJECTED" as const }, { status: "WITHDRAWN" as const }, { expiresAt: new Date(0) }, { encryptedImage: null }, { erasedAt: new Date() }, { reviewedAt: null }, { reviewedById: null }, { policyHash: "old-policy" }]) {
        await db.facialPhotoSubmission.update({ where: { id: photo.id }, data: change });
        await blocked();
        await db.facialPhotoSubmission.update({ where: { id: photo.id }, data: { status: approved.status, expiresAt: approved.expiresAt, encryptedImage: approved.encryptedImage, erasedAt: approved.erasedAt, reviewedAt: approved.reviewedAt, reviewedById: approved.reviewedById, policyHash: approved.policyHash } });
      }
      const policies = process.env.FACIAL_ACCESS_POLICIES_JSON;
      process.env.FACIAL_ACCESS_POLICIES_JSON = "{}";
      await blocked();
      process.env.FACIAL_ACCESS_POLICIES_JSON = policies;
      assert.equal((await getReservationMoveInReadiness(f.scope, f.reservation.id)).ready, true);
    });
    await t.test("private queue, audited preview and reviewed handover create one durable activation request", async () => {
      const f = await fixture();
      const photo = await submitTenantPhoto(f.session, f.upload);
      assert.equal(photo.status, "WAITING_REVIEW");
      assert.equal("encryptedImage" in photo, false);
      assert.equal(JSON.stringify(await listFacialPhotos(f.scope)).includes("encryptedImage"), false);
      assert.equal((await listFacialPhotos(f.scope, f.reservation.id)).length, 1);
      assert.deepEqual(await listFacialPhotos(f.scope, "not-this-booking"), []);
      assert.deepEqual(await listFacialPhotos({ ...f.scope, facilityIds: [] }, f.reservation.id), []);
      assert.equal((await getMoveInProgress(f.scope, f.reservation.id)).photoReviewed, false);
      assert.equal(JSON.stringify(await tenantPhotoStatus(f.session, f.reservation.id)).includes("imageSha256"), false);
      await assert.rejects(reviewFacialPhoto(f.scope, photo.id, 1, "APPROVE"), /PHOTO_PREVIEW_REQUIRED/);
      assert.ok((await previewFacialPhoto(f.scope, photo.id, 1)).length > 100);
      await reviewFacialPhoto(f.scope, photo.id, 1, "APPROVE");
      assert.equal((await getMoveInProgress(f.scope, f.reservation.id)).photoReviewed, true);
      const [a,b] = await Promise.all([confirmReservationMoveIn(f.scope, f.reservation.id), confirmReservationMoveIn(f.scope, f.reservation.id)]);
      assert.equal(a.tenancyId, b.tenancyId);
      const stored = await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } });
      assert.equal(stored.status, "PENDING_PROVIDER"); assert.ok(stored.occupancyId); assert.ok(stored.activationRequestedAt);
      assert.equal((await db.occupancy.findUniqueOrThrow({ where: { id: stored.occupancyId } })).accessState, "PENDING");
      assert.equal(await db.auditEvent.count({ where: { entityId: photo.id, action: "facial_photo.activation_requested" } }), 1);
      assert.equal(await db.biometricEnrollment.count({ where: { customerId: f.customer.id } }), 0);
      await withdrawTenantPhoto(f.session, f.reservation.id, 1);
      const withdrawn = await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } });
      assert.equal(withdrawn.encryptedImage, null); assert.equal(withdrawn.activationRequestedAt, null);
      assert.equal(withdrawn.status, "WITHDRAWN");
    });
    await t.test("another customer, organisation or facility cannot read or submit a photograph", async () => {
      const f = await fixture(), other = await fixture();
      await assert.rejects(submitTenantPhoto(other.session, f.upload), /TENANT_NOT_FOUND/);
      await assert.rejects(submitTenantPhoto({ ...f.session, email: "wrong@example.invalid" }, f.upload), /TENANT_NOT_FOUND/);
      const photo = await submitTenantPhoto(f.session, f.upload);
      await assert.rejects(previewFacialPhoto(other.scope, photo.id, 1), /NOT_FOUND/);
      await assert.rejects(previewFacialPhoto({ ...f.scope, facilityIds: [] }, photo.id, 1), /NOT_FOUND/);
      await assert.rejects(withdrawTenantPhoto(other.session, f.reservation.id, 1), /TENANT_NOT_FOUND/);
      assert.deepEqual(await listFacialPhotos(other.scope), []);
    });
    await t.test("replacement invalidates review and simultaneous submissions cannot overwrite silently", async () => {
      const f = await fixture(), photo = await submitTenantPhoto(f.session, f.upload);
      await previewFacialPhoto(f.scope, photo.id, 1); await reviewFacialPhoto(f.scope, photo.id, 1, "APPROVE");
      const results = await Promise.allSettled([submitTenantPhoto(f.session, { ...f.upload, expectedVersion: 1 }), submitTenantPhoto(f.session, { ...f.upload, expectedVersion: 1 })]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const stored = await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } });
      assert.equal(stored.version, 2); assert.equal(stored.status, "WAITING_REVIEW"); assert.equal(stored.reviewedAt, null);
      const previousConsent = await db.auditEvent.findFirstOrThrow({ where: { entityId: photo.id, action: "facial_photo.customer_submitted", after: { path: ["version"], equals: 1 } } });
      const evidence = previousConsent.after as { collectionPolicy: { consentLabel: string; approvalReference: string } };
      assert.equal(evidence.collectionPolicy.consentLabel, "Synthetic consent checkbox only");
      assert.equal(evidence.collectionPolicy.approvalReference, "CI-only");
      await assert.rejects(reviewFacialPhoto(f.scope, photo.id, 1, "APPROVE"), /PHOTO_CHANGED/);
      await assert.rejects(reviewFacialPhoto(f.scope, photo.id, 2, "APPROVE"), /PHOTO_PREVIEW_REQUIRED/);
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } })).activationRequestedAt, null);
    });
    await t.test("future move-in may queue a photo but cannot activate; sandbox payments never qualify", async () => {
      const f = await fixture();
      await db.reservation.update({ where: { id: f.reservation.id }, data: { intendedMoveIn: new Date(Date.now() + 86400000) } });
      const photo = await submitTenantPhoto(f.session, f.upload); assert.equal(photo.status, "WAITING_REVIEW");
      await assert.rejects(confirmReservationMoveIn(f.scope, f.reservation.id), /MOVE_IN_NOT_READY/);
      const other = await fixture();
      await db.payment.update({ where: { id: other.payment.id }, data: { status: "TEST_SUCCEEDED" } });
      await assert.rejects(submitTenantPhoto(other.session, other.upload), /PHOTO_BOOKING_NOT_READY/);
      assert.equal(await db.facialPhotoSubmission.count({ where: { reservationId: other.reservation.id } }), 0);
    });
    await t.test("expired, rejected and cancelled submissions lose their ciphertext", async () => {
      const f = await fixture(), photo = await submitTenantPhoto(f.session, f.upload);
      await db.facialPhotoSubmission.update({ where: { id: photo.id }, data: { expiresAt: new Date(Date.now()-1000) } });
      await assert.rejects(previewFacialPhoto(f.scope, photo.id, 1), /PHOTO_CHANGED/);
      await expireFacialPhotos(); assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } })).encryptedImage, null);
      const g = await fixture(), p = await submitTenantPhoto(g.session, g.upload);
      await reviewFacialPhoto(g.scope, p.id, 1, "REJECT");
      assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: p.id } })).encryptedImage, null);
      const h = await fixture(), q = await submitTenantPhoto(h.session, h.upload);
      await db.reservation.update({ where: { id: h.reservation.id }, data: { status: "CANCELLED" } });
      await expireFacialPhotos(); assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: q.id } })).encryptedImage, null);
    });
    await t.test("policy changes, missing consent and stopped retention worker fail closed", async () => {
      const f = await fixture();
      await assert.rejects(submitTenantPhoto(f.session, { ...f.upload, consent: false }), /PHOTO_CONSENT_REQUIRED/);
      await assert.rejects(submitTenantPhoto(f.session, { ...f.upload, policyHash: "stale" }), /PHOTO_CONSENT_REQUIRED/);
      await db.facialPhotoMaintenance.update({ where: { id: "expiry" }, data: { completedAt: new Date(Date.now()-2*3600000) } });
      await assert.rejects(submitTenantPhoto(f.session, f.upload), /PHOTO_MAINTENANCE_REQUIRED/);
      await expireFacialPhotos();
      const photo = await submitTenantPhoto(f.session, f.upload);
      process.env.FACIAL_ACCESS_POLICIES_JSON = "{}";
      await assert.rejects(previewFacialPhoto(f.scope, photo.id, 1), /PHOTO_CHANGED/);
      await assert.rejects(submitTenantPhoto(f.session, { ...f.upload, expectedVersion: 1 }), /PHOTO_POLICY_PENDING/);
      await withdrawTenantPhoto(f.session, f.reservation.id, 1);
      assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } })).encryptedImage, null);
    });
    await t.test("a photo submitted after staff handover still requires current review; closed tenancies cannot preview it", async () => {
      const f = await fixture();
      const first = await submitTenantPhoto(f.session, f.upload);
      await previewFacialPhoto(f.scope, first.id, 1);
      await reviewFacialPhoto(f.scope, first.id, 1, "APPROVE");
      const tenancy = await confirmReservationMoveIn(f.scope, f.reservation.id);
      const photo = await submitTenantPhoto(f.session, { ...f.upload, expectedVersion: 1 });
      await previewFacialPhoto(f.scope, photo.id, 2);
      await reviewFacialPhoto(f.scope, photo.id, 2, "APPROVE");
      assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } })).status, "PENDING_PROVIDER");
      await db.tenancy.update({ where: { id: tenancy.tenancyId }, data: { status: "CLOSED" } });
      await assert.rejects(previewFacialPhoto(f.scope, photo.id, 2), /PHOTO_BOOKING_NOT_READY/);
      await expireFacialPhotos();
      assert.equal((await db.facialPhotoSubmission.findUniqueOrThrow({ where: { id: photo.id } })).encryptedImage, null);
    });
  } finally { await db.$disconnect(); }
});
