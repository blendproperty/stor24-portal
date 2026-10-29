# Monitoring resource reduction — 29 October 2026

## Scope and design

The ten-minute Cloudflare schedule remains unchanged. Public application/database/expiry-worker readiness, direct-origin protection, independent macOS confirmation, host backup/resource checks, and the fifteen-minute host-evidence limit remain unchanged. No paid service, new credential, provider, budget, visibility or network-access change is needed.

The existing macOS `backup` job waits for final readiness and runs the dependency-free notification planner after checking fresh host evidence. It refreshes the existing encrypted recipient cache and publishes dashboard evidence on silent runs. The planner uses the same history, thirty-minute incident cooldown and recovery rules as the sender. A skipped sender does not count as a delivery attempt. Sender failure alone cannot manufacture a recovery. The planner and sender share one implementation of these rules.

The separate macOS `alerts` job, including `npm ci --omit=dev`, runs only when delivery is needed or preflight is unavailable. Missing outputs, failed steps, incomplete history and failed dashboard publication take the original sender path. The actual heartbeat result is restored as the `backup` job conclusion; recording its outcome does not turn a failed host check into success. No `continue-on-error` bypass is used. The sender rechecks history and still refuses workflow-attempt replay and uncertain provider replay.

This is a conservative first reduction: it separates lightweight routine checks from heavy notification setup without claiming that the Cloudflare dispatcher has become an independent uptime service. An edge-only uptime replacement and hourly GitHub audits remain a separate possible migration requiring parity tests and provider/live verification. Existing coverage should not be reduced on the strength of this change.

## Expected resource effect

On healthy runs with no network confirmation, hosted jobs fall from four to three; routine macOS jobs fall from two to one. At six runs/hour, that avoids about 144 macOS job starts and 144 production dependency installs per healthy day (4,320 of each over thirty fully healthy days). Conditional confirmations, incidents, recovery, tests and fallback paths add work. These are run-count estimates, not measured duration or cash savings. The reported repository is public and the gross usage figure is not a verified bill.

## Validation evidence

- Focused monitoring suite: 43 results, 41 passed, zero failed, two existing Windows-only skips for Unix file modes and symlink entrypoints. Covers failure/recovery, independent worker/host reporting, stale/future/tampered heartbeat rejection, cooldown and skipped-sender behavior, recipient selection/encrypted fallback, provider uncertainty/replay, actual CLI silent publication/cache refresh, and legacy CLI rollback behavior. All provider requests are stubbed.
- Initial sandboxed run exposed the existing Windows temporary-file rename restriction in recipient-cache tests; the same final focused suite passed outside the filesystem sandbox. No source change was made to the cache implementation or test to bypass that failure.
- Readiness policy/workflow assertions: three passed. The full readiness file initially failed its real curl integration because this Windows environment lacks `C:/Program Files/Git/bin/bash.exe`; that integration must pass on protected Linux CI. The initial workflow invariant failure from using `continue-on-error` was fixed by recording and restoring the host result; the invariant remains unchanged and now passes.
- Changed JavaScript/test ESLint passes; workflow YAML parses; `git diff --check` passes. Local Node is 24.18.0. Repository protected Node 24.22.1, image, browser, security and transaction checks remain required; no broad local application suite or live notification delivery is claimed.

## Activation and verification gate

Publish as a draft PR and obtain all normal exact-head checks. Do not merge, approve the PR, deploy the worker/application or change the cron as part of preparation. Owner authorization must cover normal promotion of the reviewed exact revision; merging main can trigger the repository's existing guarded application deployment automatically.

After authorized promotion, observe at least two existing scheduled healthy runs. Verify `readiness` and `backup` succeed, `alerts` is skipped, dashboard evidence is fresh, `recipientSource` and the encrypted fallback remain available, and no `npm ci` runs on the healthy path. Verify the workflow file on main matches the tested source. A separately authorized fresh `test_alert=true` dispatch should verify the existing configured providers and genuine recipient delivery; do not use reruns as delivery tests. Do not deliberately interrupt production or manufacture stale host evidence. Failure/recovery and stale-evidence behavior is covered by isolated tests until a real incident provides live evidence.

## Rollback

Before merge, close the draft or discard this isolated branch; current monitoring remains unchanged. After authorized activation, restore the workflow, sender and heartbeat CLI from baseline `206708af3abbef2aa32eef80db2f6db17850b3c9` in a normally checked revert PR (and remove the now-unused planner/tests if reverting the whole commit). The legacy heartbeat CLI exit behavior remains tested. The original always-run sender can be restored without changing Cloudflare, credentials, recipients or evidence storage. Do not rewrite later unrelated main changes or replay an uncertain provider send.

## Remaining limits

No merge, deployment, cron change, live alert send, provider acceptance, real recipient delivery or live reduced-run observation has occurred during preparation. All existing production, recovery, provider, staff/device, finance/data, legal/privacy, training and approval gates remain at their recorded scope.
