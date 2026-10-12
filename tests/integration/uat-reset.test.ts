import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { getUatResetPreview, resetUatCustomerData } from "../../src/lib/uat-reset-service";

test("isolated PostgreSQL customer reset handles restrictive workflow records atomically", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Reset CI only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "CI owner", email: `${key}@example.invalid` } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic customer" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI type", features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "CI-1", monthlyRate: 100, status: "OCCUPIED" } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, startDate: new Date(), occupancies: { create: { unitId: unit.id, startDate: new Date(), monthlyRate: 100, status: "ACTIVE" } } } });
    await db.reservation.create({ data: { facilityId: facility.id, unitId: unit.id, customerId: customer.id, quotedRate: 100 } });
    await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 100, description: "CI", effectiveAt: new Date() } });
    const payment = await db.payment.create({ data: { accountId: account.id, amount: 20, method: "TEST", idempotencyKey: key } });
    const product = await db.product.create({ data: { organisationId: org.id, facilityId: facility.id, sku: key, name: "Box", category: "Boxes", sellingPrice: 10, quantityOnHand: 10, quantityReserved: 5 } });
    const order = await db.merchandiseOrder.create({ data: { organisationId: org.id, facilityId: facility.id, accountId: account.id, unitId: unit.id, paymentId: payment.id, total: 20, idempotencyKey: key, expiresAt: new Date(), items: { create: { productId: product.id, name: "Box", sku: key, quantity: 2, unitPrice: 10 } } } });
    // A cancelled order must never release the same stock again.
    await db.merchandiseOrder.create({ data: { organisationId: org.id, facilityId: facility.id, accountId: account.id, unitId: unit.id, total: 10, stockHeld: false, status: "CANCELLED", idempotencyKey: randomUUID(), expiresAt: new Date(), items: { create: { productId: product.id, name: "Box", sku: key, quantity: 1, unitPrice: 10 } } } });
    const task = await db.task.create({ data: { organisationId: org.id, customerId: customer.id, title: "CI request" } });
    await db.tenantMerchandiseRequest.create({ data: { customerId: customer.id, facilityId: facility.id, unitId: unit.id, unitKey: unit.id, items: [], total: 10, idempotencyKey: key, taskId: task.id } });
    const collection = await db.collectionCase.create({ data: { accountId: account.id } });
    await db.collectionActivity.create({ data: { caseId: collection.id, requestKey: key, actorId: user.id, action: "NOTE", note: "CI", payload: {} } });
    await db.collectionPromise.create({ data: { caseId: collection.id, amount: 10, dueDate: "2099-01-01", createdById: user.id } });
    await db.financialAdjustment.create({ data: { organisationId: org.id, facilityId: facility.id, accountId: account.id, requestKey: key, kind: "CREDIT", amount: 10, taxAmount: 0, reason: "CI", evidenceReference: "CI", snapshot: {}, fingerprint: "CI", requestedById: user.id } });
    const run = await db.debitOrderRun.create({ data: { organisationId: org.id, facilityId: facility.id, period: "2099-01", actionDate: "2099-01-01", environment: "sandbox", connectionId: "ci", connectionFingerprint: "ci", batchName: key, fingerprint: "ci", snapshot: {}, total: 10, createdById: user.id, instructions: { create: { accountId: account.id, period: "2099-01", invoiceId: "ci", mandateId: "ci", reference: "ci", amount: 10 } } } });
    return { org, facility, user, customer, account, unit, type, tenancy, product, payment, order, task, run, input: { organisationId: org.id, actorId: user.id } };
  }
  async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      preview: await getUatResetPreview(f.org.id),
      product: await db.product.findUniqueOrThrow({ where: { id: f.product.id } }),
      unit: await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } }),
      task: await db.task.findUniqueOrThrow({ where: { id: f.task.id } }),
      audits: await db.auditEvent.count({ where: { organisationId: f.org.id, action: "uat.customer_data_reset" } }),
    };
  }
  try {
    await t.test("payment-linked orders, collections, adjustments, requests and debit batches reset; other organisation and catalogue survive", async () => {
      const f = await fixture(), other = await fixture();
      const otherBefore = await snapshot(other);
      const preview = await getUatResetPreview(f.org.id);
      assert.equal(preview.merchandiseOrders, 2);
      assert.equal(preview.merchandiseRequests, 1);
      assert.equal(preview.collectionCases, 1);
      assert.equal(preview.financialAdjustments, 1);
      assert.equal(preview.debitInstructions, 1);
      assert.deepEqual(await resetUatCustomerData(f.input), preview);
      assert.equal(await db.customer.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal(await db.account.count({ where: { id: f.account.id } }), 0);
      assert.equal(await db.merchandiseOrderItem.count({ where: { productId: f.product.id } }), 0);
      assert.equal(await db.debitOrderRun.count({ where: { id: f.run.id } }), 0);
      assert.equal(await db.collectionActivity.count({ where: { actorId: f.user.id } }), 0);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } })).status, "AVAILABLE");
      const product = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
      assert.equal(product.quantityReserved, 3);
      assert.equal(product.quantityOnHand, 10);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: f.task.id } })).customerId, null);
      assert.equal(await db.facility.count({ where: { id: f.facility.id } }), 1);
      assert.equal(await db.unitType.count({ where: { id: f.type.id } }), 1);
      assert.equal(await db.user.count({ where: { id: f.user.id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "uat.customer_data_reset" } }), 1);
      assert.deepEqual(await snapshot(other), otherBefore);
      assert.equal((await resetUatCustomerData(f.input)).customers, 0);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 3);
    });
    await t.test("insufficient reserved stock aborts without partial deletion", async () => {
      const f = await fixture();
      await db.product.update({ where: { id: f.product.id }, data: { quantityReserved: 1 } });
      const before = await snapshot(f);
      await assert.rejects(resetUatCustomerData(f.input), /UAT_RESET_STOCK_REVIEW_REQUIRED/);
      assert.deepEqual(await snapshot(f), before);
    });
    await t.test("a unit still occupied by a preserved customer is never released", async () => {
      const f = await fixture(), other = await fixture();
      await db.occupancy.updateMany({ where: { tenancyId: other.tenancy.id }, data: { unitId: f.unit.id } });
      const otherBefore = await snapshot(other);
      assert.equal((await getUatResetPreview(f.org.id)).unitsReleased, 0);
      assert.equal((await resetUatCustomerData(f.input)).unitsReleased, 0);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } })).status, "OCCUPIED");
      assert.deepEqual(await snapshot(other), otherBefore);
    });
    await t.test("mixed-organisation debit batch aborts and rolls back the stock release", async () => {
      const f = await fixture(), other = await fixture();
      await db.debitOrderInstruction.create({ data: { runId: f.run.id, accountId: other.account.id, period: "2099-02", invoiceId: "ci", mandateId: "ci", reference: "ci", amount: 1 } });
      const before = await snapshot(f), otherBefore = await snapshot(other);
      await assert.rejects(resetUatCustomerData(f.input), /UAT_RESET_SCOPE_CONFLICT/);
      assert.deepEqual(await snapshot(f), before);
      assert.deepEqual(await snapshot(other), otherBefore);
    });
    await t.test("audit failure rolls back every deletion and stock/unit change", async () => {
      const f = await fixture(), before = await snapshot(f);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_reset_audit_failure CHECK (action <> 'uat.customer_data_reset') NOT VALID`);
      try {
        await assert.rejects(resetUatCustomerData(f.input));
        assert.deepEqual(await snapshot(f), before);
        assert.equal(await db.collectionActivity.count({ where: { actorId: f.user.id } }), 1);
        assert.equal(await db.debitOrderRun.count({ where: { id: f.run.id } }), 1);
      } finally {
        await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_reset_audit_failure`);
      }
    });
  } finally { await db.$disconnect(); }
});
