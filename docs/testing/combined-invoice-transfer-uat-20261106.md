# Combined invoices and transfer adjustments: staff and finance test plan

Status: prepared 6 November 2026. PR #724 is not deployed. No staff or finance acceptance has yet been recorded.

## Test setup

Use an isolated non-production instance running the reviewed PR, with a disposable database, synthetic customers and units, and outbound email and payment integrations disabled. Do not use real customer accounts or send invoices. Provision two staff users with the required store access: one able to view and manage billing and request adjustments; a different user able to approve adjustments. Record environment, deployed commit, date, tester names and permissions before starting. This document does not establish that such an environment or access is available.

Create a customer with two active tenancies at the same facility, distinct occupied units and accounts, confirmed key handovers, reconciled balances and approved billing plans. Use the current billing month (future billing is not enabled). Set up a second customer and a second facility for isolation checks. Create separate clean fixtures for each scenario to avoid billing an account twice.

## Combined invoice

1. Open Invoicing, then monthly billing (`/billing/monthly`). Select an account and the test month. Choose **Preview combined charges**. Check the two accounts, unit descriptions, individual lines, tax and combined total against agreed test plans. Confirm no ledger or invoice is created by preview.
2. Confirm **Post combined invoice** is disabled until the review box is checked. Check it and post once. Open the saved invoice and confirm it contains both units and the correct total. Check each account ledger contains only its own lines and balance change, and both accounts can open the same invoice. Confirm no email or payment was sent.
3. Attempt the same billing again and verify it is held rather than duplicated. Change a plan or balance after preview and verify the old preview cannot post; preview again and review. Check accounts for a different customer or facility are not included. A tenancy on notice, an unconfirmed handover, an unapproved plan or an unreconciled account must stop the group for review.

## Transfer adjustment

1. For a clean current-month fixture, post the original full-month invoice and record its ledger and balance. In **Transfers**, select the tenant and an available larger unit, review the indicative difference, and complete the synthetic transfer. Verify the transfer itself did not post an adjustment.
2. In **Adjustments** (`/adjustments`), select the account and recorded transfer, then choose **Prepare transfer adjustment**. Verify the source, effective date, charge, included tax and balance change. Confirm the review box and request independent approval. Verify the balance is unchanged while awaiting approval.
3. As the requester, verify self-approval is unavailable. Sign in as the second authorised reviewer, check the saved evidence, enter the review reference, and approve and post. Verify exactly one ledger adjustment and the expected balance. Attempt a second request/approval and verify no duplicate posts.
4. Repeat with a smaller unit and verify a credit linked to the original rent charge. Repeat with an account included in a combined invoice. For a 30-day month with transfer on day 16, R1,200 old rent and R1,800 new rent, the indicative difference is R300 charge before any tax-treatment review; reversing the rates yields a R300 credit.
5. Verify discounted or ambiguous histories, unverified handover, out-of-scope accounts, and non-current-month transfers are held for finance review rather than automatically adjusted.

## Record findings

For each scenario record pass/fail, date, tester, fixture reference, observed amount and balance, expected amount and balance, document and ledger references, and issue link. Finance must review proration, tax, invoice presentation and account treatment against approved agreements. Staff must verify usability and permissions on their normal devices. A technical pass is not acceptance.

## Open decisions and limits

Faeez must clarify introductory discount proration, notice eligibility and automatic invoice delivery. No automatic invoice emailing or next-month billing schedule is enabled by this PR. Do not accept or test those unresolved policies as if decided. Existing provider, data, training, security and production approval gates remain open.
