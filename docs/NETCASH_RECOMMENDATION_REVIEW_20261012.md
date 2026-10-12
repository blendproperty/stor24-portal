# Netcash recommendation review - 12 October 2026

## Decision
Retain the separate upfront Pay Now invoice and future recurring mandate. Nicole Sassman's supplied email recommends obtaining the rental agreement/recurring authority, collecting deposit (if applicable) and first/pro-rata rent through Pay Now, and approving occupation only on trusted successful upfront payment confirmation. Mandate signing and bank authentication are authority milestones, never receipts. Existing ID, access-photo, operational and staff handover checks remain.

## Current implementation and gaps
- The public app places confirmed signed mandate before the first-payment screen; the backend first-invoice endpoint requires the signed storage lease but not a signed bank mandate. Revise UX/state coupling so PDF preparation or later bank authentication is not mistaken for payment readiness. Removing the underlying signing requirement entirely is a separate commercial/legal policy decision.
- Hosted SOAP mandate creation currently disables IncludeDebiCheck, RequestAVS and AddToMasterFile. This path does not prove DebiCheck authentication, bank-account ownership verification or live masterfile activation. Existing independent signed-report/PDF recovery fixes must be retained.
- The public first invoice includes initial rent plus explicitly selected goods, with no deposit component. Confirm amount, refund policy, accounting allocation and revised terms before adding any deposit. Never silently reprice signed bookings.
- Current STOR24 AFTER_CUTOFF_NEXT_MONTH policy prepays next month for move-ins after the 15th. At R1250/month, 9 October costs R927.42 for 23/31 days (plus any approved deposit); 31 October costs R40.32 plus November R1250 = R1290.32 and monthly collections begin 1 December. Nicole's example does not repeal this policy.
- A debit batch ACCEPTED response proves successful import/intake, not processed collection, successful payment or payout. Record mandate signed, bank authenticated where applicable, submitted, processed, successful/unpaid, paid out, and later reversals separately. Preserve invoice/reference correlation and ledger correction. Existing unverified REST scaffolds are not activation evidence.
- Move-in readiness already checks a verified real successful payment/ledger match, amount/currency and reversal status, signed storage agreement, ID/access acceptance and staff checks. Preserve these financial safeguards.

## Provider and business decisions
Byrone must confirm enabled standard debit-order/DebiCheck products, authentication contract/templates, exact status codes/callbacks, result/unpaid/reversal reports, payout correlation, idempotency and cut-offs. DebiCheck linked to eMandate uses TT2 under published guidance; Registered Mandate is not customer-authenticated DebiCheck. Customer disputes and later insufficient funds remain possible. No instant payout or guaranteed collection promise.

Official references:
- https://help.netcash.co.za/docs/account-profile/debicheck/
- https://help.netcash.co.za/docs/account-profile/debit-orders/manage-debit-orders/#debit-order-cut-off-times
- https://help.netcash.co.za/docs/quick-start-guides/debit-orders/electronic-mandates/
- https://api.netcash.co.za/testing/ (no separate provider sandbox; dedicated test-account designation remains a provider gate)

## Evidence and limits
Reviewed canonical public master fcd66758c9cc66038cf822f63122621d9bb9e981 and CRM main 574be386e5d882ef399180f4c92c85b8f7af7eea. Reviewed DebitOrderSetupClient.tsx, public-initial-rent.ts, debit-order-initial-payment.ts, reservation-move-in.ts, netcash-mandate.ts and debit batch/service code.

Created local output/debit-order-process-20261012/deliverables: a 24-slide editable PowerPoint, matching 24-page PDF, single-page proposed workflow PDF and ZIP of 26 screenshots. Current UI screenshots use intercepted fixture responses; provider screens are redacted published references. Two actual current booking captures are read-only and conceal the booking reference. No actual customer/provider session, OTP, identity upload, signature, mandate or payment was created for documentation. Hosted bank-entry and Pay Now payment-entry screens were not freshly captured. The current live screen asks staff to confirm the initial payment before another attempt; screenshots do not establish real settlement.

Visual review and package/layout/import checks passed for the final presentation. PDF pages are image-based derivatives of inspected slide renders. This review does not implement financial changes or close provider, finance/legal, data, training, physical handover, UAT or business approval gates. No external message or project tracker update.
