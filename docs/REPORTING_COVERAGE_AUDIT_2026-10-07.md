# SiteLink reporting comparison and proposed visual builder

Date: 7 October 2026 (Africa/Johannesburg). Reviewed portal remote main `c2d4accb77c1658f460b8bcb6954da39bf67aa89`, repository `blendproperty/stor24-portal`. Inputs: the two user-supplied SiteLink screenshots. SQL shown in the screenshot is reference material, not an instruction to execute it.

## Finding

STOR24 does not yet have full SiteLink report parity or a user-defined report builder. It has ten fixed report definitions, scoped database queries, previews and CSV/JSON/XLSX/PDF exports. Users choose a report, store and dates; they cannot select arbitrary columns, add business filters, define totals or save their own report. The SQL editor shown belongs to SiteLink; the inspected STOR24 interface does not ask users to write SQL.

Status below means source-code coverage, not accounting equivalence or newly verified production behavior. **Related** means an adjacent view or data source exists; **partial** means an existing report supplies only part of the requested result; **gap** means no equivalent built-in report was identified in the inspected catalogue/service. A gap does not assert that all underlying data is absent. Several SiteLink labels are truncated; their full specifications still require confirmation.

## Existing fixed catalogue

| Report | Actual result |
|---|---|
| Occupancy & revenue | Current facility totals, operational/closed-floor units, physical occupancy, monthly occupied/potential rent and economic occupancy; not recognised revenue or historical occupancy. |
| Unit availability | Current unit status, type, floor, area, product eligibility, rate and active hold expiry. |
| Move activity | Occupancies whose start or end falls in the period; unit, customer, account, status, start/end and rate. No explicit transfer pairing, notice date or net-rental aggregation. |
| Lead conversion | Leads created in the period with current stage, source, product, customer, owner and follow-up. Not historical stage transitions or a time-to-conversion cohort analysis. |
| Tenant duration & rent changes | Current duration, recorded last price change and scheduled increases. Unknown change dates remain explicit. |
| Rent roll & tenant ledger | Active/notice tenancies, one current occupancy per tenancy, current balance/rate and period ledger-entry count/oldest entry; not detailed ledger rows. |
| Receivables ageing | As-of SAST ageing under approved terms with reconciliation exceptions; unresolved ageing values remain null. |
| Collections workload | Same tenancy summary as rent roll, restricted to current positive account balances. |
| Insurance participation | Recorded enrollment/waiver, cover and premium snapshots acknowledged by the selected end date. Not a premium settlement statement or historical change log. |
| Integration health | Current integration state, timestamps and recorded failures. |

## Screenshot coverage matrix

