# STOR24 staff role profiles

15 October 2026. Reviewable role definitions; not applied.

## Faeez current access

Fresh owner permission preview confirms Active, Custom access, Store 1 - Midpoint, 27 selected grants.

- `access.view` - View physical access
- `adjustments.request` - Request or withdraw adjustments
- `adjustments.view` - View adjustment requests and records
- `billing.documents.send` - Send reviewed customer documents and notices
- `billing.view` - View monthly billing and invoices
- `collections.export` - Export aged collections
- `collections.manage` - Record collection follow-ups
- `collections.view` - View aged collections
- `communications.view` - View communications
- `customer_history.export` - Download a customer's contact history (scoped delegation)
- `facility.*` - Manage store setup
- `facility_map.view` - View facility map
- `identity.review` - Privately review customer identity documents
- `inventory.view` - View units and inventory
- `leads.*` - Manage leads
- `ledger.view` - View tenant ledgers and statements
- `move_in.create` - Process move-ins
- `operations.manage` - Edit customers and operational work
- `operations.view` - View tenant operations
- `payments.manage` - Record receipts and prepare payment requests
- `payments.view` - Review payment records and provider evidence
- `reports.collections` - View collections reports
- `reports.export` - Export reports
- `reports.financial` - View financial reports
- `reports.sales` - View sales reports
- `reports.view` - View reports
- `reservations.*` - Manage reservations

## Proposed Customer Operations Lead

Retain the existing 26 workflow grants after removing `facility.*` store setup. Add `receipt_review.view`, `receipt_review.capture`, `receipt_review.propose` only after deployment/scope verification and explicit access approval. Never add independent matching approval. Existing source permits a named profile to be documented, but the current UI saves a unique per-user Custom access role; this file does not create a reusable named database role.

## Proposed Facilities Operations Coordinator

Candidate: `operations.view`, `operations.manage`, `inventory.view`, `facility_map.view`, `access.view`. Midpoint-only. No employee assigned.

**Assignment blocker:** `operations.manage` also permits wider customer/operational edits. Do not call it maintenance-only. Resolve by explicit owner acceptance of that wider scope, or implement finer task/maintenance grants before assigning. Optional identity review/customer exports/inventory editing remain excluded.

## Meeting mapping

| Meeting items | Faeez responsibility | Manager responsibility |
| --- | --- | --- |
| 1-3 | Quote receipt investigation and correction request | Escalate to Faeez or finance |
| 4-8 13 15 | Customer history notes scoped export agreed appointments | Minimum site handover and assigned cover |
| 9-11 | Review store events arrivals payment blockers | Site readiness and arrival cover |
| 12 | Arrears preparation and reviewed notice workflow | No debt-policy or access action |
| 14 16 | Customer location and permitted marketing reports | No marketing administration |
| 17 | Report capacity issues | Report site/device issues |
| 18 | Current 27-grant custom scope retained until reviewed | Separate restricted role pending |
| 19-23 | Counter customer journey training and acceptance | Device/site handover and physical acceptance |

## Apply and verify

Confirm named employee and exact scope. Review before/after grants. Use the normal owner permission editor; preserve unrelated staff and session/security settings. Save only the explicitly approved profile, reload, compare all grants, verify old-session invalidation, then test allowed tasks and denied cross-store/financial/admin actions under the actual staff account. Keep independent approval separate. No production changes have been made in this documentation task.

## Evidence

Main source 19f00c58c68f4c102f1998f43f556d720f5c3b0b; current first-party guide catalogue; Faeez meeting register; live owner permission preview and read-only workflow screens on 15 October. UI checkbox snapshot retained locally without contact/credential data.