import { seedApprovedPhoto } from "./helpers/approved-photo";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../../src/lib/db";
import { identityPolicy, newIdentityAccess } from "../../src/lib/identity-document-security";
import { expireIdentityDocuments, identityGate, identityStatus, listIdentityDocuments, previewIdentity, reviewIdentity, submitIdentity, withdrawIdentity } from "../../src/lib/identity-document-service";
import { preparePublicReservationLease, completePublicReservationLease, publicReservationHasSignedLease } from "../../src/lib/public-lease-workflow";
import { LEASE_CLAUSE_KEYS } from "../../src/lib/lease-agreement-content";
import { confirmReservationMoveIn } from "../../src/lib/reservation-move-in";
import { verifyPublicReservationEmail } from "../../src/lib/public-booking-service";
test("isolated PostgreSQL private identity workflow", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "ci-identity-key-never-for-production";
  const image = new File([new Uint8Array(await sharp({ create: { width: 600, height: 800, channels: 3, background: "#889988" } }).png().toBuffer())], "synthetic.png", { type: "image/png" });
  await expireIdentityDocuments();
  async function fixture() {
    const key = randomUUID(), access = newIdentityAccess();
    const org = await db.organisation.create({ data: { name: "CI identity only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key } });
    const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "CI reviewer" } });
    const customer = await db.customer.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, emailVerifiedAt: new Date() } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: key, features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: key, monthlyRate: 100, status: "RESERVED" } });
    const booking = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: new Date(), publicReference: `ST24-${key}`, contactVerifiedAt: new Date(), holdExpiresAt: new Date(Date.now() + 86400000), identityAccessHash: access.identityAccessHash, identityAccessExpiresAt: access.identityAccessExpiresAt } });
    process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify({ ...JSON.parse(process.env.IDENTITY_DOCUMENT_POLICIES_JSON ?? "{}"), [org.id]: { enabled: true, fullCopyApproved: true, effectiveFrom: "2026-01-01T00:00:00Z", version: "CI", approvalReference: "Synthetic only", notice: "Synthetic test fixture only, not an approved legal notice or real identity record.", acknowledgementLabel: "Synthetic acknowledgement only", retentionHours: 24, acceptedTypes: ["ID_CARD", "PASSPORT"], alternativeContact: "Training store" } });
    const scope = { userId: user.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    const input = { expectedVersion: 0, policyHash: identityPolicy(org.id)!.hash, acknowledged: true, documentType: "ID_CARD", pages: [image, image] };
    return { org, facility, user, customer, booking, scope, input, reference: booking.publicReference!, token: access.token };
  }
  try {
    await t.test("booking-filtered review retains organisation and facility isolation", async () => {
      const f = await fixture(), other = await fixture();
      await submitIdentity(f.reference, f.token, f.input);
      await submitIdentity(other.reference, other.token, other.input);
      const selected = await listIdentityDocuments(f.scope, f.booking.id);
      assert.equal(selected.length, 1);
      assert.equal(selected[0].reservation.publicReference, f.reference);
      assert.deepEqual(await listIdentityDocuments(f.scope, other.booking.id), []);
      assert.deepEqual(await listIdentityDocuments({ ...f.scope, facilityIds: [] }, f.booking.id), []);
      assert.deepEqual(await listIdentityDocuments(f.scope, "not-a-booking"), []);
      assert.equal((await listIdentityDocuments(f.scope)).length, 1);
    });
    await t.test("account pilot follows verified email across new customers and units through signing", async () => {
      const f = await fixture();
      const policies = JSON.parse(process.env.IDENTITY_DOCUMENT_POLICIES_JSON!);
      policies[f.org.id].customerEmailHashes = [createHash("sha256").update(f.customer.email!.trim().toLowerCase()).digest("hex")];
      process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify(policies);
      async function nextBooking(email: string) {
        const grant = newIdentityAccess();
        const customer = await db.customer.create({ data: { organisationId: f.org.id, email, emailVerifiedAt: new Date() } });
        const unit = await db.unit.create({ data: { facilityId: f.facility.id, unitTypeId: (await db.unit.findUniqueOrThrow({ where: { id: f.booking.unitId } })).unitTypeId, number: randomUUID(), monthlyRate: 100, status: "RESERVED" } });
        const booking = await db.reservation.create({ data: { facilityId: f.facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: new Date(), publicReference: `ST24-${randomUUID()}`, contactVerifiedAt: new Date(), holdExpiresAt: new Date(Date.now() + 86400000), identityAccessHash: grant.identityAccessHash, identityAccessExpiresAt: grant.identityAccessExpiresAt } });
        return { customer, booking, reference: booking.publicReference!, token: grant.token };
      }
      const next = await nextBooking(f.customer.email!), other = await nextBooking(`${randomUUID()}@example.invalid`);
      assert.notEqual(next.customer.id, f.customer.id); assert.notEqual(next.booking.unitId, f.booking.unitId);
      assert.equal((await identityStatus(f.reference, f.token)).required, true);
      assert.equal((await identityStatus(next.reference, next.token)).required, true);
      assert.equal((await identityStatus(other.reference, other.token)).required, false);
      await assert.rejects(identityStatus(next.reference, f.token), /ID_SESSION_REQUIRED/);
      await db.customer.update({ where: { id: next.customer.id }, data: { emailVerifiedAt: null } });
      await assert.rejects(identityStatus(next.reference, next.token), /ID_BOOKING_UNAVAILABLE/);
      await db.customer.update({ where: { id: next.customer.id }, data: { emailVerifiedAt: new Date() } });
      const input = { ...f.input, policyHash: identityPolicy(f.org.id)!.hash };
      await assert.rejects(submitIdentity(other.reference, other.token, input), /ID_POLICY_UNAVAILABLE/);
      assert.equal((await preparePublicReservationLease(next.reference, "CARD")).ok, false);
      await submitIdentity(next.reference, next.token, input);
      const prepared = await preparePublicReservationLease(next.reference, "CARD"); assert.ok(prepared.ok); if (!prepared.ok) return;
      assert.equal(await publicReservationHasSignedLease(next.reference), null);
      const lease = await db.publicReservationLease.findUniqueOrThrow({ where: { reservationId: next.booking.id } });
      const appUrl = process.env.APP_URL; delete process.env.APP_URL; // Prevent any welcome-email provider call from a synthetic signature.
      try { await completePublicReservationLease(prepared.token, { signerName: "Synthetic Tester", initials: [...LEASE_CLAUSE_KEYS], signerIp: null, signerUserAgent: null, termsAccepted: true, acceptedSha256: lease.sha256 }); }
      finally { if (appUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = appUrl; }
      assert.ok(await publicReservationHasSignedLease(next.reference));
      assert.equal(await identityGate(db, f.org.id, next.booking.id, next.booking.createdAt, "HANDOVER"), false);
      const document = await db.identityDocument.findUniqueOrThrow({ where: { reservationId: next.booking.id } });
      await previewIdentity(f.scope, document.id, 1, 0); await previewIdentity(f.scope, document.id, 1, 1); await reviewIdentity(f.scope, document.id, 1, "ACCEPT");
      assert.equal(await identityGate(db, f.org.id, next.booking.id, next.booking.createdAt, "HANDOVER"), true);
    });
    await t.test("production pilot applies only to selected bookings in the same organisation", async () => {
      const f = await fixture(), secondAccess = newIdentityAccess();
      const second = await db.reservation.create({ data: { facilityId: f.facility.id, customerId: f.customer.id, unitId: f.booking.unitId, quotedRate: 100, intendedMoveIn: new Date(), publicReference: `ST24-${randomUUID()}`, contactVerifiedAt: new Date(), holdExpiresAt: new Date(Date.now() + 86400000), identityAccessHash: secondAccess.identityAccessHash, identityAccessExpiresAt: secondAccess.identityAccessExpiresAt } });
      const policies = JSON.parse(process.env.IDENTITY_DOCUMENT_POLICIES_JSON!);
      policies[f.org.id].reservationIds = [f.booking.id];
      process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify(policies);
      const input = { ...f.input, policyHash: identityPolicy(f.org.id)!.hash };
      assert.equal((await identityStatus(f.reference, f.token)).required, true);
      const unaffected = await identityStatus(second.publicReference!, secondAccess.token);
      assert.equal(unaffected.required, false); assert.equal(unaffected.canContinue, true); assert.equal(unaffected.policy, null);
      await assert.rejects(submitIdentity(second.publicReference!, secondAccess.token, input), /ID_POLICY_UNAVAILABLE/);
      assert.equal(await identityGate(db, f.org.id, second.id, second.createdAt, "SIGN"), true);
      assert.equal(await identityGate(db, f.org.id, second.id, second.createdAt, "HANDOVER"), true);
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "SIGN"), false);
      const document = await submitIdentity(f.reference, f.token, input);
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "SIGN"), true);
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "HANDOVER"), false);
      await previewIdentity(f.scope, document.id, 1, 0); await previewIdentity(f.scope, document.id, 1, 1);
      await reviewIdentity(f.scope, document.id, 1, "ACCEPT");
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "HANDOVER"), true);
      policies[f.org.id].reservationIds = [second.id];
      process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify(policies);
      await assert.rejects(previewIdentity(f.scope, document.id, 1, 0), /ID_CHANGED/);
      await assert.rejects(reviewIdentity(f.scope, document.id, 1, "ACCEPT"), /ID_CHANGED/);
      await assert.rejects(submitIdentity(f.reference, f.token, input), /ID_POLICY_UNAVAILABLE/);
    });
    for (const [retentionMode, endStatus] of [["FIXED_PERIOD", "CLOSED"], ["TENANCY", "CLOSED"], ["TENANCY", "CANCELLED"]] as const) await t.test(`upload, actual handover and ${retentionMode} retention until ${endStatus}`, async () => {
      const f = await fixture();
      if (retentionMode === "TENANCY") {
        const policies = JSON.parse(process.env.IDENTITY_DOCUMENT_POLICIES_JSON!);
        policies[f.org.id].retentionMode = "TENANCY"; delete policies[f.org.id].retentionHours;
        process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify(policies);
        f.input.policyHash = identityPolicy(f.org.id)!.hash;
      }
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "SIGN"), false);
      const blocked = await preparePublicReservationLease(f.reference, "EFT");
      assert.equal(blocked.ok, false); if (!blocked.ok) assert.equal(blocked.code, "IDENTITY_REQUIRED");
      const document = await submitIdentity(f.reference, f.token, f.input);
      const prepared = await preparePublicReservationLease(f.reference, "EFT"); assert.equal(prepared.ok, true);
      const content = "Synthetic signed agreement", pdf = Buffer.from("synthetic-pdf");
      await db.publicReservationLease.update({ where: { reservationId: f.booking.id }, data: { status: "SIGNED", content, sha256: createHash("sha256").update(content).digest("hex"), signedAt: new Date(), signedPdf: pdf, signedPdfSha256: createHash("sha256").update(pdf).digest("hex") } });
      await db.reservation.update({ where: { id: f.booking.id }, data: { holdExpiresAt: new Date(0) } });
      assert.equal((await identityStatus(f.reference, f.token)).canContinue, true);
      const account = await db.account.create({ data: { customerId: f.customer.id, accountNumber: `ST24-T-${f.booking.id}`, balance: -100 } });
      const key = randomUUID();
      await db.payment.create({ data: { accountId: account.id, amount: 100, method: "EFT", status: "SUCCEEDED", processedAt: new Date(), idempotencyKey: key } });
      await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: 100, description: "Synthetic receipt", effectiveAt: new Date(), externalRef: key, createdById: f.user.id } });
      await assert.rejects(confirmReservationMoveIn(f.scope, f.booking.id), /MOVE_IN_NOT_READY/);
      assert.equal(document.status, "AWAITING_REVIEW");
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "SIGN"), true);
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "HANDOVER"), false);
      assert.equal(JSON.stringify(await identityStatus(f.reference, f.token)).includes("encryptedPages"), false);
      assert.equal(JSON.stringify(await listIdentityDocuments(f.scope)).includes("encryptedPages"), false);
      await assert.rejects(reviewIdentity(f.scope, document.id, 1, "ACCEPT"), /ID_PREVIEW_REQUIRED/);
      assert.ok((await previewIdentity(f.scope, document.id, 1, 0)).length > 100);
      await assert.rejects(reviewIdentity(f.scope, document.id, 1, "ACCEPT"), /ID_PREVIEW_REQUIRED/);
      await previewIdentity(f.scope, document.id, 1, 1);
      await reviewIdentity(f.scope, document.id, 1, "ACCEPT");
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "HANDOVER"), true);
      await seedApprovedPhoto(f.org.id, f.booking.id, f.scope.userId);
      const moved = await confirmReservationMoveIn(f.scope, f.booking.id); assert.ok(moved.tenancyId);
      await expireIdentityDocuments();
      const retained = await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } });
      if (retentionMode === "FIXED_PERIOD") { assert.equal(retained.encryptedPages, null); return; }
      assert.equal(retained.retentionMode, "TENANCY"); assert.equal(retained.expiresAt, null); assert.ok(retained.encryptedPages);
      assert.ok((await previewIdentity(f.scope, document.id, 1, 0)).length > 100);
      await assert.rejects(reviewIdentity(f.scope, document.id, 1, "REPLACE", "Document is incomplete"), /ID_CHANGED/);
      await db.tenancy.update({ where: { id: moved.tenancyId }, data: { status: "NOTICE_GIVEN", endDate: new Date(0) } });
      await db.identityDocument.update({ where: { id: document.id }, data: { acknowledgedAt: new Date(0) } });
      await expireIdentityDocuments();
      assert.ok((await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } })).encryptedPages);
      assert.ok((await previewIdentity(f.scope, document.id, 1, 0)).length > 100);
      const other = await fixture(); await assert.rejects(previewIdentity(other.scope, document.id, 1, 0), /NOT_FOUND/);
      await db.tenancy.update({ where: { id: moved.tenancyId }, data: { status: endStatus } });
      await assert.rejects(previewIdentity(f.scope, document.id, 1, 0), /ID_CHANGED/);
      await expireIdentityDocuments();
      const erased = await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } });
      assert.equal(erased.encryptedPages, null); assert.ok(erased.erasedAt); assert.equal(erased.status, "ACCEPTED");
    });
    await t.test("tenancy copies expire for cancelled and abandoned bookings, old copies are never extended", async () => {
      for (const cancelled of [true, false]) {
        const f = await fixture();
        const policies = JSON.parse(process.env.IDENTITY_DOCUMENT_POLICIES_JSON!);
        policies[f.org.id].retentionMode = "TENANCY"; delete policies[f.org.id].retentionHours;
        process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify(policies);
        const document = await submitIdentity(f.reference, f.token, { ...f.input, policyHash: identityPolicy(f.org.id)!.hash });
        assert.equal(document.expiresAt, null); assert.equal((await identityStatus(f.reference, f.token)).canContinue, true);
        await db.reservation.update({ where: { id: f.booking.id }, data: cancelled ? { status: "CANCELLED" } : { holdExpiresAt: new Date(0) } });
        await expireIdentityDocuments();
        assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } })).encryptedPages, null);
      }
      const f = await fixture(), document = await submitIdentity(f.reference, f.token, f.input);
      const policies = JSON.parse(process.env.IDENTITY_DOCUMENT_POLICIES_JSON!);
      policies[f.org.id].retentionMode = "TENANCY"; delete policies[f.org.id].retentionHours;
      process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify(policies);
      await db.identityDocument.update({ where: { id: document.id }, data: { expiresAt: new Date(0) } });
      await expireIdentityDocuments();
      assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } })).encryptedPages, null);
      await assert.rejects(db.identityDocument.update({ where: { id: document.id }, data: { expiresAt: null } }));
    });
    await t.test("an already prepared signing link cannot bypass a withdrawn ID", async () => {
      const f = await fixture(); await submitIdentity(f.reference, f.token, f.input);
      const prepared = await preparePublicReservationLease(f.reference, "EFT"); assert.ok(prepared.ok); if (!prepared.ok) return;
      const lease = await db.publicReservationLease.findUniqueOrThrow({ where: { reservationId: f.booking.id } });
      await withdrawIdentity(f.reference, f.token, 1);
      await assert.rejects(completePublicReservationLease(prepared.token, { signerName: "Synthetic Customer", initials: [...LEASE_CLAUSE_KEYS], signerIp: null, signerUserAgent: null, termsAccepted: true, acceptedSha256: lease.sha256 }), /IDENTITY_REQUIRED/);
      assert.equal((await db.publicReservationLease.findUniqueOrThrow({ where: { id: lease.id } })).status, "READY");
    });
    await t.test("reference alone, another booking token and another facility cannot read or mutate", async () => {
      const f = await fixture(), other = await fixture();
      await assert.rejects(identityStatus(f.reference, ""), /ID_SESSION_REQUIRED/);
      await assert.rejects(submitIdentity(f.reference, other.token, f.input), /ID_SESSION_REQUIRED/);
      const document = await submitIdentity(f.reference, f.token, f.input);
      await assert.rejects(previewIdentity(other.scope, document.id, 1, 0), /NOT_FOUND/);
      await assert.rejects(previewIdentity({ ...f.scope, facilityIds: [] }, document.id, 1, 0), /NOT_FOUND/);
      await assert.rejects(reviewIdentity(other.scope, document.id, 1, "REPLACE", "Document is incomplete"), /NOT_FOUND/);
      assert.deepEqual(await listIdentityDocuments(other.scope), []);
    });
    await t.test("concurrent replacements have one winner and invalidate prior review", async () => {
      const f = await fixture(), document = await submitIdentity(f.reference, f.token, f.input);
      await previewIdentity(f.scope, document.id, 1, 0); await previewIdentity(f.scope, document.id, 1, 1); await reviewIdentity(f.scope, document.id, 1, "ACCEPT");
      const results = await Promise.allSettled([submitIdentity(f.reference, f.token, { ...f.input, expectedVersion: 1 }), submitIdentity(f.reference, f.token, { ...f.input, expectedVersion: 1 })]);
      assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "HANDOVER"), false);
      await assert.rejects(reviewIdentity(f.scope, document.id, 1, "ACCEPT"), /ID_CHANGED/);
      await assert.rejects(reviewIdentity(f.scope, document.id, 2, "ACCEPT"), /ID_PREVIEW_REQUIRED/);
    });
    await t.test("rejection and withdrawal erase copies and block signing", async () => {
      const f = await fixture(), document = await submitIdentity(f.reference, f.token, f.input);
      await reviewIdentity(f.scope, document.id, 1, "REPLACE", "Document is incomplete");
      assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } })).encryptedPages, null);
      assert.equal((await identityStatus(f.reference, f.token)).canContinue, false);
      await submitIdentity(f.reference, f.token, { ...f.input, expectedVersion: 1 });
      await withdrawIdentity(f.reference, f.token, 2);
      assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } })).encryptedPages, null);
    });
    await t.test("expiry removes a pending copy; accepted review survives copy retention", async () => {
      const f = await fixture(), document = await submitIdentity(f.reference, f.token, f.input);
      await db.identityDocument.update({ where: { id: document.id }, data: { expiresAt: new Date(0) } });
      await assert.rejects(previewIdentity(f.scope, document.id, 1, 0), /ID_CHANGED/);
      await expireIdentityDocuments();
      assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: document.id } })).encryptedPages, null);
      assert.equal(await identityGate(db, f.org.id, f.booking.id, f.booking.createdAt, "SIGN"), false);
      const g = await fixture(), accepted = await submitIdentity(g.reference, g.token, g.input);
      await previewIdentity(g.scope, accepted.id, 1, 0); await previewIdentity(g.scope, accepted.id, 1, 1); await reviewIdentity(g.scope, accepted.id, 1, "ACCEPT");
      await db.identityDocument.update({ where: { id: accepted.id }, data: { expiresAt: new Date(0) } }); await expireIdentityDocuments();
      assert.equal(await identityGate(db, g.org.id, g.booking.id, g.booking.createdAt, "HANDOVER"), true);
      assert.equal((await db.identityDocument.findUniqueOrThrow({ where: { id: accepted.id } })).encryptedPages, null);
    });
    await t.test("legal hold, outdated notice, missing pages and expired maintenance cannot collect", async () => {
      const f = await fixture();
      await assert.rejects(submitIdentity(f.reference, f.token, { ...f.input, policyHash: "old" }), /ID_NOTICE_REQUIRED/);
      await assert.rejects(submitIdentity(f.reference, f.token, { ...f.input, pages: [image] }), /ID_INVALID/);
      await db.identityDocumentMaintenance.update({ where: { id: "expiry" }, data: { completedAt: new Date(0) } });
      await assert.rejects(submitIdentity(f.reference, f.token, f.input), /ID_MAINTENANCE_REQUIRED/); await expireIdentityDocuments();
      const policies = process.env.IDENTITY_DOCUMENT_POLICIES_JSON; delete process.env.IDENTITY_DOCUMENT_POLICIES_JSON;
      assert.equal((await identityStatus(f.reference, f.token)).canContinue, true);
      await assert.rejects(submitIdentity(f.reference, f.token, f.input), /ID_POLICY_UNAVAILABLE/);
      process.env.IDENTITY_DOCUMENT_POLICIES_JSON = policies;
    });
    await t.test("a fresh email challenge rotates the booking grant and cannot be replayed", async () => {
      const f = await fixture(); process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED = "true"; process.env.PUBLIC_BOOKING_API_KEY = "synthetic-public-booking-key-for-ci-only";
      const hash = createHash("sha256").update(`${process.env.PUBLIC_BOOKING_API_KEY}:${f.booking.id}:email:123456`).digest("hex");
      await db.reservation.update({ where: { id: f.booking.id }, data: { verificationCodeHash: hash, verificationExpiresAt: new Date(Date.now() + 600000) } });
      const result = await verifyPublicReservationEmail(f.reference, "123456");
      assert.ok(result.ok); if (!result.ok) throw new Error("challenge failed");
      assert.ok(result.identityAccessToken);
      await assert.rejects(identityStatus(f.reference, f.token), /ID_SESSION_REQUIRED/);
      assert.equal((await identityStatus(f.reference, result.identityAccessToken)).required, true);
      assert.equal((await verifyPublicReservationEmail(f.reference, "123456")).ok, false);
    });
  } finally { delete process.env.IDENTITY_DOCUMENT_POLICIES_JSON; await db.$disconnect(); }
});
