# Backend quality review - 3 October 2026

## Evidence and scope

Authenticated, read-only production review of 38 staff screens at portal.stor24.co.za, on deployed application source eed9b935. Every listed screen returned its expected heading without a page failure, visible alert or desktop horizontal overflow. This is route/render evidence, not proof of all actions, provider delivery, finance acceptance or staff UAT. Loading states were observed on asynchronous screens; fixture checks separately validate reads, writes, recovery and restrictions.

Actual React components are exercised with isolated synthetic fixtures, including customer save/read recovery, lead capture and sales updates, map/unit selection, reservations, move-in, billing/debit orders, ledger adjustments, settlements, collections, stock/orders, configuration, identity/facial photos, permissions and reports. Production review did not create customers, holds, tenancies, payments, provider requests or change permissions. Customer-specific statements and documents are covered by isolated tests rather than opening private production files. Public authentication and tenant-only pages are outside this staff-screen review.

## Screen register

| Staff screen | Route | Production render review |
| --- | --- | --- |
| Dashboard | `/` | Opened; expected heading; no desktop overflow |
| Tenants | `/tenants` | Opened; expected heading; no desktop overflow |
| Users & permissions | `/users` | Opened; expected heading; no desktop overflow |
| Lead to lease | `/leads` | Opened; expected heading; no desktop overflow |
| Reservations | `/reservations` | Opened; expected heading; no desktop overflow |
| Identity review | `/identity` | Opened; expected heading; no desktop overflow |
| Units & rates | `/units` | Opened; expected heading; no desktop overflow |
| Billing & payments | `/billing` | Opened; expected heading; no desktop overflow |
| Collections | `/collections` | Opened; expected heading; no desktop overflow |
| Facial access | `/access` | Opened; expected heading; no desktop overflow |
| Operations | `/operations` | Opened; expected heading; no desktop overflow |
| Merchandise | `/operations/merchandise` | Opened; expected heading; no desktop overflow |
| Insurance | `/insurance` | Opened; expected heading; no desktop overflow |
| Adjustments | `/adjustments` | Opened; expected heading; no desktop overflow |
| Company & setup | `/company` | Opened; expected heading; no desktop overflow |
| Reports | `/reports` | Opened; expected heading; no desktop overflow |
| Graphs | `/graphs` | Opened; expected heading; no desktop overflow |
| Communications | `/communications` | Opened; expected heading; no desktop overflow |
| Integrations | `/integrations` | Opened; expected heading; no desktop overflow |
| Calendar | `/calendar` | Opened; expected heading; no desktop overflow |
| Prorate calculator | `/prorate` | Opened; expected heading; no desktop overflow |
| Facility map | `/map` | Opened; expected heading; no desktop overflow |
| Phone integration | `/phone` | Opened; expected heading; no desktop overflow |
| System audit | `/audit` | Opened; expected heading; no desktop overflow |
| Data protection | `/audit/data-protection` | Opened; expected heading; no desktop overflow |
| Offline workspace | `/offline-workspace.html` | Opened; expected heading; no desktop overflow |
| Offline readiness | `/offline-readiness` | Opened; expected heading; no desktop overflow |
| Settings | `/settings` | Opened; expected heading; no desktop overflow |
| Accounts | `/operations/accounts` | Opened; expected heading; no desktop overflow |
| Move in | `/operations/move-in` | Opened; expected heading; no desktop overflow |
| Practise a move-in | `/operations/move-in/training` | Opened; expected heading; no desktop overflow |
| Monthly billing | `/billing/monthly` | Opened; expected heading; no desktop overflow |
| Netcash payment operations | `/billing/netcash` | Opened; expected heading; no desktop overflow |
| MRI accounting | `/billing/mri` | Opened; expected heading; no desktop overflow |
| Debit-order runs | `/billing/debit-orders` | Opened; expected heading; no desktop overflow |
| Settlement reconciliation | `/billing/settlements` | Opened; expected heading; no desktop overflow |
| Netcash test connection | `/settings/integrations/netcash` | Opened; expected heading; no desktop overflow |
| Hikvision access control | `/settings/integrations/hikvision` | Opened; expected heading; no desktop overflow |

## Changes from the review

- Replaced the inert global-search field with a working, permission-filtered workspace finder. It accurately searches screens, not customer records; records use their workspace filters. Keyboard shortcut, native focus trap, Escape and focus return are exercised. It includes finance and move-in subpages and is available on phones.
- Grouped desktop and mobile navigation by customers/sales, facility operations, finance, insights and administration. Kept access restrictions visible and server enforcement unchanged. Only the most specific parent navigation item is current, including nested audit pages. Added a skip-to-workspace link.
- Replaced the inactive notification control with a real scheduled-work link. Improved current-workspace context, typography, numeric alignment, control heights, text areas, reduced-motion support and table headings across the authenticated shell. Small-screen bounds include 305px.
- Corrected the fixed 31-day calculator. The local estimate uses an effective date, actual month length including leap years, inclusive effective day and integer-cent rounding. Invalid dates/rates show no charge. It does not post amounts or override approved contract, VAT, discounts or account billing policy. Updated guided help.
- Calendar follow-ups open the specific lead rather than requiring another search. Historic website booking/viewing and offline lead-source codes show readable labels in reports and customer history; attribution data is unchanged.
- Live follow-up keeps calculator guidance below the whole form row, rather than stretching the icon column, and gives customer dialogs/close controls accessible names, focus management, Tab containment and Escape.
- Telephony explicitly states that caller matching is not available until the provider adapter is implemented and tested. Removed the misleading waiting-for-a-call state and added a route to integrations.

## Operational acceptance still required

SiteLink's own published benchmark includes customer lifecycle workflows, an interactive property map, accounting controls, reporting and integrations: https://www.sitelink.com/products/web-edition . These are useful acceptance categories; this review does not establish that STOR24 exceeds SiteLink in all capabilities.

- Telephony: provider adapter, caller events/matching, controlled inbound-call test and staff acceptance remain incomplete.
- Payments/accounting/access/signatures/messaging: retain current provider, legal/privacy, finance and recovery gates. Synthetic tests and visible connection status do not prove real settlement, gate access, message receipt or lease enforceability. Do not run real financial or access actions simply to test a screen.
- Data quality: production currently contains numerous repeated contact/test records. Reconciliation and deduplication need an approved data plan; no customer records were deleted or merged here.
- Marketing: actual consented enquiry-to-CRM attribution, campaign setup and Power BI embedding remain outstanding. Native lead reporting is available.
- Staff UAT: full lead-to-reservation-to-approved-lease/payment-to-handover journey, transfer, notice/move-out, arrears, period close and exports must be accepted against actual business policies and expected totals.
- Audit completeness, retention, training, backup restore evidence and business launch approval remain explicit gates from PROJECT_CONTEXT.md.

## Validation and release record

PR366 deployed097ee173 after all nine source checks, with healthy live readback. All517 unit tests and all55 local browser workflow scripts pass. Final panel-spacing and customer-dialog accessibility follow-up is on codex/backend-live-evidence-20261003; exact-head checks and promotion pending. Initial focused proration tests, TypeScript, lint (zero errors), role-restricted navigation and premium-workspace responsive tests passed. Full 55-script browser workflow sweep and exact-head Linux CI/build/security/transaction checks are recorded separately in PROJECT_CONTEXT.md. One Windows concurrent migration-report test failed; the unchanged focused ten-test rerun passed. The local dependency junction was redirected to an already clean isolated install of the locked packages, preserving the other checkout's shared node_modules. No security exception or provider configuration change.