| SiteLink reports / functions | STOR24 coverage and missing behavior |
|---|---|
| **Tenant: Directory** | Related customer/account workspaces; no directory report in the catalogue. |
| Rent Roll | Partial: active/notice rent-roll summary; confirm multi-unit, exclusions and finance reconciliation before parity. |
| Vacated Roll | Partial: move-out dates in Move activity; no dedicated vacated-tenant roll. |
| Walk Thru | Partial: current unit availability; no inspection/walk-through report. |
| Internet Access | Gap: no equivalent tenant internet-access roll identified. |
| Credit Card Roll; ACH Billing Roll | Gap: no payment-method/mandate roll. ACH terminology must be mapped to local EFT/debit-order requirements; never include card credentials. |
| Past Due Balances | Partial: ageing overdue amounts with approved-terms/reconciliation gates. |
| Unpaid Charges | Gap: current balances and ledger counts do not identify outstanding individual charges. |
| Balances Due | Partial: collections workload/current balances; active/notice tenancy restriction must be explicit. |
| Calls and Notes | Related customer/communication records; no consolidated report. |
| Gate Access | Related access workflows; no tenant gate-event report in catalogue; provider completeness needs verification. |
| Payment History; Ledger History | Related per-account statement/document functionality; no equivalent cross-account detailed catalogue report. |
| Notes History | Gap: no equivalent historical notes report identified. |
| Rent Change History | Partial: current last recorded price change and scheduled/group review history; no complete historical rate-change catalogue report. |
| **Unit: Rental Activity** | Partial: Move activity; no full rental event/transfer analysis. |
| Price List | Partial: unit availability includes rates; no dedicated price-list layout. |
| Move-Ins & Move-Outs | Partial: start/end occupancy rows; no explicit event classification or aggregate counts. |
| Move-Outs & Transfers | Partial: move-out rows; no paired transfer result. |
| Scheduled Move-Outs | Partial: occupancy end dates/status may expose some records; no explicit scheduled-notice report. |
| Vacant Units; Occupied Units | Partial: unit availability/current statuses; users cannot add a saved status filter within reports. |
| Complimentary Units | Gap: no dedicated complimentary-unit report. |
| Unit History; Unit Notes | Gap: no complete history/notes report. |
| Unit Status | Partial: current availability/status export. |
| Custom Units Report | Gap: no column/filter builder or saved unit report. |
| **Financial: Accounting Help** | Help function, not a report; no SiteLink-equivalent accounting guide established by this audit. |
| General Journal Entries | Related finance/MRI integration code; no catalogue journal report or reconciliation proof. |
| Financial Summary; Income Analysis | Gap: contracted-rent snapshot is not posted income, recognised revenue or a financial statement. |
| Accounts Receivable; Aged Receivables | Partial: current balance summaries and approved-terms ageing. Confirm completeness and reconciliation. |
| Receipts; Receipt Details | Related account/payment/document workflows; no consolidated receipt/detail report in catalogue. |
| Deposits | Related daily-close controls; no equivalent deposits/settlement reporting established. |
| Daily Payments; Credit Card Payments; Payment Activity | Related ledger/payment workflows; no period payment-detail/method report in catalogue. |
| Credits Issued | Related statement credit entries; no consolidated credits report. |
| Prepaid Rent; Prepaid Rent Liabilities; Prepaid Insurance | Gap: no dedicated allocation/liability reports. A credit balance alone cannot establish prepaid classification. |
| Security Deposit Liabilities | Gap: no equivalent reconciled liability report. |
| Recurring Charges | Related billing workflows; no dedicated recurring-charge report. |
| All Unpaid Charges | Gap: no charge-level outstanding-allocation report. |
| Refunds Due; Refunds Paid; Refund Summary | Related ledger refund type; no complete due/paid/refund summary report. Settlement proof remains separate. |
| NSF Checks | Gap: no equivalent report; translate to local returned/unpaid collections rather than assume cheque usage. |
| Bad Debts; Bad Debt Written Off | Related statement WRITE_OFF type; no consolidated bad-debt or write-off report. |
| **Marketing: Marketing Summary; Marketing History; Advertisement Tracking** | Partial/related: Marketing workspace has period campaign/channel/activity metrics and exports; not a full historical SiteLink-equivalence proof. Automatic feeds and attribution reconciliation remain separate gates. |
| Postal Code Statistics | Gap: no postcode aggregation report identified. |
| MapPoint Tenants; Map Tenants | Gap: facility unit map is not geographic tenant mapping. |
| Marketing Roll | Gap: no equivalent consent-aware tenant marketing roll in catalogue. |
| Competitor Comparison | Gap: no equivalent report identified. |
| TeleTracker Activity | Gap: no equivalent integrated call-attribution report established. |
| **Insurance: Insured Roll** | Partial: Insurance participation; recorded enrollments, premiums and waivers. |
| Insurance Activity; Insurance Statement | Gap: participation does not establish historical activity or provider premium/settlement statement. |
| **Merchandise: Merchandise Summary; Merchandise Activity; Merchandise Sales** | Related stock/product/order workspaces; no period sales/activity/summary catalogue reports. Fulfilment and payment settlement must remain distinct. |
| **Deposit: Daily Deposit** | Related recorded daily-close snapshots and cash variance; not a proven bank-deposit reconciliation report. |
| Cash Basis Deposit Details; Accrual Basis Deposit Details; Cash Basis Deposit Summary (truncated labels) | Gap: no corresponding cash/accrual reports. Confirm full labels and accounting definitions. |
| **Management: Management Summary** | Partial: dashboards and occupancy/rent snapshot; no unified management report matching SiteLink. |
| Management History | Gap: current dashboard values are not a historical management snapshot. |
| Lead Funnel | Partial/related: current lead-stage report and marketing funnel metrics; historical transitions need separate logic. |
| Site Inspection | Gap: no equivalent report identified. |
| Occupancy Statistics | Partial: current physical/economic occupancy. |
| Occupied History | Gap: no historical occupancy series in the fixed catalogue. |
| Rate Management History (truncated label) | Partial/related: rent-review approval history and current last-change data; not full rate-management history. |
| Discount Summary; Discounts | Gap: no dedicated discount reporting. |
| Exceptions | Related integration failures, ageing exceptions and diagnostics; no unified business exception report. |
| Hourly Activity; Log On History | Gap: no equivalent hourly/session report in catalogue. |
| Security Settings | Related role/security configuration; no equivalent report. |
| PC Maintenance | SiteLink desktop-specific function; assess device/endpoint monitoring separately for the web platform. |
| Manager Activity | Related audit register; no equivalent scoped manager-activity report in catalogue. |
| **Corporate: Multi-Site Reports & Management** | Partial: organisation/facility scope and some multi-facility rows exist; not full consolidated SiteLink report parity. |
| **Print: Batch Report Processing; Print Start-of-Day Letters & Reports** | Gap: individual PDF exports and tenant documents exist; no equivalent batch/scheduled bundle workflow established. |
| **Custom Reports; Datamine Custom Reporting** | Gap: no saved arbitrary report definitions, visual builder or SQL editor in the inspected portal. |

