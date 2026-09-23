# Floor availability

In **Units & rates**, select a store and use **Floor availability**. Each switch saves immediately:

- **Operational**: units can be selected if their individual status also permits the operation.
- **Under construction**: exclude the floor from new public bookings, staff reservations, move-ins, transfers and fresh offline availability.

The release initialises the existing public store `midpoint` with First Floor and Second Floor closed. Ground floor is unchanged. The verified pre-release public inventory on 23 September 2026 contained 142 ground-floor, 194 first-floor and 194 second-floor units. This is a read-only baseline, not proof of deployed closure.

Inventory and staff maps retain closed-floor units for administration. Inventory has a Floor under construction filter. Available counts exclude closed-floor units; the Performance table includes otherwise-vacant closed-floor units in Service / unavailable. Physical totals and physical-occupancy denominators still include all inventory.

## Preservation and existing bookings

Floor policy is stored separately from unit status in `Facility.closedFloors`. Closing or reopening does not alter rates, existing holds, tenancies, payments, maintenance or lease records. Reopening does not turn occupied, reserved or service units into available units. Newly added units inherit their floor's policy.

Existing bookings on a newly closed floor remain visible to staff but cannot be moved in or activated through an older signing link/callback. Staff must resolve those bookings with the customer. Closing a floor is not an access revocation, evacuation or cancellation workflow.

## Enforcement

- Floor keys normalise numeric/named ground, first and second floors. Other floor labels retain case-insensitive exact identity.
- Unit eligibility checks both its floor label and linked map; a blank/stale label cannot bypass a closed mapped floor.
- Public unit lists, floor maps, size offers, available counts, staff selectors and offline downloads consume the same policy. The public website contract is unchanged and fetches availability without caching; no companion website deployment is required.
- Allocation and floor changes share a facility-row lock, then allocation locks/rechecks the unit. A stale request cannot pass a closure committed before its allocation lock. Already-completed bookings are retained.
- A disconnected offline device may display an old snapshot. Its request remains provisional; sync rechecks current policy and rejects it as unavailable. Facility changes invalidate the snapshot revision.
- The PATCH endpoint checks same origin, `inventory.manage`, organisation/facility scope and the previously displayed state. Successful changes are audited atomically. A stale staff change requires refresh.

## Validation and release

`tests/floor-availability.test.ts`, `tests/integration/floor-availability.test.ts` and `scripts/test-floor-availability.mjs` cover label handling, migration scope/audit, public contract, real PostgreSQL allocation guards and race ordering, preservation, permission scope, old signing activation and desktop/phone switches. Transaction and browser suites run in PR checks.

Deploy both additive migrations with this app release. The first adds the policy column; the second closes only the existing `midpoint` store's upper floors and records the initialisation audit. Verify both switches remain off after reload, only ground-floor units/maps are offered publicly, staff move-in excludes the upper floors, and unauthorised changes are rejected. Keep the schema/policy if rolling forward; an old binary that ignores the policy must not be used while floors remain closed.

Actual-money Netcash deferral and all existing provider, finance/MRI, legal, physical-access, data, training and launch acceptance gates remain separate.
