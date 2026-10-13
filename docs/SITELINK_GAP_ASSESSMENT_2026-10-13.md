# STOR24 versus SiteLink — feature comparison
Assessment date: 13 October 2026

## Scope and conclusion

This compares **what STOR24 and SiteLink support**. It covers shared capabilities, narrower or broader coverage, different implementations and unverified equivalence. UAT, merchant approval, training, migration and deployment are operational gates, not feature gaps; they remain recorded in PROJECT_CONTEXT.md.

STOR24 covers the central storage workflows: leads, reservations, leases, move-in, accounts, invoices, payments, arrears queues, rent increases, transfers, move-out, stock and reporting. SiteLink has broader established automation, accounting export options, corporate management, third-party integrations and historical reporting. STOR24 has its own browser booking journey and integrations for Netcash, BlendSign, facial-access workflows and WhatsApp support. Those differences do not by themselves establish that either product is better.

**Both support** means comparable capability exists, not identical business rules or complete workflow equivalence. **Partial** means STOR24 supports part of the specific SiteLink capability. **Not evidenced** means this bounded review did not establish the counterpart; it must not be read as proof of absence.

## Side-by-side capability matrix

SiteLink evidence keys: **D** = historical local DEMO screen observation; **M** = installed 26.3.1.0 module metadata; **P** = official product documentation. A feature advertised for the SiteLink product/ecosystem is not automatically enabled in the laptop's facility, licensed bundle or region.

