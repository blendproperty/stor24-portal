# SiteLink reminders and STOR24 Operations

Reviewed 7 October 2026. Screenshot counts are examples, never migration data.

| SiteLink label | Purpose | STOR24 treatment |
| --- | --- | --- |
| Bulletin Board | Shared staff notices | Useful; no dedicated notice/acknowledgement model. Keep outside counted queues until implemented. |
| Reminders | Staff follow-up work | Live count of open tasks due today or overdue; Operations task queue. Undated tasks remain in the full task queue. |
| Call Past Dues | Collection calls | Live count from existing collections ageing and evidence checks: scheduled follow-up due, overdue debt, no hold or ageing issue. Open Collections. Unscheduled overdue debt is visible there but is not a scheduled call. |
| Reorder | Merchandise below reorder threshold | Live count of active products whose on-hand stock minus reserved stock is at/below reorder point. Open Merchandise. |
| Invoice | Invoices ready for processing | Relevant billing workflow; do not substitute account balances for invoices due. Billing batch definition and queue remain to be agreed. |
| Credit Cards | Recurring card charges to process | Provider-specific SiteLink function; no equivalent recurring-card execution queue established. Do not imply STOR24 stores card details or can run charges. |
| Expired Credit Cards | Stored recurring cards needing replacement | Requires provider-authoritative token/card-expiry data; no equivalent counted queue established. |
| ACH Get Returns | Bank-debit return retrieval/reconciliation | US ACH terminology. STOR24 equivalent is provider debit-order failures/returns and reconciliation, subject to actual Netcash feeds. No manufactured provider count. |
| Move-out | Scheduled departure work | Live count of notice-given tenancies with end date today or overdue; open account workflows. Future departures remain in Calendar/accounts. |
| Overlock | Physically install an additional lock on a delinquent unit | Distinct from gate/access blocking. Physical completion evidence, approved policy and reversal tracking are required before this can be a counted queue. |
| Cut the Lock | Physical collection/enforcement task | Needs approved local legal/operational policy, authorisation and physical evidence. No automatic lock-cutting action or count. |
| Refunds Due | Refund obligation requiring processing | Relevant; credits, proposed adjustments and actual refunds are different. Authoritative refund-obligation queue remains to be established; do not label account credits as money owed automatically. |
| Service Required | Repairs and maintenance | Live count of maintenance not completed/cancelled; opens maintenance queue. |

## Source evidence

- [SiteLink official-hosted PC Edition manual](https://s3.sitelink.com/SiteLinkStandAlone/SiteLink-StandAlone-PC-Edition-User-Manual.pdf): historical product manual, not a current Web Edition/provider integration contract.
- [SiteLink support FAQ](https://support.sitelinksoftware.com.au/faq/): explicitly distinguishes manual physical overlock from automatic gate lockout and describes refunds.
- [Current Web Edition product overview](https://www.sitelink.com/products/web-edition): payment processing, invoices, move-in/out and operational tools.
- [Storable support response, February 2025](https://storageforum.sitelink.com/discussion/4471/reminders-for-sitelink-web-edition): reminder categories depend on site data and enabled schedule events; confirms unread bulletins, employee reminders and expired cards among the categories.

The Web Edition manual was located in third-party archives, but current integration/policy conclusions rely on first-party support and repository evidence. Unconfirmed labels above are working interpretations, not a verified current SiteLink configuration.

## Count and access contract

The overview and Operations page share the same server-rendered panel. Each category independently checks its current permission and obtains its permission-specific organisation/facility scope before reading data. Restricted users do not receive organisation-wide tasks in this panel. Counts are database aggregates without list truncation, except collections, which uses the existing bounded/evidence-checked workspace and reports unavailable if its limit or validation fails. Failed reads display Unavailable, never zero. Counts are snapshots refreshed on page reload; Operations mutations do not automatically refresh this server panel.

Counts link to the established workflows; they do not execute charges, issue refunds, change access, place locks or complete tasks. New workflows/provider integrations and physical/customer UAT remain separate work.
