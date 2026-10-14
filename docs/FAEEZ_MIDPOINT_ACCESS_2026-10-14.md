# Faeez Midpoint workflow access

14 October 2026. Meeting item 18 covers the existing Faeez Baboo account at Store 1 - Midpoint. Access configuration and technical authorisation checks are separate from Faeez's own password login and hands-on workflow acceptance.

## Account evidence refreshed during customer-history release - 14 October 2026

Read-only production checks at14:39 SAST confirm the same26 grants, active account and Midpoint-only role; current sessionVersion is5. Audit records show password-reset completion at14:17:47 and a successful normal account login at14:17:56 SAST. These subsequent access/credential actions were not performed by the customer-history implementation. The earlier not-tried/sessionVersion2 record below is a historical checkpoint. Actual Faeez/covering-staff workflow acceptance remains open; an account audit does not identify the human tester or prove the agreed end-to-end workflows.

## Scope and approval separation

Preserve the accepted account, unique custom role and single Midpoint assignment. The previous seven grants are retained. Add exact operations/customer management, inventory viewing, ledger viewing, payment reviewing/receipt recording, collections casework, correction requests, reviewed customer-document sending and relevant reports. The permission editor now exposes six existing backend permissions that previously required broader grants or could not be saved: operations.manage, inventory.view, ledger.view, payments.view, payments.manage and billing.documents.send. No authorisation guard or financial approval policy changes.

Saved and verified grants (26):

```text
access.view
adjustments.request
adjustments.view
billing.documents.send
billing.view
collections.export
collections.manage
collections.view
communications.view
facility.*
facility_map.view
identity.review
inventory.view
leads.*
ledger.view
move_in.create
operations.manage
operations.view
payments.manage
payments.view
reports.collections
reports.export
reports.financial
reports.sales
reports.view
reservations.*
```

Withhold adjustments.approve, adjustments.record_refund, settlements.approve/manage/import, billing.manage, debit_orders.manage/submit, collections.policy, mri.manage, users.manage, configuration.manage, access.manage/suspend/restore, data.personal_export and ledger.manage. Existing organisation-owner authority remains unchanged. Preparing an adjustment does not post it; independent approval remains required. Ordinary verified receipt recording is allowed, while refunds/corrections use the reviewed adjustment workflow. Personal-data exports still require explicit Super Admin authority, even when report export is granted.

## Faeez Midpoint access released and technically verified - 14 October 2026

- **Implementation:** six exact existing backend permissions are now selectable/savable in the staff permission editor. Customer/operations, inventory, ledger, payment review/receipt entry and reviewed document access can be granted without financial approval authority. No schema, authorisation guard or approval policy changed.
- **Testing:** 21 focused checks passed; full local suite: 768 results, 767 passed, zero failures and one existing optional visual skip. Permission editor checks passed at 1440/390/320 with mobile visual review; changed-source lint and final complete-dependency typecheck passed. Source and merged-main protected CI, transaction, security and CodeQL checks passed. Main runs: CI38555186003, transactions38555185968, security38555186113, CodeQL38555186001.
- **Commit and push:** application/context source e48ca4ea5e9a683c919a4c62a0b80d851fee45e0 was pushed and checked. This subsequent documentation evidence is maintained on codex/faeez-midpoint-access-evidence-20261014; its own push and review are separate from the application release.
- **Merge:** application PR484 merged normally to main8347a65ae61680a4c99f25fd6f9ef8adf10e25ec; validated candidate and merged tree match. The subsequent evidence documentation is not yet merged.
- **Deployment and configuration:** normal Deploy38556590216 succeeded. Runtime readback at 11:30UTC confirms healthy stor24-crm:8347a65a, image sha256:c7e4bb460f164a7e1e54b9f0ba1fa2d75b149cd9aee895b45db0fb1c337c4e70 and matching checkout. At 13:32:50 SAST the normal owner-only permissions API saved Faeez's 26 exact grants, retained his unique custom role and single STORE-1 Midpoint scope, and advanced sessionVersion1 to2. Existing password/MFA and accepted account retained; no invitation/reset email sent.
- **Live production verification:** 13:35:47 SAST readback confirms all26 grants and Midpoint-only scope; live permission editor shows26 selected. Short-lived server-memory Faeez-role verification requests returned200 for leasing/accounts/collections/adjustments/operations/leads/marketing; cross-store reads, financial approval, settlement reads and staff permission changes returned403. Previous-version session returned401. Business record counts and other staff remained unchanged during final checks. This verifies authorisation, not password/MFA login or real financial transactions.
- **Remaining gates:** Brett confirms Faeez has not tried signing in yet. Item18 remains CONFIGURED / TECHNICALLY VERIFIED / STAFF LOGIN AND UAT OPEN. Use normal https://portal.stor24.co.za/login with existing credentials; old sessions require a fresh sign-in. Independent financial approvals, refund payouts, settlements, billing/debit administration, collection policy, physical-access changes and personal-data exports remain withheld. Customer history/dated notes and all existing finance/provider/customer/device/legal/privacy/data/training/approval gates remain open. No external tracker is in scope.
