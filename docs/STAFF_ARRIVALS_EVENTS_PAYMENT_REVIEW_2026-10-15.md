# Store events, arrivals and payment attention

15October2026 implementation guide. Check PROJECT_CONTEXT.md for actual release/live stages; this document does not establish deployment or staff acceptance.

## Booking and move-in event inbox

Open **Operations → Booking & move-in event inbox**, or the **Unread booking & move-in events** reminder. Each staff account has its own read state. The source stage and SAST time distinguish booking creation, a recorded signed agreement, move-in starting and an explicit key-handover audit. A signed agreement is not a receipt, and a handover record is not proof that door access activated.

Open **Customer history**, read the source and choose **Mark … as read**. Another colleague's unread state is unchanged. A source version change needs fresh review. **Older events** continues through all source positions, including historical audit rows whose original tenancy is unavailable. No email, WhatsApp, SMS or push message is sent by this inbox. Approved external recipients/provider delivery remain separate gates.

## Expected arrivals and weekend cover

Open **Operations → Expected arrivals & weekend cover**. Set the SAST dates and store; include Saturday/Sunday as needed. Only active rental bookings with agreed dates appear. Undated active bookings are counted separately; review their dates before treating the plan as complete. **More arrivals** includes older/later source pages.

Each row shows the customer/unit/store and current handover checks. Expand the blockers. A future agreed date, test-only payment, missing accepted identity/photo, incomplete signed document or unreconciled source must not be treated as permission for keys. **Move-in checks** uses the existing separate permission and confirmation workflow. This board grants no access and posts no money.

Authorised operations managers select **Assign or update cover**, choose responsible staff and covering staff with store access, and save clear instructions. The named cover uses their own account to **Acknowledge arrival cover** after reviewing the current booking and readiness. Changing instructions/cover clears acknowledgement. Changed date/source/readiness or lost cover access is identified; review and confirm again. Completion of physical arrival, verified payment and activated access are separate checks.

## Payments awaiting review

Open the **Payments awaiting review** reminder. The queue uses the existing payments-view permission and scoped booking/tenant account evidence. Pending means awaiting confirmation; missing/multiple receipt matches and source-review reasons need investigation. Test/sandbox records are excluded. A repeated provider callback does not create an additional queue item for the same Payment record.

Read the customer/store/payment record reference and **Review source**. Netcash links open the permitted store's payment operations; staff-receipt links open the exact account. Match the displayed record ID when inspecting payment operations. **Review older payments** includes every source page, even when a page has no exceptions. A reminder count that exceeds its safe source bound or cannot read evidence displays **Unavailable**, never a guessed zero.

There is no dismiss/approve/post/allocate action here. An unresolved item leaves only when its actual source becomes terminal or internally reconciled through existing authorised controls. Internal receipt matching is separate from provider statement and bank settlement. Refunds, reallocation, approval and customer notices retain their existing separate gates.

## Failed reads and uncertain confirmations

Reload the current queue before retrying an uncertain acknowledgement or handover. A failed reload keeps changes blocked. A stale version/source is rejected; the saved handover is not silently overwritten. Loss of access clears displayed records. Do not create a second appointment or contact the customer merely because a confirmation did not arrive.

Staff acceptance remains open: use Faeez and named cover's own accounts, verify the exact store/customer, prepare a weekend arrival, test a changed date/cover, record/review acknowledgements, and inspect a consenting/isolated payment through its approved source workflow. Retain tester/store/date/expected/actual/evidence/retest. Automation is not that acceptance.
