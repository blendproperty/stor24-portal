import assert from "node:assert/strict";
import test from "node:test";
import { leasingCustomerWhere, moveInReservationWhere } from "../src/lib/leasing-service";

test("facility-restricted leasing users only receive customers linked to permitted facilities", () => {
  const where = leasingCustomerWhere({ userId: "user-1", organisationId: "org-1", facilityIds: ["facility-a"], unrestrictedFacilities: false }, ["facility-a"]);
  assert.deepEqual(where, {
    organisationId: "org-1",
    OR: [
      { leads: { some: { facilityId: { in: ["facility-a"] } } } },
      { reservations: { some: { facilityId: { in: ["facility-a"] } } } },
      { tenancies: { some: { facilityId: { in: ["facility-a"] } } } },
    ],
  });
});

test("organisation-wide leasing users retain organisation-wide customer access", () => {
  const where = leasingCustomerWhere({ userId: "owner-1", organisationId: "org-1", facilityIds: [], unrestrictedFacilities: true }, []);
  assert.deepEqual(where, { organisationId: "org-1" });
});

test("move-in reservation lookup binds facility, customer, unit and active lifecycle", () => {
  assert.deepEqual(moveInReservationWhere({ reservationId: "reservation-1", facilityId: "facility-a", customerId: "customer-a", unitId: "unit-a" }), {
    id: "reservation-1",
    facilityId: "facility-a",
    customerId: "customer-a",
    unitId: "unit-a",
    status: "ACTIVE",
  });
});
