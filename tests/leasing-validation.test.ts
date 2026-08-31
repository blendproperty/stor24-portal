import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accountPaymentSchema, customerSchema, facilitySchema, moveInSchema, noticeSchema, transferSchema, unitTypeSchema } from "../src/lib/validators";

test("unit types accept single-character operational names", () => {
  assert.equal(unitTypeSchema.safeParse({ facilityId: "facility-1", name: "A", widthMetres: 4.838, lengthMetres: 7.233, areaSqMetres: 35 }).success, true);
});

test("facility website addresses are normalized and unsafe slugs are rejected", () => {
  const valid = facilitySchema.safeParse({ name: "Midpoint", code: "MID", publicSlug: "Midpoint-Storage", publicBookingEnabled: true });
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.publicSlug, "midpoint-storage");
  assert.equal(facilitySchema.safeParse({ name: "Midpoint", code: "MID", publicSlug: "midpoint/storage" }).success, false);
});

test("partial facility updates do not persist schema defaults for omitted fields", () => {
  const raw = { publicSlug: "midpoint" };
  const parsed = facilitySchema.partial().parse(raw);
  const patch = Object.fromEntries(
    Object.keys(raw).map((key) => [key, parsed[key as keyof typeof parsed]]),
  );
  assert.deepEqual(patch, { publicSlug: "midpoint" });
});

test("customer requires a person or company name", () => {
  assert.equal(customerSchema.safeParse({ type: "INDIVIDUAL", email: "test@example.test" }).success, false);
  assert.equal(customerSchema.safeParse({ type: "BUSINESS", companyName: "Synthetic Storage CC" }).success, true);
});

test("notice rejects a move-out before the notice date", () => {
  assert.equal(noticeSchema.safeParse({ tenancyId: "tenancy-1", noticeDate: "2026-08-20", plannedMoveOut: "2026-08-10" }).success, false);
  assert.equal(noticeSchema.safeParse({ tenancyId: "tenancy-1", noticeDate: "2026-08-10", plannedMoveOut: "2026-08-31" }).success, true);
});

test("move-in rejects negative money and transfer requires identifiers", () => {
  assert.equal(moveInSchema.safeParse({ facilityId: "facility-1", customerId: "customer-1", unitId: "unit-1", startDate: "2026-08-04", initialCharge: -1 }).success, false);
  assert.equal(transferSchema.safeParse({ tenancyId: "", toUnitId: "unit-2", effectiveAt: "2026-08-04" }).success, false);
});

test("customer operations accept South African contacts and recorded consent", () => {
  const result = customerSchema.safeParse({ type: "INDIVIDUAL", firstName: "Test", lastName: "Tenant", identityRef: "ID-REDACTED", billingAddress: { city: "Pretoria", province: "Gauteng", country: "South Africa" }, alternateContact: { name: "Alternate", phone: "+27 10 000 0000" }, communicationConsent: { email: true, sms: false, phone: true, recordedAt: "2026-08-11T08:00:00.000Z" } });
  assert.equal(result.success, true);
});

test("account payments require a positive amount and supported tender", () => {
  assert.equal(accountPaymentSchema.safeParse({ accountId: "account-1", amount: 250, method: "EFT", receivedAt: "2026-08-07" }).success, true);
  assert.equal(accountPaymentSchema.safeParse({ accountId: "account-1", amount: 0, method: "EFT", receivedAt: "2026-08-07" }).success, false);
  assert.equal(accountPaymentSchema.safeParse({ accountId: "account-1", amount: 250, method: "CHEQUE", receivedAt: "2026-08-07" }).success, false);
});

test("transfers atomically claim the destination and audit both unit identities", () => {
  const source = readFileSync(new URL("../src/lib/leasing-service.ts", import.meta.url), "utf8");
  const transferSource = source.slice(source.indexOf("export async function transfer("), source.indexOf("export async function giveNotice("));
  assert.match(transferSource, /tx\.unit\.updateMany\([\s\S]*status: "AVAILABLE"[\s\S]*data: \{ status: "OCCUPIED" \}/);
  assert.match(transferSource, /if \(claimed\.count !== 1\) throw new Error\("CONFLICT"\)/);
  assert.match(transferSource, /\{ unitId: current\.unitId, occupancyId: current\.id \}/);
  assert.match(transferSource, /\{ unitId: next\.id, occupancyId: occupancy\.id,/);
});
