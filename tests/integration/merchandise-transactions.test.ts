import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { cancelTenantMerchandise } from "../../src/lib/merchandise-order-service";
import { settleVerifiedMerchandisePayment } from "../../src/lib/merchandise-order-settlement";

test("isolated PostgreSQL merchandise settlement and cancellation", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "CI only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key } });
    const customer = await db.customer.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, emailVerifiedAt: new Date() } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    const product = await db.product.create({ data: { organisationId: org.id, facilityId: facility.id, sku: key, name: "Box", category: "Boxes", sellingPrice: "10.00", quantityOnHand: 10, quantityReserved: 2 } });
    const payment = await db.payment.create({ data: { accountId: account.id, amount: "20.00", currency: "ZAR", method: "PAY_NOW", provider: "NETCASH", status: "PENDING", idempotencyKey: key } });
    const order = await db.merchandiseOrder.create({ data: { accountId: account.id, organisationId: org.id, facilityId: facility.id, unitId: "ci-unit", total: "20.00", paymentId: payment.id, idempotencyKey: key, expiresAt: new Date(Date.now() + 60000), items: { create: { productId: product.id, name: "Box", sku: key, quantity: 2, unitPrice: "10.00" } } } });
    return { account, product, order, payment, session: { organisationId: org.id, email: customer.email!, customerIds: [customer.id] }, verified: { verified: true, accepted: true, reference: payment.id, amount: "20.00", currency: "ZAR" } };
  }
  try {
    await t.test("concurrent duplicate success posts exactly one charge and payment", async () => {
      const f = await fixture();
      await Promise.all([settleVerifiedMerchandisePayment(f.payment.id, f.verified), settleVerifiedMerchandisePayment(f.payment.id, f.verified)]);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 2);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2), "0.00");
      assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status, "PAID");
    });
    await t.test("cancel then late payment records credit without resurrecting stock", async () => {
      const f = await fixture();
      await assert.rejects(cancelTenantMerchandise({ ...f.session, customerIds: [] }, f.order.id), /TENANT_NOT_FOUND/);
      await cancelTenantMerchandise(f.session, f.order.id);
      await settleVerifiedMerchandisePayment(f.payment.id, f.verified);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 0);
      assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status, "PAYMENT_REVIEW");
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2), "-20.00");
    });
  } finally { await db.$disconnect(); }
});