| Capability | SiteLink | STOR24 | Comparison |
|---|---|---|---|
| Leads and reservations | Lead to Lease, CRM and reservation functions (D); online reservation/rental channels (P1). | Leads, reservations, unit holds and public booking journey. | **Both support.** Matching lead stages, fields and loss reasons were not exhaustively compared. |
| Move-in and move-out | Dedicated Move In and Move Out workflows (D); move-out undo/backdate rule classes (M3). | Signing, move-in, notice and move-out lifecycle services. | **Both support.** Exact undo/backdating and final-charge rule parity is unverified. |
| Transfers | Dedicated Transfer workflow (D). | Transactional same-facility unit transfer. | **Both support unit transfers.** STOR24 source restricts the destination to the same facility; no cross-facility equivalence was established. Paired transfer-event reporting is narrower. |
| Tenant accounts and ledger | Tenant/payment functions (D), refund/void rules (M3). | Tenant accounts, ledger entries, payments, adjustments and reversals. | **Both support.** Allocation and account-rule equivalence was not fully tested. |
| Invoicing and monthly charges | Invoicing and background recurring billing options (D/P2). | Approved billing plans, charge/discount snapshots, previews, invoice posting and history. | **Both support billing.** This row compares functionality, not whether an automation switch is currently enabled. |
| Recurring card payments | Scheduled monthly recurring payments are documented (P2). | Reviewed Netcash card form is once-off; no recurring-card runtime is implemented in the assessed source. | **Confirmed feature gap: recurring card autopay.** This is distinct from recurring invoice generation. |
| Bank-debit payments | ACH/bank-debit billing function (D). | Netcash signed mandate and debit instruction/batch infrastructure. New online bookings intentionally use once-off CARD/EFT. | **Different payment/provider design.** SiteLink ACH and Netcash authority semantics are not equivalent by name. Removed new-booking debit is a deliberate product policy, not a missing booking screen. |
| Refunds | Refund queues (D); guards for voided/no-receipt refunds (M3). | Refund limits, approval decisions and payout recording. | **Both support refunds.** Exact receipt/void/undo safeguards require a rule-level comparison. |
| Arrears and collection work | Collection Calls, Tasks & Letters, past-due/overlock/cut-lock queues (D). | Aged collections, cases, owners, disputes, follow-ups and promises to pay. | **Both support collection work.** STOR24's reviewed queue does not itself orchestrate letters, fees, money collection or access changes. SiteLink's exact automated effects for those actions were not freshly exercised. |
| Rent increases | Tenant-rate management and occupancy/rule-based Price Optimizer are documented (P3). | Duration-based review, notice validation, approved group increases and effective rent schedules. | **Both support rent increases.** Broader occupancy-driven pricing/discount optimisation has no established counterpart in this review. |
| Insurance/protection | Insurance functions in the product (P4); insurance-ledger rollover declarations (M3). | Enrol, waive and cancel coverage, plus recorded premium information. | **Both support enrolment.** Automatic rollover and provider premium/remittance reporting parity are not established; STOR24's native insurance-statement source explicitly lacks settlement/remittance data. |
| Merchandise | Merchandise Purchase and Reorder queues (D). | Product catalogue, stock movements, order/settlement/fulfilment services and package offerings. | **Both support merchandise.** Stock valuation, reorder, receiving and returns rules were not completely compared. Supplier data or unfinished UAT is not a missing merchandise feature. |
| Daily close | Daily Close and Receipt Audit functions (D). | Cash-close controls, payment/ledger reporting and settlement review. | **Both support closing/review.** Exact till, tender, period-lock and receipt-audit equivalence is unverified. |
| Accounting export | Shipped export classes for MRI, QuickBooks, Yardi, Sage and other packages (M1). | Ledger and MRI settings/read/source review; no MRI journal-posting implementation. | **Confirmed difference:** SiteLink contains accounting export implementations; STOR24 has no equivalent implemented MRI posting/export pipeline in the assessed source. A SiteLink file export is not proof of direct live MRI API posting. |
| Core reports | Single-site and consolidated reporting, Excel/PDF/text outputs (P1); Reports/Graphs screens (D). | Rent roll, tenant directory, ledger/payment history, stock/sales/cash close, move-out and sign-in reporting. | **Both support reporting.** Neither the existence of a report menu nor import schemas establishes equal calculations or data lineage. |
| Financial/history report depth | Historical local report comparison identifies financial, capacity/rate/discount, notes and gate-history categories (D/report reference). | Native gaps explicitly recorded for journal/income/prepaid/deposit/provision reports, paired transfers, complimentary reasons and several history/event sources. | **Partial report parity.** These are specific missing producer/report paths. Empty records at a new operation or incomplete migrated history are separate data conditions. |
| Access control | Installed adapters include AccessStorable, BearBox, DoorKing and StorLogix (M2). | Desired/pending/confirmed access decisions, facial-access queue and revoke adapter. | **Different and narrower integration coverage.** Matching tenant/access use cases exist; physical gate-passage feed/reporting is not implemented by access decisions. |
| Electronic leases/documents | SiteLink eSign and document storage/auditing (P1). | BlendSign lease/envelope integration and signing/reconciliation records. | **Both support electronic agreements.** Signature/audit rules and supported document types were not exhaustively compared. |
| Online/mobile operation | Desktop Web Edition plus web reports, myHub and partner website/API channels (P1/P2). | Browser portal and public mobile booking/payment journey, with scoped offline lead/reservation services. | **Different delivery architecture.** STOR24 is browser-centred; SiteLink also provides browser channels. No claim of complete offline parity or unique online capability. |
| Communications | Email/letters/texting and marketplace call-centre/TeleTracker integrations (P1). | Twilio lifecycle/OTP communication logs and separate WhatChimp support bot. | **Different channels/integrations.** Native call-event attribution and reviewed batch-letter workflow counterparts are not established; the support bot does not automatically sync leads into CRM. |
| Multi-site/corporate | Corporate Control Center, consolidated reports and cross-store configuration/letter standardisation (P1). | Organisation/facility scoping, roles and company customer records. | **Partial enterprise equivalence.** Full corporate consolidation, cloning settings/templates and central approval parity were not established. |
| Geography/competitor/desktop reports | Categories present in historical SiteLink reporting references (D). | No maintained competitor, verified geocoding or endpoint-health dataset identified in corresponding native templates. | **Narrower ancillary coverage.** Desktop-PC maintenance may be an architectural difference rather than a needed storage feature. |

## Differences that matter most

The clearest demonstrated SiteLink-side advantages in this review are recurring card autobilling, the breadth of shipped accounting-export adapters and access-provider adapters, and corporate/consolidated management functions. Specific financial/history reports and automation breadth also differ, with the evidence qualifications in the matrix.

STOR24's implementation is tailored around Netcash, BlendSign, facial-access governance, a browser booking flow, merchandise packages and WhatsApp assistance. These are implemented choices, not proven exclusive advantages over all SiteLink partner configurations. Provider branding, regional payment policy and user-interface layout are **differences**, not automatically missing functionality.

The shared features should remain in the comparison: leasing, invoicing, tenant ledger, collection cases, rent increases, refunds, insurance enrolment, stock, electronic agreements and core reports.

## Source and evidence index

### STOR24 baseline and source anchors

Portal: `blendproperty/stor24-portal/main` at `92e86374ef8e8d6e3a0ce5a1bb25feec07114e7b`. Website: `blendproperty/stor24/master` at `ad786b0bf1a21486dfdd4f78b53563d3033878e9`. Remote heads were rechecked for this revision.

