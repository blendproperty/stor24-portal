import assert from "node:assert/strict";
import test from "node:test";
import { currentBillingPeriod, nextBillingPeriod } from "../src/lib/monthly-billing-policy";
import { approveScheduledInvoiceDraft, postMonthlyBilling, postMultiMonthInvoice } from "../src/lib/monthly-billing-service";

test("future monthly posting fails before database or balance writes", async () => {
  const scope = { organisationId: "synthetic", userId: "synthetic", facilityIds: ["synthetic"], unrestrictedFacilities: false };
  await assert.rejects(postMonthlyBilling(scope, "synthetic", nextBillingPeriod(), "synthetic"), /BILLING_EFFECTIVE_DATE_RECOGNITION_REQUIRED/);
  await assert.rejects(approveScheduledInvoiceDraft(scope, "synthetic", nextBillingPeriod(), "synthetic"), /BILLING_EFFECTIVE_DATE_RECOGNITION_REQUIRED/);
});

test("multi-month posting holds future charges before opening a transaction", async () => {
  const scope = { organisationId: "synthetic", userId: "synthetic", facilityIds: ["synthetic"], unrestrictedFacilities: false };
  await assert.rejects(postMultiMonthInvoice(scope, "synthetic", currentBillingPeriod(), 2, "synthetic"), /BILLING_EFFECTIVE_DATE_RECOGNITION_REQUIRED/);
  await assert.rejects(postMultiMonthInvoice(scope, "synthetic", nextBillingPeriod(), 2, "synthetic"), /BILLING_EFFECTIVE_DATE_RECOGNITION_REQUIRED/);
  await assert.rejects(postMultiMonthInvoice(scope, "synthetic", currentBillingPeriod(), 1, "synthetic"), /BILLING_MULTI_PERIOD_REVIEW/);
});
