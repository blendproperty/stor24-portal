# Settlement reconciliation

Implemented 21 September 2026 at Billing → Settlement reconciliation. This is an evidence and exception workflow, not an automatic receipt-posting or funds-release engine.

## Access and daily workflow

Organisation-wide permissions are required because one merchant statement may span stores. Assign `settlements.view`, `settlements.import`, `settlements.manage`, `settlements.approve` and `settlements.export` deliberately; this release does not change staff roles.

1. Select the merchant and a past South African date. Request the full daily statement, then explicitly retrieve it when ready; no background polling. Alternatively upload the original tab-separated full statement with a source reference, inspect the balance preview and confirm the merchant/environment/day.
2. Opening balance plus every signed movement must equal closing balance exactly at four decimals. The VAT field is informational and already included. Sources are encrypted and hashed; original rows are preserved. Maximum 500 movements / 500 KB per file. The latest 50 statements are shown.
3. Import bank extracts using a consistent account alias and stable original row IDs. Exact CSV columns: `transaction_id,date,amount,reference`. Use YYYY-MM-DD and signed decimal amounts, with credits positive. Each provider payout matches one opposite bank movement dated on or after the payout. Combined/split transfers and FX are not supported; keep them unresolved. Duplicate active IDs within the same bank alias/environment are blocked. Changing aliases to bypass a duplicate is prohibited.
4. Match positive collection lines to the exact verified live NETCASH receipt, amount and merchant. An account with inconsistent ledger/balance, simulated receipts or unsupported corrected status is blocked. New Pay Now and merchandise checkouts retain merchant identity; older records require explicit original merchant evidence. No automatic or fuzzy match is made. A provider transaction ID and a receipt/correction/bank row may each be reserved only once.
5. Match returns to an already posted, source-linked refund or reversal. Refund codes PNR/PVR/PNX/DRC require a refund; the other supported return codes require a reversal. The workspace never creates that correction. A missing posting remains an exception requiring the separately controlled finance workflow.
6. Fees and supported accounting movements require the real external accounting-entry/explanation reference. Supported explanation codes are INR/IPR/IRR/REB/NCA/IAT/IST/BDW/BAR/ELM/INS; unknown codes remain blocked pending an approved mapping. Recognised codes with unexpected signs fail import. Receipt codes are PNC/PNP/PNM/PNE/PIS/PVC/TDD/SDD/TDC/SDC/DCS/PQR. Return codes are DRU/DCD/DCU/PND/PNR/PNQ/PNZ/PVR/PVD/PIR/PNX/DRC. Payout codes are BTR/BRT/RTR; bank returns BTU/BRR/RRR/CRJ. NSF/VAT/INP are fee/expense lines.
7. A different finance colleague reviews every current match. The reviewer cannot be the statement importer, last editor, any line preparer or linked-bank importer. A reviewed statement retains active reservations. Changed sources are flagged on reopening the detail or exporting; reopen with a reason and rematch. Void only an incorrect draft. Voiding preserves history and frees reservations. Only unmatched bank imports can be voided.

**Reviewed is not equivalent to all funds paid to the bank.** Record provider current/available balances separately, with date and evidence; their difference is held/reserved funds. Retention is not a second expense, release is not new income, and the workspace does not forecast release dates. The latest 20 observations and 30 bank imports are shown. There is no period-close lock or immutable historical GL balance certificate.

## Provider contract and security

Read-only primary contracts checked 21 September 2026:

- [Netcash full daily statement contract and transaction mapping](https://api.netcash.co.za/standard-integration/netcash-statement/)
- [Netcash statement and retained-fund guidance](https://help.netcash.co.za/docs/quick-start-guides/account-system/understanding-your-netcash-statement/)
- [Live NIWS WSDL](https://ws.netcash.co.za/NIWS/niws_nif.svc?singleWsdl)

`RequestMerchantStatement(ServiceKey, FromActionDate)` and `RetrieveMerchantStatement(ServiceKey, PollingId)` use the Account service key and NIWS_NIF SOAP endpoint. Requests are bounded, timed out and do not follow redirects; unsafe XML and error responses fail closed. Netcash documents past-day statements as available the following morning from 08:30. Download tickets are encrypted, expire after one day, and bind organisation, connection and merchant/key configuration. Retrieval rechecks configuration inside the import transaction. The former unverified date-range REST placeholder now throws an explicit daily-workflow error; it has no active UI caller.

POST requires authentication, same-origin requests, dedicated permission and a bounded payload. Provider reads are rate-limited. Statement mutations use serializable organisation locking and optimistic revisions. Unique database reservations protect source reuse. Source files and provider credentials are never returned to the browser. CSV escapes spreadsheet formulas. Read/detail/export enforce organisation-wide scope. The last 500 candidates per source type are offered, with explicit truncation warning; an absent candidate cannot be explained away.

## Validation and open gates

Local and CI fixtures are invented and isolated. They do not prove live merchant activation, receipt acceptance or bank reconciliation. No production import, provider retrieval, bank upload, review, customer message, ledger entry or configuration change is needed for read-only release verification.

Finance must still approve mappings, merchant provenance for historical receipts, bank-extract provenance, fee/tax/GL treatment, opening-balance completeness and reviewer roles, then perform real statement/receipt/refund/payout/retention UAT and staff training. Unknown transaction types, split/combined transfers, partial reversal representation, unmatched debit collections and live provider activation remain explicit gates. Debit-run reservations are not automatically released by a reviewed statement; accepted upload still is not collection. MRI posting/mapping, daily close, legal, access and prior launch gates remain separate. This release does not initiate or automate any Netcash collection, refund or bank transfer.
