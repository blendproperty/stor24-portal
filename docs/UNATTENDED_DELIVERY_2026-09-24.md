# STOR24 evening delivery — 24 September 2026

This checkpoint consolidates the authorised unattended session across Priority 2 security, Priority 3 finance, Priority 7 operations and Priority 9 communications. **All 14 programme priorities remain open for acceptance.** Individual technical changes were tested and released; no legal, provider, financial or staff sign-off is implied.

## What changed

| Priority / stable ID | Implemented and tested | Acceptance still required |
|---|---|---|
| 2 / P14: privacy and CIA | Current-session revocation regressions; safe staff projections; stock/customer/message/account isolation; restricted unassigned delivery history; opt-out preservation; dependency, secret and code scanning; synthetic database recovery drill. | Google credential rotation confirmation, staff permission/MFA/recovery UAT, legal/biometric/PAIA approval, processor/deletion evidence, production backup and alert delivery acceptance. |
| 3 / P02: finance | Reconciled-balance billing guard; invoice charge completeness; inclusive South African statement dates; concurrent document numbering; same-request manual receipt recovery; billing email claims. | Approved opening balances and source reconciliation, tax/rent policy, MRI/payment-provider evidence, cross-request duplicate review, billing schedule credential correction and finance sign-off. |
| 7 / P06: operational settings and daily close | Immutable close with atomic audit, cash cent/range validation, company setup load/save/partial-save recovery with retained form values and explicit refresh. | Real close source totals, correction/reopen and posting-period policy, enforcement of all saved defaults, manager walkthrough. |
| 9 / P08: portal and communications | Bounded provider timeouts; callback replay/order handling; WhatsApp and booking email/SMS attempt claims; clear uncertain-delivery handling; booking notification failure isolation; channel-aware staff delivery history. | Real provider delivered/read evidence, legacy/uncertain attempt reconciliation, cross-key duplicate policy, consent/preference and staff acceptance. |

No real payments, customer messages, customer balances, physical access actions or gate/photo/training switches were changed during this session. Transaction and transport tests used synthetic data. Production verification was read-only.

## Verification boundaries

