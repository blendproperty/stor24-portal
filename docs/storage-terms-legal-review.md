# Storage agreement review edition — 10 September 2026

This is an implemented working draft requested by Brett for subsequent legal review, not a legal sign-off. The public website, downloadable terms and new reservation agreement use the single source `src/lib/storage-terms.ts`. Original v3 content remains in `lease-agreement-content.ts` for historical commercial-fingerprint comparisons and internal leasing. Internal BlendSign templates are not changed by this public-booking work.

## Decisions proposed for review

- Proposed month-to-month notice: 14 calendar days before intended month-end, preserving statutory rights. This resolves the source template's conflicting prior-month-15th rule in favour of the shorter notice; legal must approve the chosen policy.
- Deposit only if expressly scheduled. No one-month deposit, VAT uplift, initial prorata or following-month charge has been activated. The template's VAT-inclusive wording conflicts with the previous generated VAT-exclusive wording. Final operator identity, tax basis and itemised initial balance remain required before production billing.
- Proposed deposit reconciliation/refund: 14 business days after handover, subject to shorter mandatory periods. Proposed increases: at least one calendar month's written notice. Confirm these operational commitments.
- No automatic 24% interest, automatic 60-day disposal, blanket irrevocable credit consent, attorney-client fee entitlement or waiver of protection against unlawful dispossession. Legal must specify any lawful replacement procedure, rates and notices.
- Includes merchandise/custom packages, stock substitutions and refunds, guard-house key handover, separate bank mandate, privacy, interruptions, complaints and immutable electronic acceptance.

## Review sources

User-supplied `Stor24_Lease_Agreement (1).pdf` (10 pages) and the generated signed agreement `stor24-ST24-20260910-64F2F6-signed-agreement.pdf` (2 pages).

Primary legal reference for reviewer: [Consumer Protection Act and amended text](https://www.gov.za/documents/consumer-protection-act), especially consumer rights, disclosure and risk notices; [Electronic Communications and Transactions Act](https://www.gov.za/documents/electronic-communications-and-transactions-act). These references are not an enforceability opinion.

## Applying legal's edits

Ask for the requested amendments here. Create a new versioned terms module/renderer; preserve this edition and the legacy renderer for historical signed-booking checks. Update the version registry in `public-lease-workflow.ts`, the public current-edition endpoint and the regression tests together. Never rewrite stored content, signatures or PDFs. An unsigned prepared agreement requires renewed acceptance if its fingerprint changes. Editing the current website alone must never alter a customer's accepted edition.

There is not a new no-code legal editor in this delivery. Draft text is maintained in the repository and can be amended through this task with a reviewed deployment. Future legal-approved activation must explicitly reconcile final commercial schedule, owner identity, privacy procedures, collections and move-in gates.
