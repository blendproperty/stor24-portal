# Staff screen redesign - 3 October 2026

The previous backend release improved shared controls but left most dashboard compositions intact. This release changes the visual language across the staff application and changes the actual home, finance hub, calendar, performance and reporting compositions. It does not fabricate trends, change financial policy or imply providers are connected.

## Screen coverage

| Screens | Visual treatment |
| --- | --- |
| Home | Scoped occupancy gauge, dark portfolio focal panel, live signal rail, priority work, activity and four daily workflow links |
| Leads | Aligned title/action, contiguous cohort KPI strip, distinct pipeline/volume/source panels and stronger register hierarchy |
| Customers and accounts | Directory/detail composition, distinct contact/consent/activity surfaces, balance focal panel, consistent profile dialogs |
| Reservations | Compact search/control bar, hold summary strip, clear row actions and assisted unit-selection dialogs |
| Units | Inventory toolbar, narrower inspection rail, numeric table treatment and bounded controls |
| Move-in and practice move-in | Clear step sequence, retained inventory filters and a distinct selected-unit surface; consent/signature/payment gates unchanged |
| Billing hub | All ten modules grouped into Bill & collect, Reconcile & close, Evidence & controls |
| Monthly billing, debit orders, collections, adjustments, insurance, settlement and Netcash operations | Precise account/period controls, financial summary rails, bordered review/work/history surfaces and dense numeric tables |
| MRI | Connection focal panel, aligned metrics, configuration/ledger table treatment |
| Performance | Three-column KPI arrangement, unequal chart columns, readable gridlines and month/day/value annotations |
| Reports | Parameter rail beside the catalogue; report-card selection updates the export selection and returns control focus |
| Calendar | Actual displayed workload/day summary, three-column desktop agenda, clear day headers and linked scheduled items |
| Operations and merchandise | Distinct task/maintenance work surfaces, full-width daily close, catalogue toolbar and strong numeric summaries |
| Communications, integrations and phone | Summary rails, prominent operational registers and connection/exception surfaces; truthful unavailable provider states retained |
| Company, users and settings | Administration console, dark settings index, aligned forms and compact user/permission tables |
| Identity and facial access | Clear review queue/detail surfaces, bounded specialist forms; original private-preview/consent and server controls preserved |
| Facility map | Contrasting toolbar/canvas/tool panels; availability colours and actual unit geometry preserved |
| Audit, data protection and offline readiness | Evidence registers with clearer column headings, dense rows and defined informational surfaces |
| Offline workspace | Matching slate/white/compact form treatment in the standalone cached workspace |

This covers the 38 primary/specialist screens recorded in BACKEND_QUALITY_REVIEW.md. Shared header/control/table design is intentional; unique compositions are described above. It is not a claim that every screen received a new data feature or changed backend logic.

## Validation and promotion

Candidate validation and release status are tracked in PROJECT_CONTEXT.md. New actual-page design fixtures use invented service responses, with no production connection; ordinary workflow scripts retain their failure/recovery assertions. Final handoff requires exact-head checks, deployment and authenticated live screen readback. Provider, finance, privacy, data, training and staff acceptance gates remain separate.

## Verified live release

PR369 and PR370 are merged. Exact application source2a608c7963fa32f1acfc25e28b04dfcb98a6e941 is deployed and healthy; nine exact-source checks pass, including517 unit tests/build and56 browser scripts. Authenticated38-screen desktop/phone readback is complete, including the final integrations phone correction and blank customer-dialog checks. Seven actual-page isolated fixtures pass five widths. Full dated deployment and live evidence, plus unchanged operational acceptance gates, are in PROJECT_CONTEXT.md. This documentation promotion changes no application code.
