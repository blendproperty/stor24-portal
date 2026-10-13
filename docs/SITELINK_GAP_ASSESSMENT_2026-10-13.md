# SiteLink versus STOR24 gap assessment — 13 October 2026

## Finding

STOR24 has the core operational workflows. The highest-priority gaps are recurring card autopay, an accepted accounting/MRI posting pipeline, and operational/provider/business acceptance. Several report producers and historical data paths remain missing. Existing billing, arrears queues, transfers, inventory and reports must not be classified as wholly absent.

This is a bounded source and installed-artifact assessment, not a production replacement certification or a full exercise of SiteLink's live screens.

## Verified baseline

- REA: 6.4.0, connected directly through this Codex session; matching skill version 37.
- Ghidra: 12.1.4. The sample entry at `0x140001000` decompiled to `return 0x2a;`, with `MOV EAX, 0x2a; RET`. Session closed successfully.
- Sample SHA-256 before and after: `ba9679cbd42b8d8650c9b3318cfec52ce53cf53b924962f07760b76890672e43`.
- Sample analysis Evidence: `ev_412cd5b9674d762a3dafcc5c42dbd8ec6527ca00e3e1c387807386139b4306a9`.
- Installed SiteLink Web Edition: **26.3.1.0**, desktop shortcut targets `C:\Program Files (x86)\SiteLink Web Edition\Bin\SiteLinkClient.exe`.
- SiteLink main executable SHA-256: `17a8671e7e2576b74b2a8337e0e1e171b6825cc791a28e9c3e161c3b4674ee5c`.
- Portal source: `blendproperty/stor24-portal`, remote `main` at `92e86374ef8e8d6e3a0ce5a1bb25feec07114e7b`.
- Website source: `blendproperty/stor24`, remote `master` at `ad786b0bf1a21486dfdd4f78b53563d3033878e9`.
- Existing graph used for workflow discovery; conclusions checked against current remote source and canonical context. Older local checkouts and the August inventory are not the assessed baseline.
- Current website policy offers once-off CARD/EFT for new online bookings following the October 12 change; new-booking debit order was removed. Existing signed authorities are retained. This assessment does not recommend re-enabling that removed path without a separate approved decision.

## What is missing or still needs acceptance

| Priority / area | Present in STOR24 | Gap and next useful action | Current source evidence |
|---|---|---|---|
| P1: recurring card autopay | Once-off card/EFT payment paths and bank mandate/batch infrastructure | Recurring card subscriptions/token-based scheduling are absent. Define provider-supported recurring card authority, scheduler, retries, webhook reconciliation and cancellation. Bank collection is technically developed but remains disabled pending live merchant and business approval. Do not treat a signed bank mandate or report as money collected. | `src/lib/payments/netcash-client.ts:278-307`; canonical context recurring-card and debit-order sections |
| P1: accounting/MRI | Ledger, adjustments/refunds, cash controls and settlement review; MRI settings and read/source checks | MRI posting is explicitly disabled. Agree property/entity, GL/tax mappings, deposit/prepaid treatment, balanced immutable export batches, approval, idempotency, reversals and finance readback/reconciliation. Required finance definitions and acceptance remain open. | `src/lib/mri-service.ts:39,106,134`; `docs/MRI_INTEGRATION.md:5,48-55` |
| P1: operational readiness | Leads, reservations, signing, move-in, notice, same-facility transfer, move-out; guarded access decisions | Prove paid initial invoice, physical identity/key handover, zero-price signed-booking correction, enrolment/entry/revocation and customer/device UAT. A confirmed access decision does not establish an actual gate passage. | `src/lib/leasing-service.ts:615,999,1019-1025,1078,1117`; `src/lib/access-decision-service.ts:5-8,182-194` |
| P1/P2: billing acceptance | Approved account plans, snapshots, previews, serializable invoice posting and history | Enhanced automated billing needs approved plans, finance acceptance and explicit activation; documentation says the switch defaults false and retains the legacy engine. Rate/initial-charge history, variable/year-rollover bank authority and staff invoices remain acceptance gates. No fresh runtime configuration check was made. | `src/lib/monthly-billing-service.ts:18,35,75,76`; `docs/MONTHLY_BILLING.md:17` |
| P2: collections automation | Reconciled ageing, cases/owners/disputes, follow-ups and promises | The queue does not itself send notices, apply collection fees, collect money, change access or post MRI. Define reviewed notice/enforcement policies and delivery/state evidence. Lien/auction workflows are candidate business requirements, not an assumed South African requirement. | `src/lib/collections-service.ts:59,75`; `docs/AGED_COLLECTIONS.md:7-31` |
| P2: native reports and history | Rent roll, tenant directory, payments/ledger, stock/sales/cash-close, scheduled move-outs and sign-in counts | Missing producers/definitions include paired transfer events, complimentary reasons, journal/income/prepaid/deposit/provision reports, complete historical capacity/rate/discount lineage, actual gate passages, immutable tenant-note history and reviewed batch letters. Import schemas or an empty report do not prove native equivalence. | `src/lib/visual-report-templates.ts:9-99`; `docs/REPORTING_CLOSING_MATRIX_2026-10-08.md:25-58` |
| P2: stock and fulfilment | Merchandise catalogue, stock, packages, orders, settlement and fulfilment services | Real supplier costs, receiving/count and UAT stock reconciliation, valuation, per-metre/bulk definitions and paid fulfilment need acceptance. Assessed remote context still describes six inactive package drafts; other local branches may contain newer work that is not integrated in the assessed baseline. | Canonical context package and inventory sections |
| P2/P3: communications and customer history | Twilio lifecycle/OTP setup/logs and separate WhatChimp support bot | Automatic bot-to-CRM lead sync is absent. Handoff email arrival, staff inbox ownership and handset routing remain gates. Calls/TeleTracker feed and reviewed batch-letter audiences/templates/delivery need work. | Canonical context WhatChimp section; `src/lib/visual-report-templates.ts:86,98` |
| P3: corporate/multi-site depth | Organisation/facility scopes, roles and company customers | Full Corporate Control Center parity, consolidated company billing, duplicate customer merge and cross-facility transfers were not established in this targeted review. Confirm operational need, then trace each workflow before treating it as a definite implementation gap. | `prisma/schema.prisma:266,397-404,1242-1255`; transfer facility check `src/lib/leasing-service.ts:1019-1025` |
| Launch: resilience and business go/no-go | Documented controls and previous technical evidence | Independent off-server recovery/key custody, complete document/config recovery, owned delivered alerts, representative authenticated workloads, live settlement, legal/privacy/insurance, stock/data acceptance, training and named go/no-go remain required. Prior deployment records are not a fresh live verification. | Canonical context; `docs/PRODUCTION_READINESS_2026-10-04.md` |

