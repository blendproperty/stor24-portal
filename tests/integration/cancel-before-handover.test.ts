import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { cancelBeforeHandover } from "../../src/lib/cancel-before-handover";
import { db } from "../../src/lib/db";
import { cancelReservation, expireReservation } from "../../src/lib/leasing-service";

test("signed booking cancellation preserves evidence and protects money, access and competing holds", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  try {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Synthetic", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic", code: key } });
    const staff = await db.user.create({ data: { organisationId: org.id, name: "Synthetic", email: `${key}@example.invalid` } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic" } });
    const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "Synthetic", features: [] } });
    const scope = { organisationId: org.id, userId: staff.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    const unitData = { facilityId: facility.id, unitTypeId: unitType.id, monthlyRate: 825, status: "RESERVED" as const };
    const unit = await db.unit.create({ data: { ...unitData, number: "043" } });
    const lead = await db.lead.create({ data: { facilityId: facility.id, customerId: customer.id, source: "Synthetic", stage: "RESERVED", nextActionAt: new Date() } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, startDate: new Date(),
      occupancies: { create: { unitId: unit.id, startDate: new Date(), monthlyRate: 825 } },
    }, include: { occupancies: true } });
    const document = await db.document.create({ data: { tenancyId: tenancy.id, type: "LEASE_AGREEMENT", status: "SIGNED", signedAt: new Date(), provider: "BLENDSIGN", externalId: key, storageKey: key } });
    const bookingData = { facilityId: facility.id, customerId: customer.id, quotedRate: 825 };
    const booking = await db.reservation.create({ data: { ...bookingData, unitId: unit.id, leadId: lead.id, convertedTenancyId: tenancy.id, status: "CONVERTED" } });
    const receipt = await db.payment.create({ data: { accountId: account.id, amount: 990, method: "EFT", idempotencyKey: key, status: "SUCCEEDED" } });
    const reason = "Synthetic receipt entered in error";
    await assert.rejects(cancelBeforeHandover({ ...scope, facilityIds: [] }, booking.id, reason), /NOT_FOUND/);
    await assert.rejects(cancelBeforeHandover(scope, booking.id, reason), /CANCEL_HANDOVER_FINANCE/);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: booking.id } })).status, "CONVERTED");

    await db.payment.update({ where: { id: receipt.id }, data: { status: "REVERSED" } });
    await db.account.update({ where: { id: account.id }, data: { balance: 990 } });
    await assert.rejects(cancelBeforeHandover(scope, booking.id, reason), /CANCEL_HANDOVER_FINANCE/);
    await db.account.update({ where: { id: account.id }, data: { balance: 0 } });
    const occupancy = tenancy.occupancies[0];
    await db.occupancy.update({ where: { id: occupancy.id }, data: { accessState: "ACTIVE" } });
    await assert.rejects(cancelBeforeHandover(scope, booking.id, reason), /CANCEL_HANDOVER_STATE/);
    await db.occupancy.update({ where: { id: occupancy.id }, data: { accessState: "PENDING" } });
    await Promise.all([cancelBeforeHandover(scope, booking.id, reason), cancelBeforeHandover(scope, booking.id, reason)]);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: booking.id } })).status, "CANCELLED");
    assert.equal((await db.tenancy.findUniqueOrThrow({ where: { id: tenancy.id } })).status, "CANCELLED");
    const cancelledOccupancy = await db.occupancy.findUniqueOrThrow({ where: { id: occupancy.id } });
    assert.equal(cancelledOccupancy.status, "CANCELLED");
    assert.equal(cancelledOccupancy.accessState, "REVOKED");
    assert.equal((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "AVAILABLE");
    const closedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(closedLead.stage, "LOST");
    assert.equal(closedLead.lossReason, reason);
    assert.equal(closedLead.nextActionAt, null);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: document.id } })).status, "SIGNED");
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: receipt.id } })).status, "REVERSED");
    assert.equal(await db.auditEvent.count({ where: { entityId: booking.id, action: "reservation.cancelled_before_handover" } }), 1);

    const otherUnit = await db.unit.create({ data: { ...unitData, number: "044" } });
    const otherLead = await db.lead.create({ data: { facilityId: facility.id, customerId: customer.id, source: "Synthetic", stage: "RESERVED" } });
    const publicBooking = await db.reservation.create({ data: { ...bookingData, unitId: otherUnit.id, leadId: otherLead.id, holdExpiresAt: new Date(0), publicLease: { create: {
      status: "SIGNED", signedAt: new Date(), signedPdfSha256: "synthetic", version: "test", paymentMethod: "EFT", content: "Synthetic", clauses: [], sha256: "synthetic", signingToken: key, expiresAt: new Date(),
    } } } });
    await assert.rejects(cancelReservation(scope, publicBooking.id), /SIGNED_RESERVATION_REQUIRES_HANDOVER/);
    await assert.rejects(expireReservation(scope, publicBooking.id, reason), /SIGNED_RESERVATION_REQUIRES_HANDOVER/);
    await db.reservation.create({ data: { ...bookingData, unitId: otherUnit.id, leadId: otherLead.id } });
    await cancelBeforeHandover(scope, publicBooking.id, reason);
    assert.equal((await db.publicReservationLease.findUniqueOrThrow({ where: { reservationId: publicBooking.id } })).status, "SIGNED");
    assert.equal((await db.unit.findUniqueOrThrow({ where: { id: otherUnit.id } })).status, "RESERVED");
    assert.equal((await db.lead.findUniqueOrThrow({ where: { id: otherLead.id } })).stage, "RESERVED");
  } finally {
    await db.$disconnect();
  }
});