- Latest source candidate: 441 local unit tests passed, with typecheck and focused lint. Required GitHub checks include application validation/build, browser recovery checks, guided-help, real isolated PostgreSQL transaction/journey tests and security scanners. Each source PR was merged only after its required checks passed.
- Security fixes received fresh independent prepatch investigation and postpatch review where required. The scoped account-document finding and unassigned-message finding were demonstrated using synthetic fixtures; no production exploitation or prevalence was established.
- Company setup recovery was exercised through the actual component at 1440px and 390px with STOR24 Satoshi/brand/staff styling. Communications actual-page synthetic rendering was checked at those widths with three channels and no document overflow; its wide table retains local scrolling. These checks are not authenticated production staff acceptance.
- The synthetic restore drill matched **75 tables**, rows and hashes, constraints, indexes, enums and sequences. The source was unchanged and the disposable target was removed. Initial evidence: [workflow 36044376433](https://github.com/blendproperty/stor24-portal/actions/runs/36044376433), artifact **10828260956**, `synthetic-restore-evidence`. It does **not** prove production backup encryption, off-system retention, recoverable keys, approved RPO/RTO or deletion reapplication.
- GitHub readback at approximately 19:38 UTC and again before the final checkpoint reported zero open dependency, code and secret alerts. That does not establish absence of all vulnerabilities or revocation of the historically exposed Google credential.
- Anonymous production checks at approximately 19:49 UTC returned 401 for configuration, accounts and operations APIs; privacy and PAIA pages returned 200. No customer payloads or authenticated private records were read.

## Promotion and live evidence

PR270 head `1f1b285b12c0d0dd1e92579079a18dff29cda9e7` passed required CI 36050573967, isolated PostgreSQL 36050573971 and security checks 36050574013. It merged as `89dcef6cb5d8a55712f20b04a8030e6992465cc2`. Main CI 36050880269 and deployment 36051179733 passed. At 19:55:01 UTC the exact running image `stor24-crm:89dcef6cb` was healthy and public service/database readiness was OK. No production customer data was queried or changed.

Latest application release and final documentation promotion are recorded in the newest dated entry in [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). A merged PR is not deployment evidence. Historical pending statements in earlier entries are superseded only by later explicit verification.

The table below records immutable merge commits checked against GitHub. Deployments are separately recorded in the canonical context and Excel Evidence log; documentation-only checkpoints do not imply a new application behaviour.

| PR | Change | Merge commit |
|---|---|---|
| [243](https://github.com/blendproperty/stor24-portal/pull/243) | Prove staff session revocation and current permissions | `9cc511fea1e2de85e5ad3dd182c6285c0add865a` |
| [244](https://github.com/blendproperty/stor24-portal/pull/244) | Require reconciled balances before monthly billing | `13cd1981d4f9ca12a83dd759a62f568041db55e9` |
| [245](https://github.com/blendproperty/stor24-portal/pull/245) | Limit staff details returned by operations | `c1148ed7f26ebfb328cbab21d6c639b3c492eda4` |
| [246](https://github.com/blendproperty/stor24-portal/pull/246) | Record unattended billing and privacy release evidence | `141de62ff5280f074c178b0951b74f82b6e2a581` |
| [247](https://github.com/blendproperty/stor24-portal/pull/247) | Enforce facility permissions before stock movements | `1c1a6e8254d6615905f8e5b3e2fa71fa8aa98c26` |
| [248](https://github.com/blendproperty/stor24-portal/pull/248) | Preserve closed-day snapshots and save their audit atomically | `1b47214ecb807916cd13a439e8d7dc6cc825444b` |
| [249](https://github.com/blendproperty/stor24-portal/pull/249) | Wait for tenant section navigation in browser acceptance checks | `079ae6c739ddbdb036d8e0ee769bffdcafe0f708` |
| [250](https://github.com/blendproperty/stor24-portal/pull/250) | Reject non-charge and incomplete invoice selections | `e15e1e4a597f87abd7a7b927ee6ad51e76d0b2d4` |
| [251](https://github.com/blendproperty/stor24-portal/pull/251) | Record daily-close deployment and invoice validation promotion | `f4e2e0a0530c84cb2e0a1a7540095c8564171212` |
| [252](https://github.com/blendproperty/stor24-portal/pull/252) | Prevent duplicate invoice and statement email attempts | `bba6e5c1e8c59b7ed79946887350ce9243619387` |
| [253](https://github.com/blendproperty/stor24-portal/pull/253) | Include the complete selected date range in emailed statements | `caab923d5f2829166ed0573b80375ae79476fbb0` |
| [254](https://github.com/blendproperty/stor24-portal/pull/254) | Bound email provider requests to 15 seconds | `ff3d093e49394922a4911eaa7f2d967a9861ed7e` |
| [255](https://github.com/blendproperty/stor24-portal/pull/255) | Prevent duplicate delivery-failure tasks from callback replays | `3d75d2544e40acb75652c9753e84c572858f83ba` |
| [256](https://github.com/blendproperty/stor24-portal/pull/256) | Restrict account document metadata to the staff organisation | `5e186299686c6a74b28391f70c75932326476e1f` |
| [257](https://github.com/blendproperty/stor24-portal/pull/257) | Prevent duplicate manual receipts after lost responses | `92be964667117da7c6443084efdefb919c61d63a` |
| [258](https://github.com/blendproperty/stor24-portal/pull/258) | Bound SMS and WhatsApp provider requests | `4af496c881901490306dbc735a4166a977bfe09d` |
| [259](https://github.com/blendproperty/stor24-portal/pull/259) | Enforce customer and facility scope for manual WhatsApp delivery | `2f042623ef382fde93cd369cd81f8b6bcc848941` |
| [260](https://github.com/blendproperty/stor24-portal/pull/260) | Preserve confirmed delivery across out-of-order callbacks | `d98be026a5ca930ddbf44739b1f41289cc9e7bce` |
| [261](https://github.com/blendproperty/stor24-portal/pull/261) | Prevent duplicate WhatsApp attempts and false retry success | `d851bafc03e30a7a1456d0daaa1e758eb72b1b6c` |
| [262](https://github.com/blendproperty/stor24-portal/pull/262) | Add isolated synthetic database restore verification | `45b0bac1e2f3572f382a87c3ccd7360debe65bdd` |
| [263](https://github.com/blendproperty/stor24-portal/pull/263) | Serialize invoice and statement number allocation | `aabb348eff2085d67db103053efbf1715013555e` |
| [264](https://github.com/blendproperty/stor24-portal/pull/264) | Distinguish accepted SMS requests from confirmed delivery | `88fbd655dd2464e7f31ba473ad52f2b3de021a06` |
| [265](https://github.com/blendproperty/stor24-portal/pull/265) | Keep notification failures from interrupting committed bookings | `1398673720c93c739ee8eea7abf7a2a720a77e30` |
| [266](https://github.com/blendproperty/stor24-portal/pull/266) | Preserve WhatsApp opt-out in offline booking consent | `ffcdfa28fcf96041190f64368adb1b75b3191847` |
| [267](https://github.com/blendproperty/stor24-portal/pull/267) | Prevent duplicate booking email and SMS attempts | `b4f4c0ddc8008753d257f169e54d29cf43641122` |
| [268](https://github.com/blendproperty/stor24-portal/pull/268) | Reject fractional-cent daily-close cash totals | `2fca1bc71b5f9ca9a613f04ad30e60aebe36671c` |
| [269](https://github.com/blendproperty/stor24-portal/pull/269) | Recover company setup failures without losing entered values | `6164000bdc7b42e05ece07290d91e53458546116` |
| [270](https://github.com/blendproperty/stor24-portal/pull/270) | Show email and SMS delivery attempts without leaking unassigned customer logs | `89dcef6cb5d8a55712f20b04a8030e6992465cc2` |

## Next acceptance walkthroughs

Use approved synthetic records and the existing owner-controlled training arrangements. Do not alter operational switches as part of these walkthroughs without explicit authorization. Preserve required payment, ID, photo and provider gates.

| Walkthrough | Check | Required evidence / pass condition |
|---|---|---|
| Owner and manager access | Compare assigned facility, other facility, empty facility grants and revoked session; include direct account/document and message-history requests. | Allowed records remain usable; denied requests reveal no private metadata; revoked sessions stop working. Capture role/facility matrix and screenshots without personal data. |
| Receipt recovery | Record an approved synthetic receipt; simulate a lost response and retry the same form request. | One receipt, one balance change and one audit outcome. A changed amount/reference under the same request is rejected. Separate bank-reference duplicates require finance review. |
| Statement / invoice | Compare accepted source charges and payments with opening/closing balance; include month-end dates and two simultaneous requests. | Complete charges, correct South African date range, distinct document numbers and a reconciled balance. A PDF or HTTP success alone is insufficient. |
| Daily close | Enter valid cash, attempt sub-cent input, close once, then retry or attempt an edit. | Valid totals/variance agree with accepted source records; invalid values do not write; completed close and audit remain unchanged. Agree authorised correction policy. |
| Company setup | Lose the response during a save, reload failure, and a multi-stage store save. | Entered fields remain, controls recover, confirmed stages are clear; refresh shows saved state. Refresh before retrying uncertain store creation. |
| Communications | Review failed, pending, accepted, delivered and read synthetic attempts across email/SMS/WhatsApp. | Staff see only permitted customers; accepted is not presented as confirmed delivery. Unknown outcomes require provider review, with no blind resend. |
| Recovery and privacy | Restore an approved production-derived backup into an isolated destination under the approved privacy procedure; rehearse request/deletion and an alert. | Measured recovery against approved targets, protected keys/data, deletion reapplication, named recipient receives alert, and evidence is signed off. The CI drill alone cannot close this. |

## Items requiring Brett or an external owner

1. Identify the Google credential owner and verify rotation/deployment of the exposed historical reCAPTCHA secret. Rotation was not attempted under an unidentified account.
2. Obtain legal decisions on notices, formal PAIA manual, compulsory biometrics/alternatives, retention and withdrawal. Draft publication and an owner toggle are not legal approval.
3. Obtain provider evidence for payments, signatures, Hikvision enrolment/removal/access and approved processing arrangements.
4. Assign finance and facility reviewers, approve opening/source balances and agree correction/recovery policies.
5. Approve recovery targets and demonstrate production backups, keys, off-system retention and delivered operational alerts.

The [delivery checklist](STOR24_DELIVERY_CHECKLIST.md) and existing Excel tracker retain Build → Test → Commit/push → Merge → Deploy/configure → Live verification → Acceptance as separate states. No whole priority was checked off by this session.
