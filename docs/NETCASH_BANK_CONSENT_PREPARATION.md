# Separate bank-authentication consent preparation

This workflow prepares and retains a verified tenant's explicit permission for one bank-authentication request. It never calls Netcash, submits a request, records cash or enables collections. Existing card, EFT and card-subscription flows retain their separate contracts.

The default-off `NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED` flag controls preview/save and independent review. Reading retained permissions and withdrawing an unattempted permission remain available when preparation is disabled. No flag or role grant is made by this implementation.

A preview requires a currently reviewed original setup, signed lease, active scoped tenancy, unchanged approved billing and merchant connection, a reviewed whole template observed within fifteen minutes, and separate trusted deployment evidence. The exact signed permission expires ten minutes after preview; saving and review cannot extend it. Expired records must be explicitly withdrawn before a replacement is retained. An attempted original request cannot receive another permission or be locally cancelled.

## Provider approval remains external

`NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL` is a bounded JSON deployment assertion of separately supplied Netcash approval. It is not provider verification and has no default. It binds organisation, facility, account, customer, merchant, exact observed template hash, secret-keyed payer fingerprint, amount/date, purpose BANK_AUTHENTICATION_TEST_ONLY and mode TT1_SYNCHRONOUS. The operator records the actual provider evidence reference and approval recorder. A maximum twenty-four-hour approval window must have at least ten minutes remaining at each source check.

Never invent positive raw provider enum values. Known batch/TT2, RMS and inconsistent monthly terms are independently rejected. No supplied signing-only payer details may be repurposed. Real TT1 and approved bank-authentication test details were explicitly unavailable on 16 October 2026. No credentials, payer details, provider approval reference or live configuration was created for testing this feature.

## Evidence and authority

The payload is HMAC signed, then encrypted with the integration vault. Generic configuration read/write excludes this domain. Outer metadata supports exact scoped lookup only; private bank details remain solely in the existing encrypted original setup. Every write and its audit are atomic under the same account lock and Serializable transaction. No automatic transaction retry is introduced.

Duplicate save returns the retained status, including withdrawn or expired, without creating another consent or reopening it. Tenant history and staff history use stable twenty-row cursors. All projections distinguish whether an attempt is retained; preparation itself never performs a provider action or proves a financial receipt.

Staff require current active same-organisation access to the original store, payments.view and payments.bank_auth_review, rechecked in the writing transaction. The reviewer must have a different email from the verified tenant. Staff cannot manufacture tenant consent. The separate permission is saved only through the authenticated tenant route with same-origin, strict bounded input and rate limits.

Preparation audits deliberately use `netcash.debicheck_bank_consent_saved` and `netcash.debicheck_bank_consent_reviewed`. They cannot satisfy the existing internal attempt journal's bank-authentication audit contract. Connecting a guarded caller remains a separate unfinished task: it must validate this exact unwithdrawn, unexpired encrypted record, current source and reviewer authority at the first sensitive sink, commit one durable claim before transport, forbid every HTTP/SOAP retry after uncertainty and retain original outcome separately from later status reads. No caller or scheduler is added here.

## Validation and release limits

Synthetic PostgreSQL tests cover encrypted save/review, exact idempotency, changed source, missing separate approval, revoked role, same-customer review rejection, withdrawal while disabled, expiry/foreign identity, twenty-row paging, attempted-request refusal, tampering and audit-failure rollback. Synthetic raw template labels are test fixtures, not verified Netcash positive TT1 responses. Browser fixtures exercise explicit consent/review, paging, withdrawal, failed/malformed recovery, focus and four responsive widths. None proves actual provider acceptance, tenant banking consent, device delivery or staff UAT.

Canonical PROJECT_CONTEXT.md records each implementation, test, push, merge, configuration and live verification stage. Full provider, finance, customer, staff, legal, training and approval gates remain separately open.
