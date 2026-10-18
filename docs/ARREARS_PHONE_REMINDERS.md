# Reviewed arrears SMS and WhatsApp reminders

This workflow sends payment reminders only. It does not issue a formal access-restriction notice, approve a fee, post money or change physical access. Financial approvals remain separate; the fee amount stays unset pending Liezl/Mark.

1. Open Collections, then **Reviewed SMS & WhatsApp reminders**. Select the account and channel.
2. Check the verified recipient, current balance, holds and complete message. Prepare the draft.
3. A different currently authorised colleague reviews the same recipient and full message, records a review reference and approves it. Preparing or refreshing the draft cannot approve it.
4. An authorised sender confirms the exact approved message once. Channel activation is a separate owner decision. Provider acceptance is separate from delivery/read evidence.

Only active tenancies with reconciled overdue debt, verified phone and explicit current channel consent qualify. Pending, failed or unposted payments and existing dispute/arrangement/source holds prevent sending. Changes to source, consent, template or authority invalidate the approval. Cancellation is possible before an attempt; an uncertain attempt requires provider evidence and cannot be retried or automatically switched to another channel.

Drafts are encrypted and integrity-bound to their organisation, account, store, channel and SAST day. A durable send claim, communication record and audit are committed before the provider request. Retained message text uses the existing Collections-plus-communications history/search/PDF/CSV/Excel access checks. A successful API response proves neither delivery nor read status.

## Configuration and release gates

- `ARREARS_PHONE_ORGANISATION_ID` binds activation to one organisation.
- `ARREARS_SMS_ENABLED` and `ARREARS_WHATSAPP_ENABLED` default to false; no activation is inferred from deployment.
- Existing Twilio credentials and sender configuration are required. WhatsApp also honours the existing global and organisation integration automation stops.
- WhatsApp requires `ARREARS_WHATSAPP_CONTENT_SID` and a reviewed JSON `ARREARS_WHATSAPP_VARIABLE_MAP`. The actual Twilio Content and ApprovalRequests records must identify the configured account and an approved UTILITY text template. Numeric placeholders map only to account/store/amount/date/portal, with no missing variables or sample-value fallback. The resolved text must exactly match the canonical payment reminder.
- No scheduler, automatic fallback, automatic retry, new permission grant or fee/access execution is added. Staff review remains mandatory.

Implementation is subject to exact-head hosted native database, browser, build and protected checks, independent review, normal merge/deployment and live default-off verification. Owner activation, approved provider configuration, real recipient/delivery evidence and staff acceptance remain separate gates.
