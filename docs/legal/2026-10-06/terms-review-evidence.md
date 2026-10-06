# Terms review for Liezl Taylor on 6 October 2026

Status: annotated document prepared for final review; Outlook reply saved first and subsequently confirmed sent at 13:15:31 SAST. This is not legal approval or a deployed terms edition.

## Source and system evidence

- Incoming Outlook subject: STOR24 T's & C's; Liezl Taylor, 29 September 2026, 13:47:42 UTC. Original Word attachment preserved locally. Her three original comments remain anchored in the revised file.
- CRM canonical origin/main fetched and reviewed at bddf2efbffc1a1803dc0194e7a271628792ec69c; remote https://github.com/blendproperty/stor24-portal.git. Separate documentation branch codex/terms-legal-review-20261006 preserves the unrelated reports worktree.
- Public website canonical origin/master fetched and inspected at 46050b962515e10530aa8fd38ec6e025458514c6; remote https://github.com/blendproperty/stor24.git. Read-only consultation; no public repository changes.
- src/lib/lease-agreement-content.ts defines CARD, EFT and DEBIT_ORDER. Brett explicitly confirms credit card, EFT and debit order in this request.
- src/lib/public-initial-rent.ts and src/lib/proration-preview.ts calculate initial rent with actual month days including the start date; the following month is added only when the start day is greater than 15. Historical quotes retain their saved pricing.
- src/lib/storage-terms.ts retains storage-terms-2026-09-22 as a review edition, describes the Booking Schedule, positive acceptance, distinct payment/mandate/access steps and accepted-edition retention.
- src/lib/public-lease-workflow.ts records accepted content, version, SHA-256, clause acknowledgements, signer/time and signed PDF; changed particulars cannot silently rewrite a signed booking.
- src/lib/public-hosted-mandate.ts returns collectionEnabled=false. A signed provider mandate is not proof of enabled production collections.
- Public app/terms/page.tsx reads the CRM terms feed and preserves the accepted edition for existing bookings.
- Direct read-only request to the live public storage-terms API was rejected by the request boundary. No live terms response, authenticated production workflow, funds movement or access-device UAT was verified in this review.

## Document changes and validation

- Revised file: STOR24_Terms_and_Conditions_Revised_for_Liezl_2026-10-06.docx; SHA-256 dc88e19be4eb56bd0792fbf5e97691ea80ce51ab9a02b48612fca998bb4fee37; 39512 bytes. Local source and changes.json remain in output/STOR24_Terms_Review_2026-10-06.
- Source structure retained; 72 paragraph edits documented, with original counsel comments and point-of-change review comments. Redundant conflicting enforcement clauses consolidated; section headings consistently numbered 1–22. This is a commented revision, not a Word tracked-changes comparison.
- Credit card added; separate debit mandate, verified payment instructions, cleared-funds distinction, actual initial-rent rule, schedule terminology and electronic agreement record included.
- Conflicting cancellation periods, interest rates, 30/60-day disposal claims, nonexistent clause references and spoliation waiver revised for counsel approval. Deposit is schedule-dependent; no competitor two-month EFT policy adopted.
- Content checks passed for payment methods, cutoff boundary, schedule, mandate and electronic acceptance; broken 34.5/34.7/37–39 references and conflicting interest formulas removed. Original comment anchors restored.
- Packaged render_docx.py could not run because LibreOffice is absent. Installed Microsoft Word successfully exported the draft to PDF; bundled pypdfium2 produced eight page images. All eight pages inspected at full image resolution; no clipping or missing glyphs found. PDF/images are internal QA only. Final comment-anchor restoration did not change body text or layout.
- Reply in existing thread saved to Liezl only, no Cc/Bcc; subject RE: STOR24 T's & C's. Revised DOCX attached and connector metadata/readback verified; browser initially identified it in Drafts. Paragraph formatting corrected in Outlook and saved. It subsequently moved to Sent Items at 11:15:31 UTC / 13:15:31 SAST; sent body, recipient and revised 40,014-byte attachment read back. No agent Send action was invoked; the actor was not independently audited.

## Decisions still required

Liezl's final legal review; Mark/business approval of deposit amounts and any payment-method distinction, cancellation/minimum commitment, interest and recovery fees, refund procedure, VAT treatment, operator particulars and actual access hours. Validate any enforcement/credit-reporting process separately. Privacy, identity/authority, biometric provider storage/retention/deletion, alternative access and minors arrangements remain open. Production payment/mandate/collection and reconciliation, physical access UAT, data, training and all existing readiness gates remain open. Publication and a new accepted terms version require a separate approved implementation; existing signed agreements retain their accepted text.

## Legal reference checks

Consumer and electronic acceptance issues were checked against the government sources as review prompts, not a determination of enforceability or attorney approval:
- Consumer Protection Act: https://www.gov.za/documents/consumer-protection-act
- Electronic Communications and Transactions Act: https://www.gov.za/documents/electronic-communications-and-transactions-act
