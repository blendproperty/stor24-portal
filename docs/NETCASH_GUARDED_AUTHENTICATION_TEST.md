# Guarded bank-authentication test

This is one explicitly approved real bank-authentication test, never a collection or financial receipt. It does not activate itself. Current Netcash TT1 template/test payer evidence is still unavailable; no production flag, role grant, payer approval or provider request is created by this implementation.

## Admission and current authority

The native staff page exposes controls only when the separate submission/status flag is enabled. Every POST is same-origin, strictly bounded and rate limited. Account, saved native consent and selected facility are exact inputs; provider keys, merchant, amount, approval, bank details, actor, contract override and retry are forbidden. Submission requires typing SUBMIT ONE BANK TEST and current active same-organisation payments.view + payments.bank_auth_submit at the original permitted facility. Read-only provider status lookup uses payments.bank_auth_status instead. Role definitions do not grant them to anyone.

`NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED` defaults off independently of preparation, Pay Now and existing card/EFT choices. `NETCASH_DEBICHECK_STATUS_LOOKUP_ENABLED` separately defaults off. The previously documented exact purpose-specific operator approval assertion remains mandatory at both claim and pretransport; it is not provider verification. Known batch/TT2/RMS contradictions, unapproved payer/template/amount/date/merchant and changed source are rejected. Existing signing-only details remain signing only.

## Durable one-attempt behaviour

1. Under the same account lock and Serializable transaction, rederive the original reviewed setup, exact currently approved source, sealed native consent and current independent reviewer. The consent must be REVIEWED, unwithdrawn, unexpired and backed by the owning tenant's saved audit. Standalone audit rows cannot manufacture consent. The reviewer must remain active with current same-store payments.view + payments.bank_auth_review and a different email from the verified tenant.
2. Commit exactly one deterministic original attempt before any network call. A repeated request returns that original record and never resumes or replays its transport, even when it is only CLAIMED or the creation flag is now disabled. There is no queued scan or automatic reclamation.
3. Recheck current submitter/reviewer, tenant/source/template/merchant/approval and exact claim in a second transaction immediately before transport. Recheck flag, approval hash/window and consent time synchronously before entering the one-shot SOAP function. A local guard failure leaves a retained claim with no provider attempt; it does not invent a bank result or make the record runnable again.
4. Execute one SOAP authentication request with redirects forbidden and a 200-second transport timeout. No retry wrapper, SDK retry, provider callback retry or network request exists inside either database transaction. A timeout, non-success HTTP response, malformed/contradictory response or process crash cannot authorise another request.
5. Retain the original encrypted result and audit atomically. If this transaction fails or its commit is unknown, do not repeat persistence or transport: return an explicit history-required hold without inventing an outcome. The original attempt must be investigated. Persisting response evidence does not depend on permissions remaining enabled after a request already happened.

A browser/proxy timeout is not proof of failure or cancellation. The UI clears actionable state and directs staff to saved history. There is no repeat/retry button for a retained attempt. A long-running request may still complete after the browser disconnects; an interrupted process may leave CLAIMED. Neither is a recovery queue.

## Status reconciliation

An explicit status operation can use only a valid contract originally returned by that exact retained attempt. It rechecks current status-reader permission, original signed setup/account/tenancy/store and original configured test merchant/connection before the read. It never accepts a caller-entered contract. Missing references cannot be reconstructed from account IDs, callbacks or guesses. Expired consent does not prevent investigating a previously attempted request.

The status operation is read-only at Netcash and appends a separate encrypted observation locally. The original response is never replaced, even when an unknown original later reads Accepted. Identical status evidence is retained once; explicit later reads are not new authentication requests. Revoked current read authority before local retention prevents the new observation from being saved. No collection, mandate completion, bank settlement or receipt is inferred.

## Validation and external gates

Actual isolated PostgreSQL covers committed claim before physical request, parallel callers/one request, disabled/missing approval/wrong store/revoked permissions/withdrawn consent, network/HTTP/malformed uncertainty, failed result-audit rollback/no replay, real role deletion committed with claim and caught before transport, later original-bound status observation without original overwrite, and missing-contract refusal. All financial payment/ledger/instruction baselines remain unchanged. Every response and payer/template is explicitly synthetic; no real Netcash request is made by the tests.

Route and responsive browser checks cover strict purpose/authority, typed confirmation, duplicate-click protection, held outcomes, missing contract, status reads after expiry, store binding, malformed/failure clearing and focus, and four widths. Local and CI proof does not replace an actual approved payer/card/device flow, provider acceptance, financial/legal decisions, staff training or UAT. Canonical PROJECT_CONTEXT.md separately records implementation, checks, push, merge, configuration and actual live proof.
