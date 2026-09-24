import { facialPhotoPolicy } from "../../src/lib/facial-photo-security";
import { submitTenantPhoto, previewFacialPhoto, reviewFacialPhoto, expireFacialPhotos } from "../../src/lib/facial-photo-service";
import { getMoveInProgress } from "../../src/lib/move-in-progress";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../../src/lib/db";
import { createPublicReservation, releaseExpiredPublicReservations, startPublicEmailVerification, verifyPublicReservation, verifyPublicReservationEmail } from "../../src/lib/public-booking-service";
import { publicReservationSchema } from "../../src/lib/public-booking-contract";
import { identityPolicy } from "../../src/lib/identity-document-security";
import { expireIdentityDocuments, identityStatus, previewIdentity, reviewIdentity, submitIdentity } from "../../src/lib/identity-document-service";
import { completePublicReservationLease, getPublicReservationLease, preparePublicReservationLease } from "../../src/lib/public-lease-workflow";
import { LEASE_CLAUSE_KEYS } from "../../src/lib/lease-agreement-content";
import { recordReservationReceipt } from "../../src/lib/reservation-payment";
import { confirmReservationMoveIn, getReservationMoveInReadiness } from "../../src/lib/reservation-move-in";
import { giveNotice, moveOut } from "../../src/lib/leasing-service";
import { getStatementData } from "../../src/lib/finance/statement-data";
import { startTenantChallenge, tenantSessionForToken, verifyTenantChallenge } from "../../src/lib/tenant-portal-auth";

