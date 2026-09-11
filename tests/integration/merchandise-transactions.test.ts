import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { cancelTenantMerchandise, holdTenantMerchandise } from "../../src/lib/merchandise-order-service";
import { expireMerchandiseOrders, settleVerifiedMerchandisePayment } from "../../src/lib/merchandise-order-settlement";

test("isolated PostgreSQL merchandise settlement and cancellation", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "CI only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key } });
    const customer = await db.customer.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, emailVerifiedAt: new Date() } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: key, features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number: key, monthlyRate: "100.00" } });
    await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date(), occupancies: { create: { unitId: unit.id, status: "ACTIVE", startDate: new Date(), monthlyRate: "100.00" } } } });
    const product = await db.product.create({ data: { organisationId: org.id, facilityId: facility.id, sku: key, name: "Box", category: "Boxes", sellingPrice: "10.00", quantityOnHand: 10, quantityReserved: 2 } });
    const payment = await db.payment.create({ data: { accountId: account.id, amount: "20.00", currency: "ZAR", method: "PAY_NOW", provider: "NETCASH", status: "PENDING", idempotencyKey: key } });
    const order = await db.merchandiseOrder.create({ data: { accountId: account.id, organisationId: org.id, facilityId: facility.id, unitId: "ci-unit", total: "20.00", paymentId: payment.id, idempotencyKey: key, expiresAt: new Date(Date.now() + 60000), items: { create: { productId: product.id, name: "Box", sku: key, quantity: 2, unitPrice: "10.00" } } } });
    return { account, product, order, payment, session: { organisationId: org.id, email: customer.email!, customerIds: [customer.id] }, verified: { verified: true, accepted: true, reference: payment.id, amount: "20.00", currency: "ZAR" } };
  }
  try {
    await t.test("unverified or mismatched payment cannot post money or change stock", async () => {
      const f = await fixture();
      for (const invalid of [
        { ...f.verified, verified: false },
        { ...f.verified, reference: "another-payment" },
        { ...f.verified, amount: "19.99" },
        { ...f.verified, currency: "USD" },
      ]) await assert.rejects(settleVerifiedMerchandisePayment(f.payment.id, invalid), /MERCHANDISE_PAYMENT_MISMATCH/);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 0);
      assert.equal((await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PENDING");
      assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status, "AWAITING_PAYMENT");
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 2);
    });
    await t.test("pending confirmation then success preserves existing balance and posts once", async () => {
      const f = await fixture();
      await db.account.update({ where: { id: f.account.id }, data: { balance: "125.00" } });
      await settleVerifiedMerchandisePayment(f.payment.id, { ...f.verified, accepted: false });
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 0);
      assert.equal((await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PENDING");
      await settleVerifiedMerchandisePayment(f.payment.id, f.verified);
      // Later non-success and cancellation must not undo a verified successful payment.
      await settleVerifiedMerchandisePayment(f.payment.id, { ...f.verified, accepted: false });
      await cancelTenantMerchandise(f.session, f.order.id);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2), "125.00");
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 2);
      assert.equal((await db.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "SUCCEEDED");
      assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status, "PAID");
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 2);
    });
    await t.test("concurrent expiry releases a hold exactly once and late payment becomes credit", async () => {
      const f = await fixture();
      const now = new Date("2020-01-02T00:00:00Z");
      await db.merchandiseOrder.update({ where: { id: f.order.id }, data: { expiresAt: new Date("2020-01-01T00:00:00Z") } });
      const counts = await Promise.all([expireMerchandiseOrders(now), expireMerchandiseOrders(now)]);
      assert.equal(counts.reduce((sum, count) => sum + count, 0), 1);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 0);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityOnHand, 10);
      const expired = await db.merchandiseOrder.findUniqueOrThrow({ where: { id: f.order.id } });
      assert.equal(expired.status, "EXPIRED");
      assert.equal(expired.stockHeld, false);
      assert.equal(await db.auditEvent.count({ where: { entityId: f.order.id, action: "merchandise_order.expired" } }), 1);
      await settleVerifiedMerchandisePayment(f.payment.id, f.verified);
      assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status, "PAYMENT_REVIEW");
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2), "-20.00");
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 0);
    });
    await t.test("expiry leaves paid orders and unexpired holds untouched", async () => {
      const paid = await fixture();
      const pending = await fixture();
      await settleVerifiedMerchandisePayment(paid.payment.id, paid.verified);
      await db.merchandiseOrder.update({ where: { id: paid.order.id }, data: { expiresAt: new Date("2020-01-01T00:00:00Z") } });
      assert.equal(await expireMerchandiseOrders(new Date("2020-01-02T00:00:00Z")), 0);
      for (const f of [paid, pending]) {
        assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 2);
        assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).stockHeld, true);
      }
    });
    await t.test("inconsistent stock reports failure but does not block later valid holds", async () => {
      const bad = await fixture();
      const good = await fixture();
      const now = new Date("2020-01-03T00:00:00Z");
      await db.product.update({ where: { id: bad.product.id }, data: { quantityReserved: 0 } });
      await db.merchandiseOrder.update({ where: { id: bad.order.id }, data: { expiresAt: new Date("2020-01-01T00:00:00Z") } });
      await db.merchandiseOrder.update({ where: { id: good.order.id }, data: { expiresAt: new Date("2020-01-02T00:00:00Z") } });
      await assert.rejects(expireMerchandiseOrders(now), /MERCHANDISE_EXPIRY_PARTIAL_FAILURE/);
      assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: bad.order.id } })).status, "AWAITING_PAYMENT");
      assert.equal(await db.auditEvent.count({ where: { entityId: bad.order.id, action: "merchandise_order.expired" } }), 0);
      assert.equal((await db.merchandiseOrder.findUniqueOrThrow({ where: { id: good.order.id } })).status, "EXPIRED");
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: good.product.id } })).quantityReserved, 0);
      // Repair only this isolated fixture, then prove retry succeeds without releasing good twice.
      await db.product.update({ where: { id: bad.product.id }, data: { quantityReserved: 2 } });
      assert.equal(await expireMerchandiseOrders(now), 1);
      assert.equal(await expireMerchandiseOrders(now), 0);
    });
    await t.test("concurrent duplicate checkout holds stock once", async () => {
      const f = await fixture();
      const input = { unit: `account:${f.account.id}`, idempotencyKey: randomUUID(), items: [{ productId: f.product.id, quantity: 3 }] };
      const [first, retry] = await Promise.all([holdTenantMerchandise(f.session, input), holdTenantMerchandise(f.session, input)]);
      assert.equal(first.id, retry.id);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 5);
      await assert.rejects(holdTenantMerchandise(f.session, { ...input, items: [{ productId: f.product.id, quantity: 4 }] }), /RETRY_CONFLICT/);
    });
    await t.test("competing baskets cannot reserve more stock than is available", async () => {
      const f = await fixture();
      const input = { unit: `account:${f.account.id}`, items: [{ productId: f.product.id, quantity: 6 }] };
      const results = await Promise.allSettled([holdTenantMerchandise(f.session, { ...input, idempotencyKey: randomUUID() }), holdTenantMerchandise(f.session, { ...input, idempotencyKey: randomUUID() })]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected").length, 1);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 8);
    });
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