- Leasing/transfers: `src/lib/leasing-service.ts:615,999,1019-1025,1078,1117`.
- Billing/card payments: `src/lib/monthly-billing-service.ts:18,35,75,76`; `src/lib/payments/netcash-client.ts:278-307`.
- Bank-debit infrastructure: `src/lib/payments/netcash-mandate.ts`, `netcash-debit-batch.ts`; website canonical context records new-booking CARD/EFT policy.
- Collections: `src/lib/collections-service.ts:59,75`; `docs/AGED_COLLECTIONS.md:7-31`.
- Rate review, refunds, insurance: `src/lib/rent-review-service.ts:8-36`; `src/lib/adjustment-service.ts:70-72,138,158`; `src/lib/insurance-service.ts:48-85`.
- Accounting: `src/lib/mri-service.ts:39,106,134`; `docs/MRI_INTEGRATION.md`.
- Report coverage: `src/lib/visual-report-templates.ts:9-99`; `docs/REPORTING_CLOSING_MATRIX_2026-10-08.md:25-58`.
- Access: `src/lib/access-decision-service.ts:5-8,182-194`; `src/lib/biometric-access-service.ts`.
- Merchandise/signing/offline: `src/lib/merchandise-order-service.ts`, `merchandise-order-settlement.ts`, `merchandise-order-fulfilment.ts`, `blendsign-lease-service.ts`, `offline-lead-service.ts`, `offline-reservation-service.ts`.
- Corporate scope: `prisma/schema.prisma:266,397-404,1242-1255`. Existing graph used to find workflows; current source provides the implementation evidence.

### SiteLink evidence

**D:** `SITELINK_CLOUD_SOLUTION_ANALYSIS.md` in the local Sitelink workspace records July 2026 DEMO screen observations from 25.2.0.0. Those are historical screen/menu evidence, not fresh runtime verification of 26.3.1.0. Reporting references and existing closing matrix supply category context.

**M:** installed Web Edition is 26.3.1.0. `SiteLinkClient.exe` SHA-256: `17a8671e7e2576b74b2a8337e0e1e171b6825cc791a28e9c3e161c3b4674ee5c`.
- M1 accounting: `ev_b74046becc354c72e0df6179be6a535aa61177cb8444f5ca71583c769f589657`.
- M2 gate adapters: `ev_6d80426911e5176f1acc6c3a92dc82830c23782bb2f48d031485cfe70111a098`.
- M3 business rules: `ev_f8231ce49265ff1898e8988a75ec797460afba05fa41221faf8d75f265514be7`.

Managed-member coverage is partial. The main executable and insurance assembly exceeded REA's 64 MiB representation budget. Shipped declarations establish code structure, not facility configuration, licensing or live effects. Raw retained evidence is local under `outputs/sitelink-stor24-gap-audit-20261013/rea-evidence.json`; proprietary records are not committed here.

**P:** official SiteLink product evidence, fetched 13 October 2026:
- P1: [SiteLink product overview](https://www.sitelink.com/) — online channels, reports, corporate controls, eSign and partner ecosystem.
- P2: [SiteLink payment solutions](https://www.sitelink.com/solutions/payment-solutions) — monthly recurring Auto-Bill and payment channels.
- P3: [SiteLink brochure](https://www.sitelink.com/downloads/sitelink-smart-management-software-brochure.pdf) — Price Optimizer and configurable rate/discount rules. This is historical product literature; exact installed-build/region behaviour was not exercised.
- P4: [SiteLink insurance and protection plans](https://www.sitelink.com/marketplace/insurance-protection-plans) — integrated coverage charges and provider ecosystem. Regional/provider availability can differ.

## Assessment validation and boundaries

REA 6.4.0 and Ghidra 12.1.4 were verified directly in the Codex session on 13 October: the known native sample returned decompiled `0x2a` (42), unchanged SHA-256 `ba9679cbd42b8d8650c9b3318cfec52ce53cf53b924962f07760b76890672e43`, and the analysis session closed. Sample Evidence: `ev_412cd5b9674d762a3dafcc5c42dbd8ec6527ca00e3e1c387807386139b4306a9`. SiteLink itself is managed code and was inspected using REA's managed tools.

This revision changes comparison documentation only. It does not run SiteLink transactions, change STOR24 runtime code, merge/deploy software or certify production readiness. Existing UAT, provider, finance, data and business gates remain in PROJECT_CONTEXT.md and are excluded from the feature-gap matrix.
