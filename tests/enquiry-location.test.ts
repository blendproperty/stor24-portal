import test from "node:test";
import assert from "node:assert/strict";
import { enquiryLocationInputSchema, recordEnquiryLocation, readEnquiryLocation, enquiryLocationReport } from "../src/lib/enquiry-location";
import { publicLeadSchema } from "../src/lib/public-lead-contract";
import { createLeadSchema } from "../src/lib/validators";

test("optional location preserves leading zeros and source without accepting client provenance or inferred coordinates", () => {
  const now = new Date("2026-10-15T08:00:00Z");
  const input = { city: " Pretoria ", province: "Gauteng", postalCode: "0081", country: "South Africa" };
  const record = recordEnquiryLocation(input, "PUBLIC_SELF_REPORTED", now)!;
  assert.equal(record.postalCode, "0081"); assert.equal(record.city, "Pretoria");
  assert.equal(record.capturedAt, now.toISOString()); assert.equal(record.source, "PUBLIC_SELF_REPORTED");
  assert.equal(recordEnquiryLocation({}, "STAFF_RECORDED"), undefined);
  assert.equal(recordEnquiryLocation({ city: "  " }, "STAFF_RECORDED"), undefined);
  for (const extra of [{ version: 1 }, { capturedAt: now.toISOString() }, { source: "IP" }, { latitude: 25 }]) {
    assert.equal(enquiryLocationInputSchema.safeParse({ ...input, ...extra }).success, false);
  }
  assert.equal(enquiryLocationInputSchema.safeParse({ postalCode: "<script>" }).success, false);
  assert.equal(enquiryLocationInputSchema.safeParse({ city: "A\nB" }).success, false);
  assert.equal(enquiryLocationInputSchema.safeParse({ city: "x".repeat(101) }).success, false);
  assert.equal(readEnquiryLocation({ ...record, source: "INFERRED" }), null);
  assert.equal(readEnquiryLocation({ ...record, capturedAt: "yesterday" }), null);
});

test("enquiry reporting uses only valid retained origin, keeps unknowns and does not derive billing geography", () => {
  const retained = recordEnquiryLocation({ city: "Pretoria", postalCode: "0081" }, "STAFF_RECORDED")!;
  const rows = [{ enquiryLocation: retained }, { enquiryLocation: { ...retained, city: "PRETORIA" } }, { enquiryLocation: { ...retained, source: "IP" } }, { billingAddress: { city: "Pretoria" } }, {}];
  const before = JSON.stringify(rows); const report = enquiryLocationReport(rows);
  assert.equal(report.cities.find(row => row.label === "Pretoria")?.count, 2);
  assert.equal(report.cities.find(row => row.label === "Unknown")?.count, 3);
  assert.equal(report.postalCodes.find(row => row.label === "0081")?.count, 2);
  assert.equal(report.provinces[0].count, 5); assert.equal(report.provinces[0].label, "Unknown");
  assert.equal(JSON.stringify(rows), before);
});

test("public and staff intake accept optional origin and reject invalid location without changing existing required fields", () => {
  const publicInput = { firstName: "Fixture", lastName: "Visitor", email: "fixture@example.invalid", phone: "+27000000000" };
  const staffInput = { facilityId: "fixture", source: "Walk-in", customerId: "fixture-customer" };
  for (const [schema, input] of [[publicLeadSchema, publicInput], [createLeadSchema, staffInput]] as const) {
    assert.equal(schema.safeParse(input).success, true);
    assert.equal(schema.safeParse({ ...input, enquiryLocation: { city: "Pretoria", postalCode: "0081" } }).success, true);
    assert.equal(schema.safeParse({ ...input, enquiryLocation: { city: "x".repeat(101) } }).success, false);
  }
});
