# STOR24 Operations Platform: two-week readiness plan

Planning window: 12–26 November 2026. This is a prioritisation of known work, not a go-live approval or an assertion that the inventory is exhaustive. Keep the billing recognition production hold in place.

## First: 12–17 November

1. Confirm the minimum launch scope, decision maker, deadline and fallback for work that cannot be accepted in time.
2. Obtain Faeez/finance's worked examples and approval for half-price allocation, R1 collection and tax, notice changes after invoice preparation or sending, transfers and multi-account cases. Confirm an owner, cadence, alert recipient and recovery procedure for recognition before release.
3. Confirm Netcash compliance submission, production activation and settlement arrangements; arrange an approved end-to-end payment and reconciliation test.
4. Reconcile the facility unit numbers, physical signage, availability and rates with Faeez and Katlego; correct discrepancies and obtain approval.
5. Complete the public booking, CAPTCHA, OTP, CRM handoff, cancellation and move-in acceptance flow with authorised test participants; fix and retest defects.
6. Obtain the physical gate power, reader installation and access integration dates; validate the complete on-site access and failure-recovery flow.
7. Confirm an off-server recovery copy, key custody, restoration responsibilities, approved RPO/RTO and a host-loss restore rehearsal. Confirm monitoring alerts reach a named responder and rehearse rollback.

## Next: 18–26 November

8. Reconcile authorised migration data and account balances, or agree an explicit launch fallback; test reports and exports.
9. Complete role-based staff and device UAT, including lost-enquiry reasons, move-in, agreements, billing review and permissions. Record defects and retest fixes.
10. Complete real provider acceptance for signing, communications, insurance and physical access as applicable; verify privacy, consent and biometric approvals.
11. Train staff and confirm operational ownership, support, incident handling and recovery procedures.
12. Reconcile acceptance evidence and remaining defects in the project tracker; agree owners and dates for accepted residual work. Record a go/no-go and rollback decision.

## Scope after the launch decision

Evaluate optional or unapproved work, including advanced reporting, expanded inventory/POS, additional integrations and advertising, against the agreed launch scope. Verify actual advertising status and do not change campaigns without approval; website context records an owner-published campaign on 12 November. Do not classify a feature as optional if the business identifies it as essential to operations.

## Evidence and limits at 12 November

- CRM main b5c6bcd0ce607c5c77e9e21932eeee553d8c1f2e passed CI, security, transactions and restricted-runtime checks. Deployment [43215065145](https://github.com/blendproperty/stor24-portal/actions/runs/43215065145) succeeded; production monitor [43215961356](https://github.com/blendproperty/stor24-portal/actions/runs/43215961356) succeeded. CRM and website public health endpoints returned HTTP 200. These checks do not prove the customer journey or staff acceptance.
- Billing [draft PR #766](https://github.com/blendproperty/stor24-portal/pull/766) remains unmerged and held from production; isolated tests do not replace finance approval, production integration, monitoring or live acceptance.
- Provider, data, legal, training, UAT and approval gates remain open unless independently verified and signed off. Dates are priorities, not commitments from external parties.
