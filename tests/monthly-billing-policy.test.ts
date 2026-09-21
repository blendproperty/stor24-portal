import assert from "node:assert/strict";
import test from "node:test";
import { billingPlanSchema, calculateMonthlyBill, currentBillingPeriod, type BillingPlan } from "../src/lib/monthly-billing-policy";
const plan: BillingPlan = { firstPeriod: "2024-01", proration: "ACTUAL_DAYS", taxPercent: 15, rentTaxable: true, insuranceEnabled: false, insuranceTaxable: false, charges: [], discount: null, approvalReference: "Approved fixture terms" };
const occupancy = { id: "one", number: "101", monthlyRate: 1150, startDate: new Date("2024-01-01T00:00:00+02:00"), endDate: null };
test("monthly totals include explicit fees, rent discounts and snapshotted insurance", () => {
  const result = calculateMonthlyBill("2026-02", { ...plan, insuranceEnabled: true, charges: [{ code: "ADMIN", name: "Admin", amount: 115, taxable: true }], discount: { name: "Agreed discount", type: "PERCENTAGE", value: 10, startsPeriod: "2026-01", endsPeriod: "2026-02" } }, [occupancy], { status: "ACTIVE", monthlyPremium: 50, effectiveFrom: occupancy.startDate, endedAt: null });
  assert.equal(result.total, 1200); assert.equal(result.taxTotal, 150);
  assert.deepEqual(result.lines.map(line => line.amount), [1150, 115, 115, 50]);
});
test("calendar days use February, leap years and exclusive transfer boundaries", () => {
  assert.equal(calculateMonthlyBill("2024-02", plan, [{ ...occupancy, monthlyRate: 2900, startDate: new Date("2024-02-15T00:00:00+02:00") }], null).total, 1500);
  assert.equal(calculateMonthlyBill("2026-02", plan, [{ ...occupancy, monthlyRate: 2800, startDate: new Date("2026-02-15T00:00:00+02:00") }], null).total, 1400);
  const split = new Date("2026-02-15T00:00:00+02:00");
  assert.equal(calculateMonthlyBill("2026-02", plan, [{ ...occupancy, monthlyRate: 2800, endDate: split }, { ...occupancy, id: "two", monthlyRate: 5600, startDate: split }], null).total, 4200);
  assert.throws(() => calculateMonthlyBill("2026-02", plan, [occupancy, { ...occupancy, id: "two" }], null), /OVERLAPPING/);
  assert.throws(() => calculateMonthlyBill("2026-02", { ...plan, proration: "FULL_MONTH" }, [{ ...occupancy, endDate: split }, { ...occupancy, id: "two", startDate: split }], null), /TRANSFER_REQUIRES_REVIEW/);
});
test("billing rejects unapproved periods, missing insurance and invalid discounts", () => {
  assert.throws(() => calculateMonthlyBill("2023-12", plan, [occupancy], null), /BEFORE_APPROVED/);
  assert.throws(() => calculateMonthlyBill("2026-02", { ...plan, insuranceEnabled: true }, [occupancy], null), /INSURANCE/);
  assert.throws(() => calculateMonthlyBill("2026-02", { ...plan, discount: { name: "Invalid", type: "FIXED", value: 2000, startsPeriod: "2026-02", endsPeriod: "2026-02" } }, [occupancy], null), /EXCEEDS_RENT/);
  assert.equal(billingPlanSchema.safeParse({ ...plan, taxPercent: 101 }).success, false);
  assert.equal(billingPlanSchema.safeParse({ ...plan, approvalReference: "" }).success, false);
  assert.equal(currentBillingPeriod(new Date("2026-01-31T22:30:00Z")), "2026-02");
});
test("expired discounts and premiums outside coverage are excluded", () => {
  const result = calculateMonthlyBill("2026-02", { ...plan, insuranceEnabled: true, discount: { name: "Expired", type: "FIXED", value: 100, startsPeriod: "2026-01", endsPeriod: "2026-01" } }, [occupancy], { status: "ENDED", monthlyPremium: 100, effectiveFrom: occupancy.startDate, endedAt: new Date("2026-02-01T00:00:00+02:00") });
  assert.equal(result.total, 1150); assert.equal(result.lines.length, 1);
});
