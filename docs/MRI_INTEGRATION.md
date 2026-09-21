# MRI Property Central integration — 21 September 2026

## Current boundary

`/billing/mri` provides encrypted connection settings, documented v2 OAuth authentication, optional database discovery, a bounded read-only property query and monthly STOR24 ledger review. **Journal posting is not implemented or enabled.** Saving credentials, successful authentication or a source review cannot authorise posting. Provider authentication/database read must be tested live separately from the isolated adapter tests.

The approved direction from the August correspondence is consolidated journals to a dedicated Property Central property/entity. STOR24 retains tenant, unit, payment and arrears detail. A per-payment outbox record is not a consolidated journal and must never be replayed as one.

## Provider evidence inspected

- MRI's 16 September API-user activation email confirms an API-only account; normal Property Central Web sign-in is not supported for it.
- Yoliswa's 16 September “Blend api” secure share is accessible and supplies credentials. No password, reset token or secure-share URL belongs in source control, audit payloads or release notes.
- Mark selected **Blend** on 16 September. This does not establish an authorised test database or its required identifier. The credential share and messages inspected did not supply that identifier.
- Lorenzo's 20 August “Your IT project” correspondence specifies consolidated movements/balances, a dedicated property linked to an entity, preconfigured transaction/GL codes and testing first. Client staff must create the property/data; MRI does not do this for the client. Muhammad Ismail is the allocated consultant per the provisioning correspondence.
- The attached MRI integration questionnaire gives examples of v2 batch/transaction operations but does **not** define API-user authentication, consolidated journal request/response schemas or duplicate/reconciliation behaviour. Its tenant-charge example is not a journal contract.
- The public [Property Central Web application](https://managerweb.mdapropsys.com) publishes `https://api.mdapropsys.com/api` as its API base. On 21 September the base and host root returned HTTP 503 from both the workstation and the production VPS. The actual `v2/Access/GetDatabaseAccessList` route, discovered in that same public client, returned HTTP 401 from both hosts. The API is reachable and requires authentication; the root 503 does not establish an outage. Those unauthenticated probes sent no credentials. Subsequent documented OAuth verification is described below.

## Official API contract located later in this run

- [MRI v2 Swagger](https://api.mdapropsys.com/api/swagger/ui/index) and its [machine-readable specification](https://api.mdapropsys.com/api/swagger/docs/v1) are available under `/api`. The specification's internal `version: v1` is its document version; its title and endpoint paths explicitly describe **Web API v2**.
- Authentication is OAuth password grant at `POST /api/v2/Token`, followed by a Bearer token and `DatabaseIdentifier` request header. The implementation sends a form-encoded grant and never stores or returns the access token.
- `GET /api/v2/Access/GetDatabaseAccessList` is present in MRI's official Web client, but absent from the pre-approved Swagger list. An API-only account may not be permitted to use it. Discovery failure does not imply the credentials failed, and does not invent a database identifier. Returned identifiers are encrypted at rest; the UI receives opaque selection keys and names.
- `POST /api/v2/Properties/SearchProperties` is a documented read operation. The check requests page zero with one record, validates the response and returns only the count. No property detail is persisted or returned to the browser. Successful read access is not proof of the intended finance property, test status or journal permissions.
- [Special journals import](https://api.mdapropsys.com/api/Help/Api/POST-v1-BatchesSpecialJournalsImport-Save) is documented in the **older v1 API**, whose general reference describes API-key Basic authentication. It creates a batch and returns a BatchNo. This operation is absent from the v2 pre-approved endpoint list. Do not apply the v2 token to it or assume an imported batch is a posted/reconciled journal. MRI must confirm compatibility/access and the intended journal operation.
- A subsequent controlled diagnostic from the production server authenticated successfully (HTTP200/Bearer token) with the activation email and supplied password; the short username had returned HTTP400 invalid_grant. Read-only discovery returned Blend and BlendTest with identifiers. Tokens and identifiers were not printed. Store/use the activation email for this account. App-route verification is tracked separately in PROJECT_CONTEXT.md.
- The Swagger browser form did not produce a verified sign-in result. Its legacy UI also logged a missing-input JavaScript error. The server-side connection check provides a controlled, tested alternative using the published contract.

## Preparation behaviour

- Explicit `mri.view` and `mri.manage` permissions require organisation-wide scope. No role grants are changed by this release.
- Settings use the existing AES-GCM secret vault and `INTEGRATION_CONFIG_ENCRYPTION_KEY`. Login, password and database identifier are write-only, encrypted at rest, and absent from readback/audit. A deterministic organisation connection identity plus serializable saves prevents duplicate initial configurations. Stale edits are rejected. Unexpected or duplicate legacy configurations are held for review.
- Database label/environment are operator declarations, not provider verification. Changing either clears the old database identifier unless a replacement is supplied. Credential changes reset success/health evidence; there is no enable-posting field or arbitrary remote endpoint. Checks use fixed MRI HTTPS endpoints, disallow redirects, limit response size/time and never retry automatically. At most three manual checks per organisation per five minutes are permitted. Safe result/audit updates recheck the exact saved revision after network calls; credentials changed during a request cannot inherit its success. Provider diagnostics are not echoed.
- Monthly review uses South African calendar-month boundaries and an organisation-scoped, consistent database snapshot. Maximum 10,000 source rows; exceeding it fails rather than silently truncating. The month may still be open. Rows are grouped by current tenancy store and entry type, with amounts/tax shown exactly as stored, without an assumed debit/credit or gross/net convention.
- Any test-payment history or non-ZAR payment quarantines the entire account for this preliminary review. This is deliberately conservative and does not repair historical records. Unassigned stores are visible. Current tenancy store is not a historical accounting mapping.
- Included movements still require account-balance, receipt provenance, period, correction, tax and mapping checks. This is not a balance sheet, income statement, approved revenue total, complete finance export or eligible-posting list. Merchandise, settlement fees/payouts and other non-ledger sources are not added. Late changes require a fresh review.
- The response contains aggregate rows, a source fingerprint and generation time; no tenant names, descriptions or credentials. It is not a persisted, independently approved batch. The historical payment outbox is counted but untouched and never sent.

## Required next implementation

1. Use the located v2 reference to verify API-user authentication and database access. Discover the Blend identifier if permitted; otherwise obtain it from MRI. Confirm the intended database identity and reference mappings before any financial use.
2. Obtain explicit test-database access/authority. Do not treat Blend as a test database or create example transactions in it.
3. Finance/MRI confirm the dedicated property/entity, GL and transaction codes, tax/deposit treatment, opening balances, timing, currencies and period controls. Define completeness across tenancy ledger, merchandise, fees and adjustments.
4. Implement the documented journal contract with balanced, immutable source snapshots; mapping versions; independent approval; unique source/batch identity; and a durable submission state machine.
5. Verify provider duplicate/idempotency and lookup semantics. Ambiguous outcomes must stop for reconciliation instead of blindly retrying. Prove correction/reversal handling and provider readback against ledger/control totals.
6. Reconcile an authorised test batch in MRI, then complete finance UAT, support ownership, training and explicit live activation. Prior payment, historical-data, legal, physical-access and launch gates remain open.

## Validation

`tests/mri.test.ts`, `tests/mri-provider.test.ts`, `tests/integration/mri.test.ts` and `scripts/test-mri.mjs` cover preparation only, with invented isolated fixtures. They cannot establish successful MRI authentication, accepted journals or end-to-end accounting reconciliation. See canonical `PROJECT_CONTEXT.md` for commit, CI, merge, deployment, configuration and production evidence separately.
