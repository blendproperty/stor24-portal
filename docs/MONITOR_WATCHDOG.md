# Independent monitor watchdog candidate — 29 October 2026

Status: source prepared; not active. Existing monitor remains unchanged until this candidate is approved, checked and promoted.

The existing Cloudflare scheduler and GitHub monitor can both fail without being able to report their own failure. We propose one Healthchecks.io check on its currently advertised $0/month Hobbyist plan (20 checks,100 ping-log entries per check). This is a separate provider, not another job on the monitored VPS. It is still dependent on Healthchecks and the recipient's email delivery; no availability guarantee is claimed.

## Proposed configuration

- Account and only notification recipient: Brett, brettd@blendproperty.co.za. Provider registration/terms and notification enablement need Brett's approval. No paid upgrade, card, SMS or WhatsApp.
- Check: STOR24 external production monitor. Period10minutes, grace20minutes: an absence is reported approximately30minutes after the last check-in, subject to scheduling/delivery. Confirm provider settings and actual controlled expiry/recovery before relying on it.
- Only a per-check secret HTTPS ping URL in the existing GitHub **production** environment secret STOR24_WATCHDOG_PING_URL. No Healthchecks Management API credential or STOR24 administration credential is needed. Treat the URL as a secret: possession permits fake check-ins/failure signals for that check. Revoke/regenerate it if exposed.
- Share only timing, success/failure and the provider-observed GitHub network source/User-Agent, plus the account email/check name. No customer records, database content, logs, passwords, application API keys or recipient lists in ping bodies. Retain public workflow history separately;100 entries is approximately16.7hours at a ten-minute cadence.

The final step of the existing alerts job checks in only after notification handling, dashboard publication and artifact upload. Successful readiness, host evidence and alert-job status produce a healthy ping. A failed/skipped/cancelled named check or failed alert publication sends /fail, enabling the independent email path to report a problem even when STOR24's normal sender fails. Missing/malformed configuration fails closed. If no runner executes, no ping arrives and Healthchecks detects expiry. No automated site lockdown, account disable, retry of customer/provider messages or server mutation is added.

## Scope and tests

Changes reach scripts/ping-monitor-watchdog.mjs, the existing production monitor's final step, monitor-probes path selection/test command and the normal unit suite through tests/*.test.mjs. Five local tests cover exact destination enforcement, query/userinfo/lookalike/HTTP refusal, absence of payload/credential headers, all unhealthy check combinations, invalid evidence, HTTP/transport rejection and no secret disclosure or automatic replay. Node22 hosted Linux/macOS probe checks remain required. Local tests use a fake UUID and stubbed fetch; they never contacted Healthchecks or sent a notification.

## Rollout and acceptance

1. Complete normal current-head checks/review. Keep this PR draft/unmerged until provider configuration and approval are ready; a missing secret intentionally fails the added step.
2. With Brett's approval, register/verify the account, review/accept the provider terms, configure only Brett's email and the schedule/grace. Store the per-check ping URL as the scoped production secret without printing it.
3. Verify a labelled commissioning failure/recovery and a genuinely missing-ping expiry in a separate commissioning check. This sends external emails and needs explicit approval; it must not stop the production scheduler or fabricate a production outage. Obtain Brett's inbox acknowledgement.
4. Promote through normal protection. This changes monitor workflow/scripts, so deployment behaviour must be reviewed: the portal's ordinary main merge may also trigger an application deployment. Do not merge until that rollout consequence is approved or a separately reviewed workflow-only promotion path is established. Do not use skip-ci to evade runtime checks.
5. Verify at least two natural monitor completions, matching provider check-ins and no secret leakage; record first real failure/recovery acceptance separately from stub tests. Only then enable the agreed production watchdog notification policy.

Rollback the workflow through reviewed source if required and pause only this provider check after owner agreement; otherwise deliberate rollback would itself trigger a missing-ping alert. Preserve the existing production monitor/Worker schedule, all rootSSH/native5432/recovery and provider/customer/staff/device/finance/privacy/legal/data/training/UAT gates. Privileged-account/key/configuration/content/login detection is separate, still open work.

Sources: [Healthchecks documentation](https://healthchecks.io/docs/), [pricing](https://healthchecks.io/pricing/), [terms](https://healthchecks.io/terms/), [privacy](https://healthchecks.io/privacy/).
