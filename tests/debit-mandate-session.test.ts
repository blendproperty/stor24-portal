import test from "node:test";
import assert from "node:assert/strict";
import { assertStaffMandateSource } from "../src/lib/debit-mandate-session";
const fixture = () => {
  const document = { id: "doc", type: "LEASE_AGREEMENT", status: "SIGNED", provider: "BLENDSIGN", externalId: "signed-envelope", signedAt: new Date("2026-10-10T12:00:00Z") };
  const tenancy = { customerId: "customer", accountId: "account", facilityId: "facility", status: "DRAFT", paymentMethod: "DEBIT_ORDER", startDate: new Date("2026-11-01"), occupancies: [{ id: "occupancy", unitId: "unit", monthlyRate: { toString: () => "1000" } }] };
  const source = { customerId: "customer", accountId: "account", facilityId: "facility", documentId: "doc", envelopeId: "signed-envelope", signedAt: document.signedAt.toISOString(), occupancyId: "occupancy", unitId: "unit", monthlyRate: "1000", startDate: tenancy.startDate.toISOString() };
  return { document, tenancy, source };
};
test("staff mandate source requires saved signed provider evidence and its exact account terms", () => {
  const f = fixture();
  assert.doesNotThrow(() => assertStaffMandateSource(f));
  // JSONB changes key ordering; order is not evidence of a change.
  f.source = Object.fromEntries(Object.entries(f.source).reverse()) as typeof f.source;
  assert.doesNotThrow(() => assertStaffMandateSource(f));
  for (const mutate of [
    (x: ReturnType<typeof fixture>) => { x.document.status = "PENDING"; },
    (x: ReturnType<typeof fixture>) => { x.document.type = "LEASE_AGREEMENT_UAT"; },
    (x: ReturnType<typeof fixture>) => { x.document.externalId = ""; },
    (x: ReturnType<typeof fixture>) => { x.tenancy.paymentMethod = "EFT"; },
    (x: ReturnType<typeof fixture>) => { x.tenancy.status = "ENDED"; },
    (x: ReturnType<typeof fixture>) => { x.tenancy.occupancies.push(x.tenancy.occupancies[0]); },
  ]) { const invalid = fixture(); mutate(invalid); assert.throws(() => assertStaffMandateSource(invalid), /MANDATE_BOOKING_UNAVAILABLE/); }
  for (const mutate of [
    (x: ReturnType<typeof fixture>) => { x.tenancy.occupancies[0].monthlyRate.toString = () => "2000"; },
    (x: ReturnType<typeof fixture>) => { x.tenancy.occupancies[0].unitId = "another-unit"; },
    (x: ReturnType<typeof fixture>) => { x.document.externalId = "replacement-envelope"; },
    (x: ReturnType<typeof fixture>) => { x.tenancy.startDate = new Date("2026-12-01"); },
    (x: ReturnType<typeof fixture>) => { x.tenancy.customerId = "another-customer"; },
    (x: ReturnType<typeof fixture>) => { x.tenancy.accountId = "another-account"; },
    (x: ReturnType<typeof fixture>) => { x.tenancy.facilityId = "another-store"; },
  ]) { const invalid = fixture(); mutate(invalid); assert.throws(() => assertStaffMandateSource(invalid), /MANDATE_AGREEMENT_CHANGED/); }
});
