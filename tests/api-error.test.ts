import test from "node:test";
import assert from "node:assert/strict";
import { apiError } from "../src/lib/api";

test("unexpected exceptions never disclose their details in either API error field", async () => {
  for (const error of [new Error("synthetic database query failed at /private/path"), new Error("upstream FORBIDDEN details at /private/path"), { private: "synthetic" }]) {
    const response = apiError(error);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } });
  }
});

test("documented authorization and operational API error contracts remain available", async () => {
  for (const [code, status] of [["UNAUTHENTICATED",401],["FORBIDDEN",403],["FACILITY_FORBIDDEN",403],["FOLLOWUP_STAFF_FORBIDDEN",403],["PERSONAL_EXPORT_FORBIDDEN",403],["REPORT_SHARING_FORBIDDEN",403],["STAFF_EMAIL_FORBIDDEN",403],["STAFF_EMAIL_RECIPIENT_FORBIDDEN",403],["DEBICHECK_SECOND_TRANSPORT_FORBIDDEN",403],["NOT_FOUND",404],["CONFLICT",409],["UNIT_STRUCTURE_PROTECTED",409],["PRICE_GOVERNED_WORKFLOW_REQUIRED",409],["UAT_RESET_STOCK_REVIEW_REQUIRED",409],["UAT_RESET_SCOPE_CONFLICT",409],["MOVE_OUT_DATE_RESTRICTED",409],["MOVE_OUT_POLICY_REVIEW",409],["FLOOR_NOT_OPERATIONAL",409]] as const) {
    const response = apiError(new Error(code));
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).error.code, code);
  }
});
