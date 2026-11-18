import assert from "node:assert/strict";
import test from "node:test";

import { assertExistingPersonLink } from "../src/lib/hikcentral-person-link";

const match = { customerLastName: "Dovey", personFamilyName: "DOVEY", personId: "provider-123", expectedPersonId: "provider-123", linkedToAnotherCustomer: false, currentPersonId: null, currentStatus: "PENDING" };

test("an existing HikCentral person can be linked to the same customer without changing their identity", () => {
  assert.doesNotThrow(() => assertExistingPersonLink(match));
  assert.doesNotThrow(() => assertExistingPersonLink({ ...match, currentPersonId: "provider-123", currentStatus: "ACTIVE" }));
});

test("customer linking rejects a wrong or stale provider identity and unresolved duplicates", () => {
  assert.throws(() => assertExistingPersonLink({ ...match, personFamilyName: "Smith" }), /HIKCENTRAL_PERSON_NAME_MISMATCH/);
  assert.throws(() => assertExistingPersonLink({ ...match, expectedPersonId: "previous-person" }), /HIKCENTRAL_PERSON_CHANGED/);
  assert.throws(() => assertExistingPersonLink({ ...match, linkedToAnotherCustomer: true }), /HIKCENTRAL_PERSON_ALREADY_LINKED/);
  assert.throws(() => assertExistingPersonLink({ ...match, currentPersonId: "another-person" }), /HIKCENTRAL_CUSTOMER_ALREADY_LINKED/);
  assert.throws(() => assertExistingPersonLink({ ...match, currentStatus: "SUPERSEDED" }), /HIKCENTRAL_LINK_REVIEW_REQUIRED/);
});