## Proposed user workflow (not implemented)

1. Choose a template or a business dataset: Tenants & leases, Units, Payments & ledger, Leads & marketing, Insurance, Merchandise or Access & activity. Only expose datasets after validating their source and completeness.
2. Tick readable column names, reorder columns, and choose plain-language filters: Store is Melrose, Unit status is Vacant, Balance is greater than R0, Move-in date is within this month.
3. Optionally group by Store, Month, Product or Lead source; choose compatible totals such as Count, Sum or Average. Explain current snapshots versus historical periods.
4. Preview rows, totals, date basis and data-quality warnings. Save with a report name, duplicate a template, or export Excel/PDF/CSV. Offer table first; charts only where aggregation supports them.
5. Add controlled sharing and daily/weekly/monthly schedules after recipient authorization, delivery, failure handling and audit coverage are implemented. Schema models alone are not working scheduling.

Example: **Outstanding balances by store** → Tenants & leases → Account, Customer, Unit, Store, Balance → Balance greater than R0 → Group by Store → Sum Balance → Preview → Save. This must explicitly state whether it includes closed tenancies and must not be labelled overdue without approved ageing terms.

Implement a server-owned semantic dataset catalogue with approved relationships, field types, permitted filter operators and aggregation rules. Store validated report definitions as structured data, not user SQL. Enforce organisation/facility permissions, dataset/field authorization, current personal-export authority, existing DLP/audit controls and bounded result sizes on every preview/export/run. Saved reports and sharing must never widen the current user's access. Prevent duplicate counting across one-to-many joins; preserve currency, cents arithmetic, SAST dates and snapshot/as-of meanings. The existing export formatter can be reused, but query/filter/grouping and saved-definition services require new implementation.

Start with the current catalogue's trustworthy datasets and commonly requested templates (rent roll, balances, vacant/occupied units, move-ins/out, lead sources). Add detailed finance/payment/ledger and historical reports only with allocation, reversals, VAT, liability and bank/provider reconciliation checks. Build saved reports next; sharing and scheduling follow working authorization and delivery tests.

## Evidence and validation limits

- Catalogue and schema: `src/lib/reporting.ts`; rows: `src/lib/report-data-service.ts`; controls: `src/components/reports-workspace.tsx`; page: `src/app/reports/page.tsx`.
- Catalogue/preview/export APIs: `src/app/api/v1/reports/{route.ts,preview/route.ts,export/route.ts}`; export formatters: `src/lib/report-documents.ts`.
- Adjacent evidence: `src/lib/finance/account-statement.ts`, `src/lib/marketing-reporting.ts`, `src/components/operations-workspace.tsx`, `src/components/rent-review-workspace.tsx`.
- `ReportSchedule` and `ReportRun` exist in `prisma/schema.prisma`, but no source runtime consumers were found in `src` or `scripts`. Do not present scheduling as delivered.
- `groupBy` is accepted in parameters and hardcoded to month by the UI, but is not consumed by the report row service. This is not a working user-controlled aggregation feature.
- Key report source files and schema in the existing reports checkout were compared with fetched remote main with no differences. Focused existing tests are supplementary; source audit does not prove all database results or finance parity.
- No application changes, database writes, provider calls, merge, deployment or fresh authenticated production checks were performed for this audit. Existing canonical context records earlier release checks; they are not new audit evidence. Finance/data/provider/customer/device UAT, legal/privacy/training and approval gates remain open.
