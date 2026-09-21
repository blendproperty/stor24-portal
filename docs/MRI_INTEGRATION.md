# MRI Property Central integration — 21 September 2026

## Current boundary

`/billing/mri` provides encrypted connection preparation and a read-only monthly STOR24 ledger review. It is **not a working MRI connection or journal export**. There is no provider authentication, journal creation, submission, retry or reconciliation implementation in this release. Neither saved credentials nor a successful source review enables posting.

The approved direction from the August correspondence is consolidated journals to a dedicated Property Central property/entity. STOR24 retains tenant, unit, payment and arrears detail. A per-payment outbox record is not a consolidated journal and must never be replayed as one.

## Provider evidence inspected

- MRI's 16 September API-user activation email confirms an API-only account; normal Property Central Web sign-in is not supported for it.
- Yoliswa's 16 September “Blend api” secure share is accessible and supplies credentials. No password, reset token or secure-share URL belongs in source control, audit payloads or release notes.
- Mark selected **Blend** on 16 September. This does not establish an authorised test database or its required identifier. The credential share and messages inspected did not supply that identifier.
- Lorenzo's 20 August “Your IT project” correspondence specifies consolidated movements/balances, a dedicated property linked to an entity, preconfigured transaction/GL codes and testing first. Client staff must create the property/data; MRI does not do this for the client. Muhammad Ismail is the allocated consultant per the provisioning correspondence.
- The attached MRI integration questionnaire gives examples of v2 batch/transaction operations but does **not** define API-user authentication, consolidated journal request/response schemas or duplicate/reconciliation behaviour. Its tenant-charge example is not a journal contract.
- The public [Property Central Web application](https://managerweb.mdapropsys.com) publishes `https://api.mdapropsys.com/api` as its API base. On 21 September the base and host root returned HTTP 503 from both the workstation and the production VPS. The actual `v2/Access/GetDatabaseAccessList` route, discovered in that same public client, returned HTTP 401 from both hosts. The API is reachable and requires authentication; the root 503 does not establish an outage. No credentials were sent. This is not an API-user authentication test or confirmation of its authentication contract.

## Preparation behaviour

- Explicit `mri.view` and `mri.manage` permissions require organisation-wide scope. No role grants are changed by this release.
- Settings use the existing AES-GCM secret vault and `INTEGRATION_CONFIG_ENCRYPTION_KEY`. Login, password and database identifier are write-only, encrypted at rest, and absent from readback/audit. A deterministic organisation connection identity plus serializable saves prevents duplicate initial configurations. Stale edits are rejected. Unexpected or duplicate legacy configurations are held for review.
- Database label/environment are operator declarations, not provider verification. Changing either clears the old database identifier unless a replacement is supplied. Credential changes reset success/health evidence; there is no enable-posting field or arbitrary remote endpoint.
- Monthly review uses South African calendar-month boundaries and an organisation-scoped, consistent database snapshot. Maximum 10,000 source rows; exceeding it fails rather than silently truncating. The month may still be open. Rows are grouped by current tenancy store and entry type, with amounts/tax shown exactly as stored, without an assumed debit/credit or gross/net convention.
- Any test-payment history or non-ZAR payment quarantines the entire account for this preliminary review. This is deliberately conservative and does not repair historical records. Unassigned stores are visible. Current tenancy store is not a historical accounting mapping.
- Included movements still require account-balance, receipt provenance, period, correction, tax and mapping checks. This is not a balance sheet, income statement, approved revenue total, complete finance export or eligible-posting list. Merchandise, settlement fees/payouts and other non-ledger sources are not added. Late changes require a fresh review.
- The response contains aggregate rows, a source fingerprint and generation time; no tenant names, descriptions or credentials. It is not a persisted, independently approved batch. The historical payment outbox is counted but untouched and never sent.

## Required next implementation

1. Obtain MRI's Web API Reference and Blend database identifier; verify API-user authentication and read-only database identity/reference lists.
2. Obtain explicit test-database access/authority. Do not treat Blend as a test database or create example transactions in it.
3. Finance/MRI confirm the dedicated property/entity, GL and transaction codes, tax/deposit treatment, opening balances, timing, currencies and period controls. Define completeness across tenancy ledger, merchandise, fees and adjustments.
4. Implement the documented journal contract with balanced, immutable source snapshots; mapping versions; independent approval; unique source/batch identity; and a durable submission state machine.
5. Verify provider duplicate/idempotency and lookup semantics. Ambiguous outcomes must stop for reconciliation instead of blindly retrying. Prove correction/reversal handling and provider readback against ledger/control totals.
6. Reconcile an authorised test batch in MRI, then complete finance UAT, support ownership, training and explicit live activation. Prior payment, historical-data, legal, physical-access and launch gates remain open.

## Validation

`tests/mri.test.ts`, `tests/integration/mri.test.ts` and `scripts/test-mri.mjs` cover preparation only, with invented isolated fixtures. They cannot establish successful MRI authentication, accepted journals or end-to-end accounting reconciliation. See canonical `PROJECT_CONTEXT.md` for commit, CI, merge, deployment, configuration and production evidence separately.
