import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { insuranceDecisionSchema, insurancePlanSchema } from "../src/lib/validators";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/lib/insurance-service.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/components/insurance-workspace.tsx", import.meta.url), "utf8");

test("insurance plans require positive cover and non-negative commercial amounts", () => {
  assert.equal(insurancePlanSchema.safeParse({ code: "standard", name: "Standard cover", coverageAmount: 25000, monthlyPremium: 99, excessAmount: 500 }).success, true);
  assert.equal(insurancePlanSchema.safeParse({ code: "bad", name: "Bad cover", coverageAmount: 0, monthlyPremium: -1, excessAmount: 0 }).success, false);
});

test("waivers require a recorded reason and enrolment requires a plan", () => {
  assert.equal(insuranceDecisionSchema.safeParse({ tenancyId: "clx000000000000000000001", decision: "WAIVE", waiverReason: "Customer supplied external cover" }).success, true);
  assert.equal(insuranceDecisionSchema.safeParse({ tenancyId: "clx000000000000000000001", decision: "WAIVE", waiverReason: "" }).success, false);
  assert.equal(insuranceDecisionSchema.safeParse({ tenancyId: "clx000000000000000000001", decision: "ENROL", effectiveFrom: "2026-09-01" }).success, false);
});

test("insurance decisions are facility-scoped, snapshotted and audited", () => {
  assert.match(service, /facility: facilityWhere\(scope\)/);
  assert.match(service, /coverageAmount: plan\.coverageAmount/);
  assert.match(service, /insurance\.enrolled/);
  assert.match(service, /insurance\.waived/);
  assert.match(schema, /tenancyId\s+String\s+@unique/);
});

test("insurance UI does not claim premium billing is active", () => {
  assert.match(page, /Premium posting remains separate/);
  assert.match(page, /Premium billing remains disabled/);
  assert.doesNotMatch(page, /synthetic|demo plan/i);
});
