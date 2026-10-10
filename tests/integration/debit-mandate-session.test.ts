import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { prepareStaffMandateSession, readStaffMandateSession } from "../../src/lib/debit-mandate-session";
import { requestPublicDebitOrderSetup } from "../../src/lib/public-debit-order-request";
import { tenantCustomerScope } from "../../src/lib/tenant-portal-security";

test("isolated staff mandate sessions bind one signed lease and never simulate a bank mandate", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const suffix = randomUUID();
  const org = await db.organisation.create({ data: { name: "Mandate CI", slug: suffix } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: suffix, name: "CI store" } });
  const user = await db.user.create({ data: { organisationId: org.id, email: `${suffix}@example.invalid`, name: "CI staff" } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "CI", lastName: "Customer", email: `${suffix}-customer@example.invalid`, emailVerifiedAt: new Date() } });
  const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "CI", features: [] } });
  const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: "CI", monthlyRate: 1000 } });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `MANDATE-${suffix}` } });
  const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, paymentMethod: "DEBIT_ORDER", startDate: new Date("2099-01-01"), occupancies: { create: { unitId: unit.id, startDate: new Date("2099-01-01"), monthlyRate: 1000 } } } });
  const document = await db.document.create({ data: { tenancyId: tenancy.id, type: "LEASE_AGREEMENT", status: "PENDING", storageKey: "ci-only", provider: "BLENDSIGN", externalId: `CI-${suffix}` } });
  const scope = { userId: user.id, organisationId: org.id, unrestrictedFacilities: false, facilityIds: [facility.id] };
  try {
    await t.test("unsigned, wrong-store and wrong-customer requests cannot prepare a session", async () => {
      await assert.rejects(prepareStaffMandateSession(scope, document.id), /MANDATE_BOOKING_UNAVAILABLE/);
      await db.document.update({ where: { id: document.id }, data: { status: "SIGNED", signedAt: new Date() } });
      await assert.rejects(prepareStaffMandateSession({ ...scope, facilityIds: [] }, document.id), /NOT_FOUND/);
      await assert.rejects(prepareStaffMandateSession(scope, document.id, { id: "wrong-customer" }), /NOT_FOUND/);
      const owner = { organisationId: org.id, email: customer.email!, customerIds: [customer.id] };
      await assert.rejects(prepareStaffMandateSession(scope, document.id, tenantCustomerScope({ ...owner, organisationId: "wrong-org" })), /NOT_FOUND/);
      await assert.rejects(prepareStaffMandateSession(scope, document.id, tenantCustomerScope({ ...owner, email: "wrong@example.invalid" })), /NOT_FOUND/);
      await db.customer.update({ where: { id: customer.id }, data: { emailVerifiedAt: null } });
      await assert.rejects(prepareStaffMandateSession(scope, document.id, tenantCustomerScope(owner)), /NOT_FOUND/);
      await db.customer.update({ where: { id: customer.id }, data: { emailVerifiedAt: new Date() } });
      assert.equal(await db.debitMandateSession.count({ where: { tenancyId: tenancy.id } }), 0);
    });
    await t.test("concurrent preparation reuses a single session without provider, financial or access writes", async () => {
      const results = await Promise.all([prepareStaffMandateSession(scope, document.id), prepareStaffMandateSession(scope, document.id)]);
      assert.equal(results[0].setupUrl, results[1].setupUrl);
      assert.equal(await db.debitMandateSession.count({ where: { tenancyId: tenancy.id } }), 1);
      assert.equal(await db.publicDebitMandate.count({ where: { session: { tenancyId: tenancy.id } } }), 0);
      assert.equal(await db.payment.count({ where: { accountId: account.id } }), 0);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: account.id } }), 0);
      const otherDocument = await db.document.create({ data: { tenancyId: tenancy.id, type: "LEASE_AGREEMENT", provider: "BLENDSIGN", status: "SIGNED", signedAt: new Date(), externalId: `OTHER-${suffix}`, storageKey: "ci-only" } });
      await assert.rejects(prepareStaffMandateSession(scope, otherDocument.id), /MANDATE_AGREEMENT_CHANGED/);
      const session = await db.debitMandateSession.findUniqueOrThrow({ where: { tenancyId: tenancy.id } });
      const saved = await requestPublicDebitOrderSetup(session.signingToken, { firstCollectionDate: "2099-02-01", collectionDay: 1 });
      assert.equal(saved.ok, true);
      assert.equal((await readStaffMandateSession(session.signingToken))?.preferences && saved.ok, true);
      assert.equal((await db.tenancy.findUniqueOrThrow({ where: { id: tenancy.id } })).status, "DRAFT");
    });
    await t.test("changed terms invalidate setup; expired links renew without a new provider mandate", async () => {
      const session = await db.debitMandateSession.findUniqueOrThrow({ where: { tenancyId: tenancy.id } });
      await db.occupancy.updateMany({ where: { tenancyId: tenancy.id }, data: { monthlyRate: 2000 } });
      await assert.rejects(readStaffMandateSession(session.signingToken), /MANDATE_AGREEMENT_CHANGED/);
      await db.occupancy.updateMany({ where: { tenancyId: tenancy.id }, data: { monthlyRate: 1000 } });
      const foreignCustomer = await db.customer.create({ data: { organisationId: org.id, firstName: "Other CI customer" } });
      await db.account.update({ where: { id: account.id }, data: { customerId: foreignCustomer.id } });
      await assert.rejects(readStaffMandateSession(session.signingToken), /MANDATE_AGREEMENT_CHANGED/);
      await assert.rejects(prepareStaffMandateSession(scope, document.id), /MANDATE_AGREEMENT_CHANGED/);
      await db.account.update({ where: { id: account.id }, data: { customerId: customer.id } });
      await db.debitMandateSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
      assert.equal(await readStaffMandateSession(session.signingToken), null);
      const renewed = await prepareStaffMandateSession(scope, document.id);
      assert.notEqual(renewed.setupUrl.split("/").at(-1), session.signingToken);
      assert.equal(await db.debitMandateSession.count({ where: { tenancyId: tenancy.id } }), 1);
      assert.equal(await readStaffMandateSession(session.signingToken), null);
    });
  } finally { await db.$disconnect(); }
});
