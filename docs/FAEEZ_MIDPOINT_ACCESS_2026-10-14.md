# Faeez Midpoint workflow access

14 October 2026. Meeting item 18 covers the existing Faeez Baboo account at Store 1 - Midpoint. Access configuration and technical authorisation checks are separate from Faeez's own password login and hands-on workflow acceptance.

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


## 16 October 2026 - current access and next own-account acceptance

The dated 14 October evidence above is historical. A new read-only check at 08:43 SAST on16October confirms29 permissions, sessionVersion7, one Store1-Midpoint assignment, no unrestricted assignment and no other active user sharing this custom role. The complete permission set matches Brett's approved permission-update audit. Only the previously approved booking-price view and propose access is present; price approval remains false. No permissions, password/MFA settings or sessions were changed or manufactured by this check. Evidence: output/faeez-acceptance-20261016/independent-readback.json.

The pool fix is separately deployed and read-only verified at main78b837f7. This is technical deployment evidence, not Faeez's login or staff acceptance. On 16 October Brett reported: "Faeez can sign in and Midpoint opens". Own-account login and Midpoint entry are now HUMAN-CONFIRMED; the exact attempt time was not supplied. This does not confirm the remaining customer, download or staff workflows.

Work one step at a time:

1. **Now - original18, own sign-in:** Faeez uses his existing account at https://portal.stor24.co.za/login and opens Midpoint. Record tester/date/store and only the result or error. Never send a password or verification code. Status: PASS - Brett reports Faeez signed in with his own account and Midpoint opens (16 October; actual attempt time not supplied).
2. **After sign-in - original4/5/13:** in Customers & tenants, select an existing approved training customer, confirm the same customer/store in Communications and history, then download PDF, CSV and Excel. Open each file and check the selected customer, filters, older matching records, dated authors/categories and retained message content. Missing external source content must stay labelled; a download cannot reconstruct absent messages or attachments. Status: not run by Faeez.
3. **Then - original6/15:** on that approved training customer, save one clearly labelled staff-acceptance note with the appropriate category. Refresh and verify exactly one retained note, Faeez's author name and SAST server date. Add any correction as a new note. Have a second already authorised staff member read the same history in their own session; record the named actor and result. The incoming manager starts1November and is not treated as onboarded or tested. Status: not run by the staff pair.

These steps do not create a payment, correction, refund, price approval, customer message or provider authentication. Financial approval and provider activation remain separate. Owner or synthetic-session evidence is not a substitute for Faeez's own sign-in; server/source PDF bytes are not an ordinary browser download. The verification browser tool remains unavailable, so genuine ordinary-download and staff/device acceptance gates stay open until observed or specifically reported by the actual tester.


### Next acceptance checkpoint - customer history read

After the confirmed login, Faeez opens a Midpoint customer known to have recorded notes or messages and checks the History tab. Confirm existing dated notes and communications belong to that selected customer/store. Report only whether the history is visible or the error; no customer details are required. This read is the next single check. New-note persistence, a second authorised staff read and actual PDF/CSV/Excel files remain separate pending checks. No new note, export, permission or financial action is inferred from the login report.
