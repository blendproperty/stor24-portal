# STOR24 CEO walkthrough — 28 September 2026, 15:00 Johannesburg

Presentation freeze: 14:30 Johannesburg. This is a guided demonstration, not launch sign-off.

## Opening message

“STOR24 connects the customer booking to the staff handover and ongoing tenancy. The workflow shows what is complete, what needs action and what prevents keys being released. We have delivered and verified 42 tracked components; final business acceptance remains separate.”

## Ten-minute walkthrough

| Time | Show | Explain |
|---|---|---|
| 0–2 min | Existing customer booking in My STOR24 | Unit, agreement, payment information, identity submission and customer documents belong to one customer journey. Use an authorised synthetic record; avoid exposing real customer identity documents. |
| 2–5 min | [Operations → Move in](https://stor24-site.srv938083.hstgr.cloud/operations/move-in) | Follow the six steps: Select unit → Agreement → Payment → Check ID → Access photo → Hand over keys. Completion and outstanding requirements are visible. Open the relevant step rather than searching elsewhere. |
| 5–6 min | Handover requirements on the selected booking | Staff must verify identity, the required payment, signed agreement, approved photo and applicable move-in conditions. A test payment does not clear a real booking. A disabled handover is an enforced requirement, not permission to bypass it. |
| 6–8 min | Existing tenancy/account and statement | Explain the transition to ongoing tenancy, balances and documents. Show existing records read-only. Financial accuracy still needs comparison with approved source balances and transactions. |
| 8–9 min | Operations and reports | Show daily-close review, scoped reports and inventory visibility. Daily close is a staff attestation; it does not itself prove bank reconciliation. |
| 9–10 min | Delivery tracker and remaining decisions | Separate Built/Tested/Deployed from Staff accepted. Agree who will verify the connected journey and the outstanding provider, finance and legal requirements. |

## If a step is blocked

Explain the specific requirement shown. Do not change dates, record fictitious live payments, approve real identity/photos, release holds or hand over keys just to continue the presentation. If training is already enabled and available to the presenting account, the existing [training flow](https://stor24-site.srv938083.hstgr.cloud/operations/move-in/training) can demonstrate the sequence. Do not switch training on or promise availability without checking the account's current permissions. Otherwise use the read-only walkthrough and existing synthetic test evidence.

Photo approval and key handover do not by themselves prove that Hikvision precinct access is active. Provider enrolment, physical entry and suspension/restoration/removal require their own verification.

## Evidence and honest limits

- Latest verified functional release: PR351, merge `dc5a5aacc5f285de42a04efdeae565f093b864d8`.
- 493 unit tests passed, with required database/security/browser checks. The latest recovery flow was exercised with synthetic records at desktop and narrow mobile sizes.
- Deployment36415588808 passed; exact image `stor24-crm:dc5a5aacc` was healthy and service/database readiness passed at 11:28:00.58 UTC. This is a dated technical observation, not staff acceptance.
- Excel E111 records the 42nd delivered component. All 14 programme acceptance gates remain open; this is not a claim of 95% production readiness or GAPP/CIA certification.
- Remaining acceptance includes the full staff journey, legal/privacy/retention approval, physical-access provider/device evidence, source finance reconciliation, MRI/Netcash acceptance, recovery/credential/alert evidence, data migration and staff training. Netcash live activation remains deferred.
- Test-reset recovery is postponed until after the presentation; do not demonstrate a reset of production data.

## Close

“The next decision is acceptance of the operational journey against agreed evidence. We can demonstrate the built workflow today, while keeping financial, legal and physical-access sign-off explicit.”