## Direct SiteLink observations and limits

Additional existing STOR24 counterparts were verified: approved rent reviews/increases (`src/lib/rent-review-service.ts:8-36`), insurance enrol/waive/cancel (`src/lib/insurance-service.ts:48-85`), and refund limits/approval/payout recording (`src/lib/adjustment-service.ts:70-72,138,158`). These are not missing features. Automatic insurance rollover/premium remittance, surcharge and maximum-rent policy equivalence were not established by the targeted source review; confirm the business requirement before adding them to the backlog.

REA inspected installed .NET metadata without loading or executing SiteLink, logging in, contacting its hosted backend, or touching customer/payment/device state.

- `SLNet.Accounting.dll` exposes accounting-export classes including MRIAccounting, QuickBooks, Yardi and Sage families, plus transaction-fill/file-output methods. Evidence `ev_b74046becc354c72e0df6179be6a535aa61177cb8444f5ca71583c769f589657`.
- `SLNet.Gate.dll` exposes AccessStorable, BearBox, DoorKing, StorLogix and other adapters with update/validation methods. Evidence `ev_6d80426911e5176f1acc6c3a92dc82830c23782bb2f48d031485cfe70111a098`.
- `SiteLink.Libs.BusinessLogic.dll` exposes refund-with-voided-receipt/no-receipt checks, past-due/payment checks, move-out undo/backdate restrictions, insurance-ledger rollover and surcharge/maximum-rent configuration. Evidence `ev_f8231ce49265ff1898e8988a75ec797460afba05fa41221faf8d75f265514be7`.
- These are static declarations/decoded metadata, with **partial** member coverage. They establish shipped code structure, not that every feature is licensed, configured or effective in this facility.
- The main executable and insurance assembly exceeded REA's 64 MiB metadata representation budget. Their unavailable details are unknown, not absent.
- Gate member results exceeded the MCP transport budget; the retained complete record was exported and read locally without re-running the operation.
- Local July 2026 DEMO observations in `SITELINK_CLOUD_SOLUTION_ANALYSIS.md` supply historical screen/menu context only. They are version 25.2.0.0, not a fresh UI inspection of installed 26.3.1.0.
- Reporting history review already recorded 88 screenshots, with no complete approved legacy CSV. Current native producer gaps are separated from optional migration/history.
- Raw REA records are saved locally under `Sitelink/outputs/sitelink-stor24-gap-audit-20261013/rea-evidence.json`; raw proprietary artifact evidence is not committed to the public project repository.

## Evidence stages

**Implementation:** assessment documentation only. No STOR24 application, database or SiteLink implementation changes.

**Testing/validation:** connected-session sample decompilation passed, source hash unchanged, analysis session closed; targeted installed managed-artifact metadata inspection and current remote source/context review performed. No fresh application test suite or business UAT was run because runtime code did not change.

**Commit and push:** this assessment and the portal context are recorded on the task's documentation branch; remote head/context presence is verified at handoff.

**Merge:** no application or documentation merge is claimed by this assessment.

**Deployment/configuration:** no production deployment, provider activation, customer transaction or SiteLink configuration change.

**Live production verification:** no fresh live portal/provider/device/accounting/communications acceptance was performed. The sample validates local REA/Ghidra, not production readiness. Existing gates remain open.

## Recommended sequence

1. Agree card-autopay scope and obtain merchant-approved bank collection/settlement evidence.
2. Close finance definitions and MRI/export acceptance using reconciled batches.
3. Prove the complete customer handover and physical access lifecycle with controlled UAT.
4. Build the remaining native report producers with approved historical definitions.
5. Reconcile real stock and fulfilment, then decide which corporate/call/marketing extras are required.

Do not prioritise visual screen parity ahead of financial integrity, actual provider effects and operational acceptance.

