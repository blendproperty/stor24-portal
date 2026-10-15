# Recorded approved rent changes

15 October 2026. Open Report library → Units → Recorded approved rent changes. The report reads the retained `rent.group_increase.approved` audit produced by the existing approved group-increase transaction. It shows one recorded occupancy change per approval, with the original previous rate, approved new rate and exact-cent increase. It does not change a rent schedule, invoice, payment, ledger or provider instruction.

Recorded approval date is shown in South African time and is the default date basis. Scheduled effective date is the first day of the approval request's effective month. An approval is not evidence that a charge was posted or that rent was earned or collected. Current unit and account labels are lookup labels; no historical labels or missing earlier changes are reconstructed.

Missing or wrong-store occupancy references, invalid payloads/currencies/rates, inconsistent increase calculations, duplicate occupancy changes and reused approval batches remain review rows with no financial values. Selecting an effective-date filter with an invalid approval payload stops the report so the unknown date is not silently excluded. Rate totals require every scoped retained source to verify. Review the original source and supporting records; do not repair history by inventing occupancies or rates.

Source limits are 5,000 approval events, original occupancy references and expanded report rows. The bounded retained source is checked before date filtering so a duplicate batch in another period cannot escape review. Use Recorded approval date to inspect held sources. A history import cannot replace this native approval source; separately labelled historical reports remain available for approved extracts.

Viewing requires intersecting `reports.financial` and `billing.view` access to the store. Downloads also require report export permission and the existing data-protection controls for personal fields. Saved definitions and scheduled report snapshots retain the existing report worker's current-permission checks and encrypted artifact handling. No external communication is sent by this report.

This covers this recorded approval producer only. Unit price edits, changes outside the group approval workflow, missing original occupancies and pre-recording history remain coverage limits. Finance/staff reconciliation and operational acceptance are separate from implementation and isolated tests. Canonical PROJECT_CONTEXT.md records publication, checks, merge, deployment and actual runtime evidence.
