import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { walkInPhotoToken } from "../../src/lib/walk-in-policy";
import { activeWalkInPhoto } from "../../src/lib/walk-in-photo";
import { confirmReservationMoveIn, getReservationMoveInReadiness } from "../../src/lib/reservation-move-in";
import { submitTenantPhoto, tenantPhotoStatus } from "../../src/lib/facial-photo-service";
import { getMoveInProgress } from "../../src/lib/move-in-progress";
import { db } from "../../src/lib/db";
import { startWalkIn, redeemWalkIn, activeWalkIn, walkInView, endWalkIn } from "../../src/lib/walk-in-service";
import { createPublicReservation } from "../../src/lib/public-booking-service";
import { issueHikCentralFaceHandoff } from "../../src/lib/hikcentral-face-capture";
import { POST as publicPhoto } from "../../src/app/api/public/v1/legacy-photo-handoff/route";
import { POST as publicWalkIn } from "../../src/app/api/public/v1/walk-in/route";
test("isolated PostgreSQL tablet visit and booking boundaries", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED = "false";
  const key = randomUUID(), org = await db.organisation.create({ data: { name: "Walk-in CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key, publicSlug: key, publicBookingEnabled: true } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "CI staff", email: `${key}@example.invalid` } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "CI booking staff", permissions: ["reservations.manage", "move_in.create"] } });
  await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: facility.id } });
  const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI", features: [] } });
  const units = await Promise.all(["1", "2"].map(number => db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number, monthlyRate: "100.00" } })));
  const prepare = async () => { const v = await startWalkIn(scope, facility.id); return { v, launch: new URL(v.launchUrl).hash.slice("#launch=".length) }; };
  const input = (token: string, unitId: string, idempotencyKey = randomUUID()) => ({ walkInToken: token, facilitySlug: key, unitId, firstName: "Synthetic", lastName: "Visitor", email: `${randomUUID()}@example.invalid`, phone: "0000000000", journey: "RENTAL" as const, intendedMoveIn: new Date(), idempotencyKey, communicationConsent: { email: false, sms: false, phone: false, whatsapp: false } });
  try {
    await t.test("short-code guesses are rate limited by the forwarded tablet address", async () => {
      const oldKey = process.env.PUBLIC_BOOKING_API_KEY;
      process.env.PUBLIC_BOOKING_API_KEY = randomUUID() + randomUUID();
      const request = (ip: string, authorized = true) => new Request("https://portal.example.invalid/api/public/v1/walk-in", { method: "POST", headers: { "content-type": "application/json", "x-stor24-client-ip": ip, "x-stor24-public-key": authorized ? process.env.PUBLIC_BOOKING_API_KEY! : "wrong" }, body: JSON.stringify({ action: "redeem-code", token: "ZZZZZZZZ" }) });
      try {
        assert.equal((await publicWalkIn(request(key, false))).status, 401);
        for (let i = 0; i < 15; i++) assert.equal((await publicWalkIn(request(key))).status, 410);
        assert.equal((await publicWalkIn(request(key))).status, 429);
        assert.equal((await publicWalkIn(request(`${key}-other`))).status, 410);
      } finally { if (oldKey === undefined) delete process.env.PUBLIC_BOOKING_API_KEY; else process.env.PUBLIC_BOOKING_API_KEY = oldKey; }
    });
    await t.test("staff store scope and one-use launch remain enforced under races", async () => {
      await assert.rejects(startWalkIn({ ...scope, facilityIds: [] }, facility.id), /FORBIDDEN/);
      const { launch } = await prepare();
      const results = await Promise.allSettled([redeemWalkIn(launch), redeemWalkIn(launch)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected").length, 1);
    });
    await t.test("launch expiry and live staff permission revocation block redemption", async () => {
      const { v, launch } = await prepare();
      await db.walkInVisit.update({ where: { id: v.id }, data: { launchExpiresAt: new Date(0) } });
      await assert.rejects(redeemWalkIn(launch), /WALK_IN_UNAVAILABLE/);
      await assert.rejects(redeemWalkIn(v.visitCode, "code"), /WALK_IN_UNAVAILABLE/);
      const next = await prepare();
      await db.role.update({ where: { id: role.id }, data: { permissions: [] } });
      await assert.rejects(redeemWalkIn(next.launch), /WALK_IN_UNAVAILABLE/);
      await assert.rejects(redeemWalkIn(next.v.visitCode, "code"), /WALK_IN_UNAVAILABLE/);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["reservations.manage", "move_in.create"] } });
    });
    await t.test("QR and short code redeem the same visit exactly once, with correct store and no plaintext storage", async () => {
      const { v, launch } = await prepare();
      assert.match(v.qrDataUrl, /^data:image\/png;base64,/);
      const stored = await db.walkInVisit.findUniqueOrThrow({ where: { id: v.id } });
      assert.notEqual(stored.shortCodeHash, v.visitCode);
      const results = await Promise.allSettled([redeemWalkIn(v.visitCode.toLowerCase(), "code"), redeemWalkIn(launch)]);
      const winners = results.filter(r => r.status === "fulfilled");
      assert.equal(winners.length, 1);
      const winner = winners[0];
      if (winner.status === "fulfilled") assert.equal((await activeWalkIn(winner.value.token)).facilityId, facility.id);
      await assert.rejects(redeemWalkIn(v.visitCode, "code"), /WALK_IN_UNAVAILABLE/);
      await assert.rejects(redeemWalkIn(launch), /WALK_IN_UNAVAILABLE/);
      await assert.rejects(redeemWalkIn("ZZZZZZZZ", "code"), /WALK_IN_UNAVAILABLE/);
    });
    await t.test("tablet screens can distinguish visits with identical store and expiry", async () => {
      const first = await prepare(), second = await prepare();
      const firstSession = await redeemWalkIn(first.v.visitCode, "code"), secondSession = await redeemWalkIn(second.launch);
      const expiry = new Date(Date.now() + 3600000);
      await db.walkInVisit.updateMany({ where: { id: { in: [first.v.id, second.v.id] } }, data: { expiresAt: expiry } });
      const a = await walkInView(firstSession.token), b = await walkInView(secondSession.token);
      assert.equal(a.facilitySlug, b.facilitySlug); assert.equal(a.expiresAt, b.expiresAt);
      assert.equal(a.id, first.v.id); assert.equal(b.id, second.v.id); assert.notEqual(a.id, b.id);
    });
    await t.test("one visit creates one walk-in booking, rollback preserves units, clearing retains the booking", async () => {
      const { v, launch } = await prepare(), { token } = await redeemWalkIn(launch);
      await assert.rejects(createPublicReservation({ ...input(token, units[0].id), facilitySlug: "other" }, "ci"), /WALK_IN_UNAVAILABLE/);
      await assert.rejects(createPublicReservation({ ...input(token, units[0].id), storagePackageId: "missing" }, "ci"), /UNIT_UNAVAILABLE/);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: units[0].id } })).status, "AVAILABLE");
      assert.equal((await activeWalkIn(token)).reservationId, null);
      const request = input(token, units[0].id), booking = await createPublicReservation(request, "ci");
      const visit = await activeWalkIn(token), reservation = await db.reservation.findUniqueOrThrow({ where: { id: visit.reservationId! }, include: { lead: true } });
      assert.equal(reservation.source, "PUBLIC_WALK_IN"); assert.equal(reservation.lead?.assignedToId, user.id);
      assert.equal((await createPublicReservation(request, "ci")).reference, booking.reference);
      await assert.rejects(createPublicReservation(input(token, units[1].id), "ci"), /WALK_IN_UNAVAILABLE/);
      assert.equal(await db.reservation.count({ where: { facilityId: facility.id } }), 1);
      assert.equal((await walkInView(token)).photoStatus, null);
      const photoToken = walkInPhotoToken(visit.customerTokenHash!);
      process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = randomUUID();
      process.env.PUBLIC_BOOKING_API_KEY = randomUUID() + randomUUID();
      await db.facialPhotoControl.create({ data: { organisationId: org.id, controllerUserId: user.id, enabled: true } });
      await db.facialPhotoMaintenance.upsert({
        where: { id: "expiry" }, create: { id: "expiry", completedAt: new Date() }, update: { completedAt: new Date() },
      });
      const preparePhoto = () => issueHikCentralFaceHandoff(scope, { customerId: reservation.customerId, facilityId: facility.id, version: 0 }, { token: photoToken, expiresAt: visit.expiresAt });
      await preparePhoto();
      await preparePhoto();
      assert.equal(await db.hikCentralFaceHandoff.count({ where: { tokenHash: createHash("sha256").update(photoToken).digest("hex") } }), 1);
      function photoRequest(body: string | FormData) {
        return new Request("https://portal.example.invalid/api/public/v1/legacy-photo-handoff", {
          method: "POST",
          headers: {
            "x-stor24-client-ip": key,
            "x-stor24-public-key": process.env.PUBLIC_BOOKING_API_KEY!,
            "x-stor24-walk-in-photo-session": token,
            ...(typeof body === "string" ? { "content-type": "application/json" } : {}),
          },
          body,
        });
      }
      assert.equal((await publicPhoto(photoRequest("{}"))).status, 409);
      assert.equal((await walkInView(token)).photoStatus, "waiting-for-signature");
      await assert.rejects(activeWalkInPhoto(db, { session: token }), /PHOTO_CHANGED/);
      await db.publicReservationLease.create({ data: {
        reservationId: reservation.id, content: "Synthetic agreement", clauses: [], sha256: "synthetic",
        version: "test", paymentMethod: "EFT", signingToken: randomUUID(), expiresAt: visit.expiresAt,
        status: "SIGNED", signedAt: new Date(),
      } });
      assert.equal((await walkInView(token)).photoStatus, "ready");
      assert.equal(await activeWalkInPhoto(db, { session: token }), photoToken);
      await db.reservation.update({ where: { id: reservation.id }, data: { source: "PUBLIC_WEBSITE" } });
      await assert.rejects(activeWalkInPhoto(db, { session: token }), /PHOTO_CHANGED/);
      await db.reservation.update({ where: { id: reservation.id }, data: { source: "PUBLIC_WALK_IN", status: "CANCELLED" } });
      await assert.rejects(activeWalkInPhoto(db, { session: token }), /PHOTO_CHANGED/);
      await db.reservation.update({ where: { id: reservation.id }, data: { status: "ACTIVE" } });
      await assert.rejects(activeWalkInPhoto(db, { session: token, expectedPhotoToken: "wrong" }), /PHOTO_CHANGED/);
      const other = await prepare();
      await assert.rejects(activeWalkInPhoto(db, { session: (await redeemWalkIn(other.launch)).token }), /PHOTO_CHANGED/);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["reservations.manage"] } });
      assert.equal((await publicPhoto(photoRequest("{}"))).status, 403);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["reservations.manage", "move_in.create"] } });
      const standalone = photoRequest(JSON.stringify({ token: photoToken }));
      standalone.headers.delete("x-stor24-walk-in-photo-session");
      assert.notEqual((await publicPhoto(standalone)).status, 200);
      const details = await publicPhoto(photoRequest("{}"));
      assert.equal(details.status, 200);
      const { data: { policyHash } } = await details.json();
      assert.equal(typeof policyHash, "string");
      const image = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#EF5E00" } }).jpeg().toBuffer();
      function photoForm(consent: boolean) {
        const form = new FormData();
        form.set("image", new File([new Uint8Array(image)], "synthetic.jpg", { type: "image/jpeg" }));
        form.set("policyHash", policyHash);
        if (consent) form.set("consent", "on");
        return form;
      }
      assert.equal((await publicPhoto(photoRequest(photoForm(false)))).status, 409);
      assert.equal((await publicPhoto(photoRequest(photoForm(true)))).status, 201);
      const saved = await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: reservation.customerId } });
      assert.equal(saved.status, "WAITING_REVIEW");
      assert.ok(saved.encryptedImage);
      assert.equal((await walkInView(token)).photoStatus, "saved");
      assert.equal((await publicPhoto(photoRequest(photoForm(true)))).status, 409);
      await assert.rejects(activeWalkInPhoto(db, { session: token }), /PHOTO_CHANGED/);
      await Promise.all([endWalkIn(token), endWalkIn(token)]);
      await assert.rejects(activeWalkIn(token), /WALK_IN_UNAVAILABLE/);
      await assert.rejects(activeWalkInPhoto(db, { session: token }), /PHOTO_CHANGED/);
      assert.equal((await publicPhoto(photoRequest("{}"))).status, 409);
      assert.equal((await db.walkInVisit.findUniqueOrThrow({ where: { id: v.id } })).status, "CLOSED");
      assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, "ACTIVE");
      assert.equal(await db.auditEvent.count({ where: { entityId: v.id, action: "walk_in.tablet_cleared" } }), 1);
      assert.equal(await db.payment.count({ where: { account: { customer: { organisationId: org.id } } } }), 0);
      assert.equal(await db.tenancy.count({ where: { facilityId: facility.id } }), 0);
      const photoBlocker = /tablet visit must be reviewed and accepted by HikCentral/;
      const readiness = () => getReservationMoveInReadiness(scope, reservation.id);
      const progress = () => getMoveInProgress(scope, reservation.id);
      assert.match((await readiness()).blockers.join(" "), photoBlocker);
      assert.equal((await progress()).photoStatus, "WAITING_REVIEW");
      const tenant = { organisationId: org.id, customerIds: [reservation.customerId], email: request.email };
      await db.customer.update({ where: { id: reservation.customerId }, data: { emailVerifiedAt: new Date() } });
      assert.deepEqual(await tenantPhotoStatus(tenant, reservation.id), { available: false, policy: null, photo: null, counterPhotoStatus: "WAITING_REVIEW" });
      await assert.rejects(submitTenantPhoto(tenant, { reservationId: reservation.id, consent: true, policyHash,
        expectedVersion: 0, image: new File([new Uint8Array(image)], "synthetic.jpg", { type: "image/jpeg" }),
      }), /PHOTO_COUNTER_VISIT_REQUIRED/);
      await assert.rejects(confirmReservationMoveIn(scope, reservation.id), /MOVE_IN_NOT_READY/);

      // The provider suite exercises the actual preview/send/readback. Seed its accepted result on the photo uploaded above.
      const personId = "CI-HIKCENTRAL-PERSON";
      await db.integrationIdentityLink.create({ data: { organisationId: org.id, customerId: reservation.customerId, hikCentralPersonId: personId, status: "ACTIVE" } });
      const approvedAt = new Date();
      await db.hikCentralFaceCapture.update({ where: { id: saved.id }, data: {
        personId, status: "PROVIDER_ACCEPTED", encryptedImage: null, erasedAt: approvedAt, reviewedAt: approvedAt, providerAcceptedAt: approvedAt,
      } });
      assert.equal((await progress()).photoReviewed, true);
      assert.doesNotMatch((await readiness()).blockers.join(" "), photoBlocker);
      assert.equal((await readiness()).paymentVerified, false);

      const signedPdf = Buffer.from("Synthetic signed agreement PDF");
      await db.publicReservationLease.update({ where: { reservationId: reservation.id }, data: {
        signedPdf, signedPdfSha256: createHash("sha256").update(signedPdf).digest("hex"),
        sha256: createHash("sha256").update("Synthetic agreement").digest("hex"),
      } });
      const amount = (await readiness()).requiredAmount;
      assert.ok(amount > 0);
      const account = await db.account.create({ data: { accountNumber: `ST24-T-${reservation.id}`, customerId: reservation.customerId, balance: -amount } });
      const receiptKey = randomUUID();
      await db.payment.create({ data: { accountId: account.id, amount, method: "EFT", status: "SUCCEEDED", processedAt: new Date(), idempotencyKey: receiptKey } });
      await db.ledgerEntry.create({ data: { accountId: account.id, amount, type: "PAYMENT", description: "Synthetic receipt", effectiveAt: new Date(), externalRef: receiptKey, createdById: user.id } });
      for (const changed of [{ version: saved.version + 1 }, { facilityId: "another-store" }, { status: "PROVIDER_REMOVED" }]) {
        await db.hikCentralFaceCapture.update({ where: { id: saved.id }, data: changed });
        assert.match((await readiness()).blockers.join(" "), photoBlocker);
        await assert.rejects(confirmReservationMoveIn(scope, reservation.id), /MOVE_IN_NOT_READY/);
        await db.hikCentralFaceCapture.update({ where: { id: saved.id }, data: { version: saved.version, facilityId: facility.id, status: "PROVIDER_ACCEPTED" } });
      }
      await db.integrationIdentityLink.update({ where: { customerId: reservation.customerId }, data: { hikCentralPersonId: "other-person" } });
      assert.match((await readiness()).blockers.join(" "), photoBlocker);
      await db.integrationIdentityLink.update({ where: { customerId: reservation.customerId }, data: { hikCentralPersonId: personId } });

      assert.equal((await readiness()).ready, true);
      const handover = await confirmReservationMoveIn(scope, reservation.id);
      assert.equal(handover.idempotent, false);
      assert.equal((await confirmReservationMoveIn(scope, reservation.id)).idempotent, true);
      assert.equal(await db.facialPhotoSubmission.count({ where: { reservationId: reservation.id } }), 0);
      const evidence = await db.auditEvent.findFirstOrThrow({ where: { entityId: handover.tenancyId, action: "tenancy.key_handover_confirmed" } });
      assert.equal((evidence.after as { hikCentralPhotoId?: string }).hikCentralPhotoId, saved.id);
      assert.equal((await progress()).photoReviewed, true);

    });
  } finally { await db.$disconnect(); }
});
