import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { previewMonthlyBilling } from "../src/lib/monthly-billing-service";

test("monthly preview refuses a balance that disagrees with transaction history", async () => {
  const original = { account: db.account.findFirst, profile: db.configurationProfile.findFirst, entries: db.ledgerEntry.findMany, payments: db.payment.findMany };
  const decimal = (value: string) => new Prisma.Decimal(value);
  let balance = "50";
  let entries: unknown[] = [];
  const tenancy = { id: "tenancy", customerId: "customer", status: "ACTIVE", facilityId: "store", facility: { name: "Synthetic store" }, insuranceEnrollment: null, occupancies: [{ id: "occupancy", status: "ACTIVE", monthlyRate: decimal("1150"), startDate: new Date("2026-01-01"), endDate: null, unit: { number: "TEST" } }] };
  const plan = { firstPeriod: "2026-02", proration: "FULL_MONTH", taxPercent: 15, rentTaxable: true, insuranceEnabled: false, insuranceTaxable: false, charges: [], discount: null, approvalReference: "Synthetic only" };
  db.account.findFirst = (async () => ({ id: "account", accountNumber: "TEST", customerId: "customer", currency: "ZAR", balance: decimal(balance), customer: { firstName: "Test" }, tenancy })) as unknown as typeof original.account;
  db.configurationProfile.findFirst = (async () => ({ status: "READY", config: plan })) as unknown as typeof original.profile;
  db.ledgerEntry.findMany = (async () => entries) as unknown as typeof original.entries;
  db.payment.findMany = (async () => []) as unknown as typeof original.payments;
  const scope = { organisationId: "org", userId: "staff", facilityIds: ["store"], unrestrictedFacilities: false };
  try {
    await assert.rejects(previewMonthlyBilling(scope, "account", "2026-02"), /BILLING_RECONCILIATION_REQUIRED/);
    balance = "0";
    assert.equal((await previewMonthlyBilling(scope, "account", "2026-02")).total, 1150);
    const row = { id: "opening", type: "CHARGE", amount: decimal("50"), description: "Synthetic opening", effectiveAt: new Date("2026-01-01"), reversalOfId: null };
    entries = [row]; balance = "50";
    assert.equal((await previewMonthlyBilling(scope, "account", "2026-02")).balance, "50");
    entries = [{ ...row, type: "REVERSAL", reversalOfId: "missing" }];
    await assert.rejects(previewMonthlyBilling(scope, "account", "2026-02"), /RECONCILIATION_REQUIRED/);
    entries = [{ ...row, effectiveAt: new Date("2099-01-01") }];
    await assert.rejects(previewMonthlyBilling(scope, "account", "2026-02"), /RECONCILIATION_REQUIRED/);
  } finally {
    db.account.findFirst = original.account;
    db.configurationProfile.findFirst = original.profile;
    db.ledgerEntry.findMany = original.entries;
    db.payment.findMany = original.payments;
  }
});