// Real services and PostgreSQL, synthetic customer/identity/signature/receipt only.
// Provider transport is intercepted: this is not real delivery, money or physical entry acceptance.
test("isolated PostgreSQL connected customer journey", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.equal(databaseUrl.hostname, "localhost");
  assert.match(databaseUrl.pathname, /_ci$/);
  const savedEnvironment = { ...process.env };
  Object.assign(process.env, {
    PUBLIC_RESERVATION_VERIFICATION_ENABLED: "true", PUBLIC_BOOKING_API_KEY: "journey-ci-only",
    INTEGRATION_CONFIG_ENCRYPTION_KEY: "journey-ci-only-never-for-production",
    AUTH_SECRET: "journey-ci-only-auth-secret-not-production",
    TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_AUTH_TOKEN: "synthetic-only",
    TWILIO_SMS_FROM: "+15005550006", TWILIO_WHATSAPP_VERIFICATION_SID: "", EMAIL_PROVIDER: "twilio",
    WHATSAPP_AUTOMATION_ENABLED: "false", APP_URL: "http://localhost:3000",
  });
  let smsCode = "", emailCode = "";
  const attemptedHosts: string[] = [];
  const transport = t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    attemptedHosts.push(url.hostname);
    if (url.hostname === "api.twilio.com" && url.pathname.endsWith("/Messages.json")) {
      const body = new URLSearchParams(String(init?.body)).get("Body") ?? "";
      smsCode = body.match(/\b\d{6}\b/)?.[0] ?? "";
      return Response.json({ sid: "SM-synthetic" });
    }
    if (url.hostname === "comms.twilio.com" && url.pathname === "/v1/Emails") {
      const body = JSON.parse(String(init?.body));
      assert.match(body.to[0].address, /@example\.invalid$/);
      emailCode = body.content.text.match(/\b\d{6}\b/)?.[0] ?? emailCode;
      return Response.json({ id: "synthetic-email" });
    }
    throw new Error(`Unexpected transport blocked: ${url.hostname}`);
  });
  try {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Synthetic journey only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Journey training store", code: key, publicSlug: key, publicBookingEnabled: true, closedFloors: ["first floor", "second floor"] } });
    const reviewer = await db.user.create({ data: { organisationId: org.id, email: `${key}-staff@example.invalid`, name: "Synthetic reviewer" } });
    const scope = { userId: reviewer.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "Test storage", features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: "J01", floor: "Ground Floor", monthlyRate: 100 } });
    const closedUnit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: "J02", floor: "First Floor", monthlyRate: 100 } });
    const startDate = new Date(Date.now() - 86400000);
    const input = publicReservationSchema.parse({ facilitySlug: key, unitId: unit.id, firstName: "Synthetic", lastName: "Journey", email: `${key}@example.invalid`, phone: "+15005550006", intendedMoveIn: startDate, idempotencyKey: randomUUID() });
    process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify({ [org.id]: { enabled: true, fullCopyApproved: true, effectiveFrom: "2026-01-01T00:00:00Z", version: "synthetic-ci", approvalReference: "Synthetic fixture only", notice: "Synthetic test identity only. This fixture is not a real identity or an approved production policy.", acknowledgementLabel: "Synthetic acknowledgement only", retentionMode: "TENANCY", acceptedTypes: ["ID_CARD"], alternativeContact: "Training store" } });
    await expireIdentityDocuments();

    const booking = await createPublicReservation(input, "synthetic-ip-hash");
    assert.ok(booking.reference);
    const reference = booking.reference;
    const reservation = await db.reservation.findUniqueOrThrow({ where: { publicReference: reference } });
    await t.test("J01/J14 booking replay, competition and closed-floor submissions", async () => {
      assert.ok("verificationRequired" in booking && booking.verificationRequired);
      assert.equal((await createPublicReservation(input, "synthetic-ip-hash")).reference, reference);
      await assert.rejects(createPublicReservation({ ...input, idempotencyKey: randomUUID() }, "synthetic"), /UNIT_UNAVAILABLE/);
      await assert.rejects(createPublicReservation({ ...input, unitId: closedUnit.id, idempotencyKey: randomUUID() }, "synthetic"), /UNIT_UNAVAILABLE/);
      assert.equal(await db.reservation.count({ where: { unitId: unit.id } }), 1);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "RESERVED");
    });
    let identityToken = "";
    await t.test("J12 contact and email verification, invalid-code recovery and replay rejection", async () => {
      assert.equal((await verifyPublicReservation(reference, "not-a-code")).ok, false);
      assert.equal((await verifyPublicReservation(reference, smsCode)).ok, true);
      assert.equal((await verifyPublicReservation(reference, smsCode)).ok, false);
      assert.equal((await startPublicEmailVerification(reference)).ok, true);
      const verified = await verifyPublicReservationEmail(reference, emailCode);
      assert.ok(verified.ok);
      if (!verified.ok) throw new Error("Email verification failed");
      identityToken = verified.identityAccessToken;
      assert.equal((await verifyPublicReservationEmail(reference, emailCode)).ok, false);
      assert.equal((await identityStatus(reference, identityToken)).available, true);
    });
    const image = new File([new Uint8Array(await sharp({ create: { width: 600, height: 800, channels: 3, background: "#669988" } }).png().toBuffer())], "synthetic.png", { type: "image/png" });
    const identityInput = { expectedVersion: 0, policyHash: identityPolicy(org.id)!.hash, acknowledged: true, documentType: "ID_CARD", pages: [image, image] };
    let documentId = "";
    await t.test("J02/J08 rejected identity replacement requires fresh page reviews", async () => {
      assert.equal((await preparePublicReservationLease(reference, "EFT")).ok, false);
      const first = await submitIdentity(reference, identityToken, identityInput);
      documentId = first.id;
      await assert.rejects(reviewIdentity(scope, first.id, 1, "ACCEPT"), /ID_PREVIEW_REQUIRED/);
      await previewIdentity(scope, first.id, 1, 0);
      await previewIdentity(scope, first.id, 1, 1);
      await reviewIdentity(scope, first.id, 1, "REPLACE", "Image is not clear enough");
      assert.equal((await identityStatus(reference, identityToken)).canContinue, false);
      const replacement = await submitIdentity(reference, identityToken, { ...identityInput, expectedVersion: 1 });
      assert.equal(replacement.version, 2);
      await assert.rejects(reviewIdentity(scope, first.id, 1, "ACCEPT"), /ID_CHANGED/);
      await assert.rejects(reviewIdentity(scope, first.id, 2, "ACCEPT"), /ID_PREVIEW_REQUIRED/);
      await previewIdentity(scope, first.id, 2, 0);
      await assert.rejects(reviewIdentity(scope, first.id, 2, "ACCEPT"), /ID_PREVIEW_REQUIRED/);
      await previewIdentity(scope, first.id, 2, 1);
      await reviewIdentity(scope, first.id, 2, "ACCEPT");
      const progress = await getMoveInProgress(scope, reservation.id);
      assert.equal(progress.identityAccepted, true); assert.equal(progress.handedOver, false);
      assert.equal(progress.photoReviewed, false);
      await assert.rejects(getMoveInProgress({ ...scope, facilityIds: [] }, reservation.id), /NOT_FOUND/);
    });
    let signedHash = "";
    await t.test("J03/J15 interrupted and repeated signing preserves one signed PDF", async () => {
      const prepared = await preparePublicReservationLease(reference, "EFT");
      assert.ok(prepared.ok);
      const resumed = await preparePublicReservationLease(reference, "EFT");
      assert.ok(resumed.ok);
      assert.equal(resumed.token, prepared.token);
      const view = await getPublicReservationLease(prepared.token); assert.ok(view);
      const signing = { signerName: "Synthetic test signer", initials: LEASE_CLAUSE_KEYS, signerIp: null, signerUserAgent: "Isolated CI", termsAccepted: true, acceptedSha256: view.sha256 };
      await assert.rejects(completePublicReservationLease(prepared.token, { ...signing, acceptedSha256: "stale" }), /VALIDATION_ERROR/);
      const completions = await Promise.all([
        completePublicReservationLease(prepared.token, signing),
        completePublicReservationLease(prepared.token, signing),
        preparePublicReservationLease(reference, "EFT"),
      ]);
      assert.equal(completions[0].status, "SIGNED");
      assert.equal(completions[1].status, "SIGNED");
      assert.equal((await completePublicReservationLease(prepared.token, signing)).idempotent, true);
      const lease = await db.publicReservationLease.findUniqueOrThrow({ where: { reservationId: reservation.id } });
      assert.ok(lease.content.includes("Synthetic Journey"));
      assert.ok(lease.content.includes(unit.number));
      assert.ok(lease.content.includes("100"));
      assert.equal(lease.paymentMethod, "EFT");
      signedHash = createHash("sha256").update(lease.signedPdf!).digest("hex");
      assert.equal(lease.signedPdfSha256, signedHash);
      assert.equal(Buffer.from(lease.signedPdf!).subarray(0, 4).toString(), "%PDF");
    });
    await t.test("J04/J13 unpaid handover blocks; a synthetic staff receipt posts once", async () => {
      await assert.rejects(confirmReservationMoveIn(scope, reservation.id), /MOVE_IN_NOT_READY/);
      const receipt = { reservationId: reservation.id, requestId: randomUUID(), amount: 100, method: "EFT" as const, reference: "SYNTHETIC-RECEIPT-ONLY", receivedAt: new Date(Date.now() - 1000), realPaymentConfirmed: true as const };
      const [a, b] = await Promise.all([recordReservationReceipt(scope, receipt), recordReservationReceipt(scope, receipt)]);
      assert.equal(a.paymentId, b.paymentId);
      await assert.rejects(recordReservationReceipt(scope, { ...receipt, requestId: randomUUID() }), /REFERENCE_EXISTS/);
      assert.equal((await getReservationMoveInReadiness(scope, reservation.id)).ready, false);
      await assert.rejects(confirmReservationMoveIn(scope, reservation.id), /MOVE_IN_NOT_READY/);
      process.env.FACIAL_ACCESS_POLICIES_JSON = JSON.stringify({ [org.id]: { enabled: true, version: "ci-v1", notice: "Synthetic CI policy only. This does not represent legal approval or a real customer consent.", consentLabel: "Synthetic consent checkbox only", approvalReference: "CI-only", retentionHours: 24, alternativeContact: "CI staff assisted alternative" } });
      await expireFacialPhotos();
      const photo = await submitTenantPhoto({ organisationId: org.id, email: input.email, customerIds: [reservation.customerId] }, { reservationId: reservation.id, policyHash: facialPhotoPolicy(org.id)!.hash, consent: true, expectedVersion: 0, image });
      await assert.rejects(confirmReservationMoveIn(scope, reservation.id), /MOVE_IN_NOT_READY/);
      await previewFacialPhoto(scope, photo.id, 1);
      await reviewFacialPhoto(scope, photo.id, 1, "APPROVE");
      assert.equal((await getReservationMoveInReadiness(scope, reservation.id)).ready, true);
    });
    const account = await db.account.findUniqueOrThrow({ where: { accountNumber: `ST24-T-${reservation.id}` } });
    await t.test("J09 signed paid booking survives the original hold deadline", async () => {
      await db.reservation.update({ where: { id: reservation.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
      await releaseExpiredPublicReservations();
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, "ACTIVE");
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "RESERVED");
      assert.equal((await getReservationMoveInReadiness(scope, reservation.id)).ready, true);
    });
    let tenancyId = "";
    await t.test("J05/J06/J17 scoped concurrent handover creates one active tenancy", async () => {
      await assert.rejects(confirmReservationMoveIn({ ...scope, facilityIds: [] }, reservation.id), /NOT_FOUND/);
      const [a, b] = await Promise.all([confirmReservationMoveIn(scope, reservation.id), confirmReservationMoveIn(scope, reservation.id)]);
      assert.equal(a.tenancyId, b.tenancyId); tenancyId = a.tenancyId;
      const completed = await getMoveInProgress(scope, reservation.id);
      assert.equal(completed.handedOver, true); assert.ok(completed.handedOverAt);
      assert.equal(completed.photoReviewed, true);
      assert.equal(completed.photoStatus, "PENDING_PROVIDER"); // Approval queues access; it does not prove physical activation.
      const active = await db.tenancy.findUniqueOrThrow({ where: { id: tenancyId }, include: { documents: true, occupancies: true } });
      assert.equal(active.accountId, account.id); assert.equal(active.status, "ACTIVE");
      assert.equal(active.documents.length, 1); assert.equal(active.occupancies.length, 1);
      assert.equal(active.occupancies[0].accessState, "PENDING");
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "OCCUPIED");
      assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: documentId } })).retentionMode, "TENANCY");
    });
    await t.test("J06/J12/J17 tenant sign-in and refresh remain scoped to the same customer", async () => {
      const challenge = await startTenantChallenge(org.slug, input.email);
      const token = await verifyTenantChallenge(challenge, emailCode);
      const session = await tenantSessionForToken(token);
      assert.deepEqual(session.customerIds, [reservation.customerId]);
      assert.deepEqual((await tenantSessionForToken(token)).customerIds, session.customerIds);
      await assert.rejects(verifyTenantChallenge(challenge, emailCode), /TENANT_INVALID_CODE/);
      await assert.rejects(previewIdentity({ ...scope, facilityIds: [] }, documentId, 2, 0), /NOT_FOUND/);
    });
    await t.test("J07 move-out, statement reconciliation, replay and identity retention", async () => {
      const movedOutAt = new Date();
      await giveNotice(scope, { tenancyId, noticeDate: movedOutAt, plannedMoveOut: movedOutAt });
      const leaving = { tenancyId, movedOutAt, finalCharge: 25, depositAction: "NONE" as const, depositAmount: 0, idempotencyKey: randomUUID(), notes: "Synthetic test only; outstanding credit requires finance acceptance." };
      const result = await moveOut(scope, leaving);
      assert.equal(result.tenancy.status, "CLOSED");
      assert.deepEqual(result.releasedUnits, [{ unitId: unit.id, status: "AVAILABLE" }]);
      assert.equal((await moveOut(scope, leaving)).replayed, true);
      await assert.rejects(moveOut(scope, { ...leaving, finalCharge: 26 }), /CONFLICT/);
      const balance = (await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance;
      assert.equal(Number(balance), -75); // 100 receipt, 25 final charge; no invented rent/proration rule.
      const statement = await getStatementData({ id: account.id, customer: { organisationId: org.id } }, "2026-01-01", "2099-12-31");
      assert.equal(statement.closingBalance, "-75.00");
      assert.equal(statement.rows.length, 2);
      assert.equal(await db.payment.count({ where: { accountId: account.id } }), 1);
      await expireIdentityDocuments();
      assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: documentId } })).encryptedPages, null);
      assert.equal((await db.publicReservationLease.findUniqueOrThrow({ where: { reservationId: reservation.id } })).signedPdfSha256, signedHash);
      assert.equal((await db.occupancy.findFirstOrThrow({ where: { tenancyId } })).accessState, "REVOKED");
    });
    await t.test("J16 audit links the same booking, identity, payment and tenancy exactly once", async () => {
      const events = await db.auditEvent.findMany({ where: { organisationId: org.id } });
      for (const action of ["public_reservation.created", "public_reservation.contact_verified", "public_reservation.email_verified", "public_lease.signed", "booking.payment_recorded", "tenancy.key_handover_confirmed", "tenancy.notice_given", "tenancy.moved_out", "identity_document.erased"]) assert.equal(events.filter(event => event.action === action).length, 1, action);
      const handover = events.find(event => event.action === "tenancy.key_handover_confirmed")!;
      assert.equal(handover.entityId, tenancyId);
      assert.equal((handover.after as { reservationId: string }).reservationId, reservation.id);
      assert.equal(await db.tenancy.count({ where: { accountId: account.id } }), 1);
      assert.ok(attemptedHosts.length > 0);
      assert.ok(attemptedHosts.every(host => ["api.twilio.com", "comms.twilio.com"].includes(host)));
    });
    await t.test("J12 committed verification survives notification-log failure", async () => {
      const nextUnit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: "NOTIFICATION-RECOVERY", floor: "Ground Floor", monthlyRate: 100 } });
      const next = await createPublicReservation({ ...input, unitId: nextUnit.id, idempotencyKey: randomUUID(), communicationConsent: { email: true, sms: true, whatsapp: false, phone: false } }, "synthetic-notification-recovery");
      const nextReference = next.reference!, code = smsCode;
      // A real database constraint rejects log writes; Prisma delegates are dynamic proxies.
      await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" ADD CONSTRAINT "synthetic_notification_failure" CHECK (false) NOT VALID');
      try {
        const verified = await verifyPublicReservation(nextReference, code);
        assert.ok(verified.ok);
        assert.ok("identityAccessToken" in verified && verified.identityAccessToken);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "CommunicationLog" DROP CONSTRAINT "synthetic_notification_failure"'); }
      const saved = await db.reservation.findUniqueOrThrow({ where: { publicReference: nextReference } });
      assert.ok(saved.contactVerifiedAt); assert.equal(saved.verificationCodeHash, null);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: nextUnit.id } })).status, "RESERVED");
      assert.equal(await db.auditEvent.count({ where: { entityId: saved.id, action: "public_reservation.contact_verified" } }), 1);
      assert.equal((await verifyPublicReservation(nextReference, code)).ok, false);
    });
    await t.test("J09 expired unsigned hold releases its unit and cannot be signed", async () => {
      const next = await createPublicReservation({ ...input, idempotencyKey: randomUUID() }, "synthetic");
      await db.reservation.update({ where: { publicReference: next.reference! }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
      await releaseExpiredPublicReservations();
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "AVAILABLE");
      assert.equal((await preparePublicReservationLease(next.reference!, "EFT")).ok, false);
    });
    await t.test("J09 concurrent expiry releases package stock once and audits once", async () => {
      const product = await db.product.create({ data: { organisationId: org.id, facilityId: facility.id, sku: randomUUID(), name: "Synthetic box", category: "Boxes", sellingPrice: 10, quantityOnHand: 10, quantityReserved: 0 } });
      const next = await createPublicReservation({ ...input, idempotencyKey: randomUUID(), customPackageItems: [{ productId: product.id, quantity: 2 }] }, "synthetic");
      const held = await db.reservation.update({ where: { publicReference: next.reference! }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
      const results = await Promise.all([releaseExpiredPublicReservations(), releaseExpiredPublicReservations()]);
      assert.equal(results.reduce((sum, count) => sum + count, 0), 1);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).quantityReserved, 0);
      assert.equal((await db.reservationPackage.findUniqueOrThrow({ where: { reservationId: held.id } })).status, "RELEASED");
      assert.equal(await db.auditEvent.count({ where: { entityId: held.id, action: "public_reservation.hold_expired" } }), 1);
    });
    await t.test("J09 expiry preserves another hold and open maintenance", async () => {
      for (const kind of ["hold", "maintenance"] as const) {
        const protectedUnit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: randomUUID(), floor: "Ground Floor", monthlyRate: 100, status: "RESERVED" } });
        await db.reservation.create({ data: { facilityId: facility.id, customerId: reservation.customerId, unitId: protectedUnit.id, source: "PUBLIC_WEBSITE", quotedRate: 100, holdExpiresAt: new Date(Date.now() - 1000) } });
        if (kind === "hold") await db.reservation.create({ data: { facilityId: facility.id, customerId: reservation.customerId, unitId: protectedUnit.id, quotedRate: 100, holdExpiresAt: new Date(Date.now() + 86400000) } });
        else await db.maintenanceRequest.create({ data: { organisationId: org.id, facilityId: facility.id, unitId: protectedUnit.id, title: "Synthetic maintenance" } });
        await releaseExpiredPublicReservations();
        assert.equal((await db.unit.findUniqueOrThrow({ where: { id: protectedUnit.id } })).status, kind === "hold" ? "RESERVED" : "SERVICE");
      }
    });
    await t.test("J09/J15 signature and expiry race never leaves a signed cancelled booking", async () => {
      // Deliberately disable identity policy for this additional synthetic booking
      // to prove serialisation is independent of the identity feature flag.
      process.env.IDENTITY_DOCUMENT_POLICIES_JSON = "{}";
      const next = await createPublicReservation({ ...input, idempotencyKey: randomUUID() }, "synthetic");
      const nextReference = next.reference!;
      assert.equal((await verifyPublicReservation(nextReference, smsCode)).ok, true);
      await startPublicEmailVerification(nextReference);
      assert.equal((await verifyPublicReservationEmail(nextReference, emailCode)).ok, true);
      const prepared = await preparePublicReservationLease(nextReference, "EFT"); assert.ok(prepared.ok);
      const view = await getPublicReservationLease(prepared.token); assert.ok(view);
      await Promise.allSettled([
        completePublicReservationLease(prepared.token, { signerName: "Synthetic race signer", initials: LEASE_CLAUSE_KEYS, signerIp: null, signerUserAgent: "CI", termsAccepted: true, acceptedSha256: view.sha256 }),
        releaseExpiredPublicReservations(new Date(Date.now() + 8 * 86400000)),
      ]);
      const after = await db.reservation.findUniqueOrThrow({ where: { publicReference: nextReference }, include: { publicLease: true, unit: true } });
      if (after.publicLease?.status === "SIGNED") {
        assert.equal(after.status, "ACTIVE"); assert.equal(after.unit.status, "RESERVED");
      } else {
        assert.equal(after.status, "CANCELLED"); assert.equal(after.unit.status, "AVAILABLE");
      }
    });
  } finally {
    transport.mock.restore();
    for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
    Object.assign(process.env, savedEnvironment);
    await db.$disconnect();
  }
});
