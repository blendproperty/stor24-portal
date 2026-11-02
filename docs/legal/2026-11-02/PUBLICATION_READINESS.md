# Confirmed Word terms publication candidate

The owner identified the document currently open in Word on 2 November 2026. Word showed `STOR24_Full_Terms_and_Conditions_Original_Aligned_Review_2026-10-07`, Saved, nine pages and 3,976 words. A shared read of the saved file while Word remained open confirmed SHA-256 `055fb89975ca39c2a77574486494be44a1ef2811cc8aef09acb44e80f80e89da`, matching the earlier inspected source. Its heading date is 7 October; the date ambiguity no longer prevents identifying the intended file.

`confirmed-word-terms.json` retains all 22 numbered storage clauses, the booking-schedule template, important risk notices, execution fields and separate debit-order template. The internal source-history preface is provenance, not customer contract wording, and is omitted from the proposed public text. Numbered-clause integrity is pinned by an independently extracted SHA-256. The active `storage-terms.ts` and public APIs are unchanged. The candidate module is not imported by a production route or booking workflow.

The 20 October module is archived unchanged before any future edition switch. Its canonical LF source hash and its rendered agreement/fingerprint are regression checked across operating systems. No stored lease, signature, PDF, customer or reservation has been changed.

## Deposit decision before activation

Word clause 10 requires a deposit equal to one month's service charge, payable with the first charge. Current `publicCheckoutTotal` includes initial rent and optional goods; it has no deposit component. Publishing this source as the new booking agreement without reconciling the quoted and payable schedule would create a mismatch. The owner has been asked whether new bookings should include that deposit; a response is still required before changing charges or activating this edition.

Examples using a hypothetical R1,250 monthly rate, no optional goods and the existing initial-rent rule:

| Start date | Initial rent | Proposed deposit | Proposed initial total |
| --- | ---: | ---: | ---: |
| 1 November 2026 | R1,250.00 | R1,250.00 | R2,500.00 |
| 16 November 2026 | R625.00 November + R1,250.00 December | R1,250.00 | R3,125.00 |

These are review examples, not live quotes or activated charges. Existing bookings must retain their accepted amounts and editions. No VAT uplift, interest engine, collection, credit-bureau integration, access lockout, sale/disposal or bank mandate is authorised or activated by this candidate.

## Remaining implementation and validation

- Reconcile the approved deposit treatment across immutable reservation pricing, booking preview, lease schedule, payment amount, account/readiness screens, merchandise/mandate separation and historical resume checks. Do not silently reprice an existing reservation.
- Complete the new personalised schedule and review operator/customer fields against available source data. Source template placeholders are not a completed customer schedule.
- Preserve the existing website/merchandise/refund provisions separately where the storage-only Word source does not cover them; do not silently remove those protections.
- Switch the current edition and registry together only when ready. Maintain previous renderers and renewed exact-fingerprint acceptance for changed unsigned documents.
- Update the website's old section 11–14 risk pointer for the Word source's clauses 6 and 8, and its refund excerpt selection for the new section titles. Update the downloadable edition/date and inspect the generated PDF.
- Run focused/full source, version-history, signing/payment-boundary, PDF and responsive browser checks, then normal checked promotion, guarded release and read-only production verification. None of those future release checks is claimed by the three candidate-source tests.

The source itself remains a review draft. Legal/commercial acceptance, provider, tax, identity/retention, operational, staff/device, training and recovery gates remain at their recorded scope. Customer messaging and external trackers are not in scope.
