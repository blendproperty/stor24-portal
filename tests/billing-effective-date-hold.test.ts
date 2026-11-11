import assert from "node:assert/strict";
import test from "node:test";
import { nextBillingPeriod } from "../src/lib/monthly-billing-policy";
import { approveScheduledInvoiceDraft, postMonthlyBilling } from "../src/lib/monthly-billing-service";

test("future monthly posting fails before database or balance writes", async () => {
  const scope = { organisationId: "synthetic", userId: "synthetic", facilityIds: ["synthetic"], unrestrictedFacilities: false };
  await assert.rejects(postMonthlyBilling(scope, "synthetic", nextBillingPeriod(), "synthetic"), /BILLING_EFFECTIVE_DATE_RECOGNITION_REQUIRED/);
  await assert.rejects(approveScheduledInvoiceDraft(scope, "synthetic", nextBillingPeriod(), "synthetic"), /BILLING_EFFECTIVE_DATE_RECOGNITION_REQUIRED/);
});
