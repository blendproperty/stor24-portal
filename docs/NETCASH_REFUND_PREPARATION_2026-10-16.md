# Native Netcash refund preparation and local reservations

16 October 2026. This describes the draft Stor24 controls; it is not approval to send a refund. Actual provider dispatch and processed/refused readback are absent.

## Staff flow

Open Adjustments > Review a Netcash card refund. Choose a permitted store, finance-approved refund and original reviewed card receipt. Preview rechecks the current approved adjustment and original financial evidence. Save preparation with a supporting reference. A different currently authorised reviewer approves or rejects it.

PREPARED and REVIEWED do not hold an existing manual payout. Explicit reservation is separately disabled by default. When enabled and authorised, its typed confirmation creates a local hold on manual payout recording and approved-refund cancellation. Reservation does not send money, authorize a provider request, or post a ledger entry.

A reservation survives feature disablement. Requesting release and independently approving release are separate actions with distinct typed confirmations. Release preserves terminal history and records no payout. It does not prove nobody paid outside Stor24. Existing finance controls still govern any actual manual payout.

## Source and authority

The server binds the approved original refund, current financial fingerprint, original live Netcash payment, ledger entry, exact merchant, current connection and one positive PNC row from the checksum-verified balanced retained full statement. It validates retained independent statement approval and original line resolution evidence. It rejects test payments, legacy merchant inference, ambiguous original identifiers and amount-only matching.

The numeric refund transaction stays a canonical positive string through range validation, bounded to the provider int32 contract before any future numeric conversion. No P2 reference, token, callback or account number is substituted. The legacy statement resolutionHash uses its original fixed-order JSON shape. Strict reconstruction preserves that shape across PostgreSQL JSONB key ordering without replacing the original expected hash or omitting required financial bindings.

All writes rederive active same-organisation and store authority. Native reservation additionally rechecks the original independent preparation reviewer and review audit. Encrypted/HMAC records bind source, state and revision. Audits and state commit atomically. The original merchant/transaction has one deterministic identity across stores; terminal records cannot be reopened or reused as another provider attempt.

## Controls and permissions

`NETCASH_REFUND_PREPARATION_ENABLED` defaults off for preview, preparation and independent review. `NETCASH_REFUND_RESERVATION_ENABLED` defaults off and is additionally required for reservation. Retained history, withdrawal/rejection and permitted release remain available with flags off; every action still requires current authority.

Every actor needs current `adjustments.view`. Dedicated grants are `payments.refund_prepare`, `payments.refund_review`, `payments.refund_reserve` and `payments.refund_release_review`. No role is automatically granted these permissions. The page uses current store permissions to present actions; UI state is never server authority. Generic configuration reads/writes exclude `NETCASH_PROVIDER_REFUND`.

The dedicated API uses strict inputs, same-origin writes, bounded bodies, per-actor rate limits, scoped history and typed confirmations. No key, payer details, arbitrary amount, numeric transaction, merchant override or provider result is accepted from the client. Duplicate or uncertain responses require retained history; they do not trigger a repeated write or transport.

## Hold and release invariants

Native reservation and existing manual payout/cancellation use the same account row lock. Both paths use their existing serializable transaction boundaries; no new automatic financial retry, timeout change or provider replay is introduced. If a manual action wins first, the original approved source is no longer reservable. If reservation wins, the manual action is blocked.

A release requires authentic original signed zero-dispatch state, matching reservation audit, an unposted approved refund with the same organisation, store and account identity, a separate release-request audit and a different current release reviewer. Any provider-attempt audit or unsupported attempted/unknown state blocks release. The contract literal `UNAVAILABLE_V1` has no transport entry point. A future provider caller requires a separate durable attempt journal and revised interlock/release policy; it cannot reuse this release as proof of no attempted refund.

Coverage is deliberately bounded: preparation refuses an organisation at 1,000 retained profiles; the manual interlock reads at most 1,001 and fails closed on overflow or malformed/incomplete evidence. No silent eviction, deletion or automatic hold reclamation is supplied. This is a known operational bound, not capacity acceptance.

## Verification and open gates

Policy/API tests passed 9/9 before the staff handbook update. Initial native scenarios passed at 73bd; the expanded native test step passed at 8de in job 116834490697 on 16 October 2026, 05:57:44-05:57:48 UTC. It covers nonholding preparation, explicit/default-off hold, disablement, independent release, manual payout/cancel ordering and races, reviewer revocation, audit rollback, corrupted evidence and provider-attempt release denial. The four-width/non-SAST synthetic browser step also passed at 8de in job 116834490346, 05:57:34-05:57:41 UTC. The full native job 116834490697 completed successfully. Final current-head checks after the handbook update and independent review remain pending; this note is not release clearance.

The updated handbook has 23 pages with new chapter06G. All22 incoming pages are preserved apart from page numbering. It is not staff UAT. Provider-approved real test authority, decimal amount contract, merchant-portal approval and processed/refused outcome evidence remain unresolved. No provider API acknowledgement may be treated as a paid refund, cash receipt or financial recovery521 clearance.
