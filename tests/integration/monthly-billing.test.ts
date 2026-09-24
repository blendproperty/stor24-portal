import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { getMonthlyBillingPlan, monthlyBillingAccounts, postMonthlyBilling, previewMonthlyBilling, saveMonthlyBillingPlan } from "../../src/lib/monthly-billing-service";
import { getStatementData } from "../../src/lib/finance/statement-data";
import { runMonthlyBilling } from "../../src/lib/billing-service";
import type { BillingPlan } from "../../src/lib/monthly-billing-policy";
const plan: BillingPlan = { firstPeriod: "2026-02", proration: "ACTUAL_DAYS", taxPercent: 15, rentTaxable: true, insuranceEnabled: false, insuranceTaxable: false, charges: [{ code: "ADMIN", name: "Agreed admin", amount: 115, taxable: true }], discount: { name: "Rent discount", type: "PERCENTAGE", value: 10, startsPeriod: "2026-02", endsPeriod: "2026-03" }, approvalReference: "CI fixture only" };
test("isolated PostgreSQL monthly billing", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Billing CI", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "CI store" } });
    const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "CI staff" } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "CI" } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI", features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "101", monthlyRate: 1150, status: "OCCUPIED" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `BILL-CI-${key}` } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2026-01-01T00:00:00+02:00"), occupancies: { create: { unitId: unit.id, status: "ACTIVE", monthlyRate: 1150, startDate: new Date("2026-01-01T00:00:00+02:00") } } } });
    const scope = { organisationId: org.id, userId: user.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    return { org, facility, user, customer, unit, account, tenancy, scope };
  }
  try {
    await t.test("preview is read-only; concurrent posting creates one invoice and one net charge", async () => {
      const f = await fixture();
      await assert.rejects(previewMonthlyBilling(f.scope, f.account.id, "2026-02"), /PLAN_REQUIRED/);
      await saveMonthlyBillingPlan(f.scope, f.account.id, plan);
      const bill = await previewMonthlyBilling(f.scope, f.account.id, "2026-02");
      assert.equal(bill.total, 1150); assert.equal(bill.taxTotal, 150);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 0);
      const attempts = await Promise.allSettled([postMonthlyBilling(f.scope, f.account.id, "2026-02", bill.fingerprint), postMonthlyBilling(f.scope, f.account.id, "2026-02", bill.fingerprint)]);
      assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(await db.document.count({ where: { tenancyId: f.tenancy.id, type: "INVOICE" } }), 1);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 3);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), "1150");
      assert.equal(await db.auditEvent.count({ where: { entityId: f.account.id, action: "billing.month_posted" } }), 1);
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 0);
      const doc = await db.document.findFirstOrThrow({ where: { tenancyId: f.tenancy.id, type: "INVOICE" } });
      assert.ok(doc.content?.includes("Rent discount")); assert.match(doc.content!, /150[.,]00/);
      assert.ok(doc.content?.includes("February"));
      await assert.rejects(previewMonthlyBilling(f.scope, f.account.id, "2026-02"), /ALREADY_POSTED/);
    });
    await t.test("unreconciled balances block preview and posting without financial writes", async () => {
      const f = await fixture();
      await saveMonthlyBillingPlan(f.scope, f.account.id, plan);
      const preview = await previewMonthlyBilling(f.scope, f.account.id, "2026-02");
      await db.account.update({ where: { id: f.account.id }, data: { balance: 50 } });
      await assert.rejects(previewMonthlyBilling(f.scope, f.account.id, "2026-02"), /RECONCILIATION_REQUIRED/);
      await assert.rejects(postMonthlyBilling(f.scope, f.account.id, "2026-02", preview.fingerprint), /RECONCILIATION_REQUIRED/);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 0);
      assert.equal(await db.document.count({ where: { tenancyId: f.tenancy.id } }), 0);
      assert.equal(await db.auditEvent.count({ where: { entityId: f.account.id, action: "billing.month_posted" } }), 0);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), "50");
      // A reconciled, explicit opening charge is retained in the statement.
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "CHARGE", amount: 50, description: "Synthetic opening balance", effectiveAt: new Date("2026-01-01") } });
      const reconciled = await previewMonthlyBilling(f.scope, f.account.id, "2026-02");
      await postMonthlyBilling(f.scope, f.account.id, "2026-02", reconciled.fingerprint);
      const statement = await getStatementData({ id: f.account.id }, "2026-02-01", "2026-02-28");
      assert.equal(statement.openingBalance, "50.00");
      assert.equal(statement.closingBalance, "1200.00");
      assert.equal(statement.rows.length, 3);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2), statement.closingBalance);
    });
    await t.test("changed plans, receipts and scope invalidate or reject posting", async () => {
      const f = await fixture(); await saveMonthlyBillingPlan(f.scope, f.account.id, plan);
      const bill = await previewMonthlyBilling(f.scope, f.account.id, "2026-02");
      await saveMonthlyBillingPlan(f.scope, f.account.id, { ...plan, charges: [] });
      await assert.rejects(postMonthlyBilling(f.scope, f.account.id, "2026-02", bill.fingerprint), /PREVIEW_CHANGED/);
      const refreshed = await previewMonthlyBilling(f.scope, f.account.id, "2026-02");
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "PAYMENT", amount: 100, description: "CI receipt", effectiveAt: new Date() } });
      await assert.rejects(postMonthlyBilling(f.scope, f.account.id, "2026-02", refreshed.fingerprint), /RECONCILIATION_REQUIRED/);
      for (const scope of [{ ...f.scope, organisationId: "other" }, { ...f.scope, facilityIds: [] }]) {
        assert.equal((await monthlyBillingAccounts(scope)).length, 0);
        await assert.rejects(getMonthlyBillingPlan(scope, f.account.id), /ACCOUNT_NOT_FOUND/);
        await assert.rejects(saveMonthlyBillingPlan(scope, f.account.id, plan), /ACCOUNT_NOT_FOUND/);
        await assert.rejects(postMonthlyBilling(scope, f.account.id, "2026-02", refreshed.fingerprint), /ACCOUNT_NOT_FOUND/);
      }
      assert.equal(await db.document.count({ where: { tenancyId: f.tenancy.id } }), 0);
    });
    await t.test("legacy charges, test contamination and pending tenancy block billing", async () => {
      const f = await fixture(); await saveMonthlyBillingPlan(f.scope, f.account.id, plan);
      await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "CHARGE", amount: 100, description: "Initial rent", effectiveAt: new Date("2026-02-01T00:00:00+02:00") } });
      await assert.rejects(previewMonthlyBilling(f.scope, f.account.id, "2026-02"), /EXISTING_CHARGES/);
      await db.tenancy.update({ where: { id: f.tenancy.id }, data: { status: "DRAFT" } });
      await assert.rejects(previewMonthlyBilling(f.scope, f.account.id, "2026-02"), /TENANCY_NOT_ACTIVE/);
      const g = await fixture(); await saveMonthlyBillingPlan(g.scope, g.account.id, plan);
      const payment = await db.payment.create({ data: { accountId: g.account.id, amount: 10, method: "PAY_NOW", status: "TEST_SUCCEEDED", environment: "sandbox", idempotencyKey: randomUUID() } });
      await db.ledgerEntry.create({ data: { accountId: g.account.id, type: "PAYMENT", amount: 10, description: "Historical test", effectiveAt: new Date(), externalRef: payment.idempotencyKey } });
      await assert.rejects(previewMonthlyBilling(g.scope, g.account.id, "2026-02"), /TEST_PAYMENT_REVIEW/);
      delete process.env.MONTHLY_BILLING_AUTOMATION_ENABLED;
      process.env.MONTHLY_BILLING_PAUSED = "true";
      await assert.rejects(runMonthlyBilling("2026-02"), /AUTOMATION_DISABLED/);
      delete process.env.MONTHLY_BILLING_PAUSED;
    });
    await t.test("invoice failure rolls back every financial posting", async () => {
      const f = await fixture(); await saveMonthlyBillingPlan(f.scope, f.account.id, plan);
      const bill = await previewMonthlyBilling(f.scope, f.account.id, "2026-02");
      await db.document.create({ data: { tenancyId: f.tenancy.id, type: "CI_CONFLICT", storageKey: "ci", externalId: `INV-202602-${f.account.accountNumber}` } });
      await assert.rejects(postMonthlyBilling(f.scope, f.account.id, "2026-02", bill.fingerprint));
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 0);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), "0");
      assert.equal(await db.auditEvent.count({ where: { entityId: f.account.id, action: "billing.month_posted" } }), 0);
    });
    await t.test("enhanced cron reports unconfigured accounts and legacy cut-over cannot rebill", async () => {
      const unconfigured = await fixture();
      const configured = await fixture(); await saveMonthlyBillingPlan(configured.scope, configured.account.id, plan);
      process.env.MONTHLY_BILLING_AUTOMATION_ENABLED = "true";
      const run = await runMonthlyBilling("2026-03");
      assert.ok(run.exceptions.some(e => e.accountId === unconfigured.account.id && e.code === "BILLING_PLAN_REQUIRED"));
      assert.equal(await db.ledgerEntry.count({ where: { accountId: unconfigured.account.id } }), 0);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: configured.account.id } })).balance.toString(), "1150");
      delete process.env.MONTHLY_BILLING_AUTOMATION_ENABLED;
      await runMonthlyBilling("2026-03");
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: configured.account.id } })).balance.toString(), "1150");
      assert.equal(await db.document.count({ where: { tenancyId: configured.tenancy.id, type: "INVOICE" } }), 1);
    });
  } finally { await db.$disconnect(); }
});
