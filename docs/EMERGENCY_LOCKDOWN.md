# STOR24 emergency lockdown

Owner: Brett Dovey, brettd@blendproperty.co.za. Updated 29 October 2026.

## What is installed

Cloudflare > stor24.co.za > Security > Security rules contains:

- **EMERGENCY - STOR24 public lockdown - normally disabled**: Block, first position, normally Disabled.
- **DRILL ONLY - STOR24 unused URL - normally disabled**: Block only the exact synthetic path `/__stor24_lockdown_drill_20261029_a781bb5c`, normally Disabled. This is a repeatable edge test, not the emergency switch.

The emergency rule expression is:

```text
(http.host in {"stor24.co.za" "www.stor24.co.za" "portal.stor24.co.za" "cms.stor24.co.za"} and not (http.host eq "portal.stor24.co.za" and http.request.uri.path in {"/_operations/monitor/host" "/_operations/monitor/dashboard"}))
```

Only the two existing authenticated Cloudflare Worker evidence endpoints are excluded. They do not provide application administration. There is no customer, staff, IP-address, HTTP-method or payment-callback bypass. Do not add an exception during an incident without checking its risk. Other domains and VPS applications are outside this rule.

On the current Free plan this uses the standard Cloudflare block page/403, not a branded maintenance page/503. The zone currently uses two of five custom-rule slots including the disabled drill. No billing upgrade, DNS change or new API token was needed.

## Emergency action

1. Use a trusted device and the existing Cloudflare account. Record the suspected incident, UTC/SAST time, affected systems and who authorised containment. Brett must authorise a planned full-site drill or an actual activation; preparation is not standing approval to interrupt production.
2. Open stor24.co.za > Security > Security rules. Select **EMERGENCY - STOR24 public lockdown - normally disabled**, verify the expression above and Block action, choose Active and Save, then confirm the live-impact prompt. Do not activate the DRILL rule instead.
3. Check fresh, uncached requests from outside the VPS: website home and booking, portal login/API and CMS login/API should be blocked. Check that the authenticated monitoring reports still update. A 403 or an unavailable health check during deliberate lockdown is expected containment evidence, not proof of a hack or a failed database. Keep outage alerts visible and record the planned containment time; do not silence the monitor indefinitely.
4. Pause further deployment/configuration changes using trusted GitHub/provider controls. Escalate to the technical responder. Preserve logs, provider audit events and a forensic copy before rebuilding or deleting anything. Do not automatically restore a backup over the suspected system or overwrite the last potentially clean backup.
5. If server compromise is suspected, the edge rule is only the first containment step: it does not terminate existing connections, stop background jobs, revoke sessions, stop outbound theft or block SSH/database/direct-IP/legacy-host access. Arrange separately scoped VPS/network isolation with Hostinger and account/session/key revocation. This is a shared VPS; indiscriminate shutdown affects unrelated applications and requires an incident decision.
6. Rotate compromised credentials from a clean device, revoke affected sessions and investigate the entry point. Resetting a password on an infected device can expose the replacement. Assess customer-data exposure and involve the responsible privacy/legal people before any required notifications; this runbook does not determine notification obligations.

## Reopening

Keep the emergency rule Active until Brett and the technical responder agree that containment, remediation, credential/session revocation and recovery checks are sufficient. Rebuild/restore in isolation first where appropriate. Reopen by changing only this rule to Disabled and saving; verify outside-VPS health, expected denial boundaries and monitoring recurrence. Record who approved reopening, exact changes and unresolved risks. A green homepage alone is insufficient to reopen.

Do not use Pause Cloudflare, Development Mode, DNS changes or Under Attack mode as substitutes. Under Attack mode addresses DDoS traffic and can disrupt APIs; it does not remove a server intruder.

## Verification on 29 October 2026

The provider accepted the full expression and persisted the emergency rule Disabled after reload. An independent canary rule was temporarily Active on the unused path only: baseline website/www/CMS404 and portal login redirect200 changed to Cloudflare403 on all four hosts at17:31:29Z. At the same observation, home, booking, portal health and CMS login remained200; anonymous monitoring remained401. The drill was then Disabled. Full production lockdown/payment-callback interruption was not performed; the canary establishes edge enforcement only.

## Monitoring already operating

The existing Cloudflare scheduler dispatches GitHub Monitor production approximately every ten minutes. Host backup/resource checks publish every five minutes; the external checker rejects host reports older than fifteen minutes. Public application/database/expiry-worker and eight plain/forged direct-origin checks remain external. Healthy silence, failure/recovery alerts, encrypted last-known recipients and cooldown are already implemented.

Read-only verification on29October: original scheduled runs40917641521,40919269216 and40920886702 passed; latest dashboard entry40920886702 at17:24:23Z reported SAVED_RECIPIENTS / HEALTHY_NO_NOTIFICATION with zero sends. Host timer last-trigger17:24:53Z, service exit0 and key file0600. These observations do not establish that a notification reached Brett's inbox or that the server has no malware.

## Next steps and approvals

1. One explicitly labelled test email to Brett only through the existing service; no SMS/WhatsApp/customer sends. Owner approval and inbox acknowledgement remain required. Do not use the existing test-alert workflow blindly: it targets the configured operations team/channels, not necessarily Brett/email alone.
2. Add privileged-account/key/configuration change detection with a reviewed baseline and external alert evidence. A baseline detects subsequent changes, not pre-existing compromise; approved maintenance needs explicit re-baselining. New security markers must travel through collector, receiver, validator, alert rendering and tests together. Do not label resource/uptime monitoring intrusion detection.
3. Add a separately hosted stale-monitor watchdog with agreed recipient and budget, so Cloudflare/GitHub failure or an exhausted Actions cap cannot create silent monitoring loss. An extra GitHub job alone does not cover a GitHub-wide failure. Provider/account/credential creation and external test sends require their applicable approval.
4. Add representative website/CMS integrity and login-abuse signals with off-server retention; establish known deployment changes versus suspicious changes. No automatic whole-site lockdown from a single anomaly or Hudson Rock finding.
5. A full lockdown/reopen drill needs a separately approved maintenance window and payment-callback reconciliation plan. Branded maintenance requires a separately reviewed edge response; the installed control is403.

Root SSH retirement, native PostgreSQL5432, independent recovery/admin/key custody and full restore remain separate open work. Hudson Rock access/production entitlement is pending; no exposure monitoring is active. Preserve every existing provider/customer/staff/device/finance/messaging/signature/physical-access/privacy/legal/source-data/training/offline/UAT gate.

References: [Cloudflare custom rules](https://developers.cloudflare.com/waf/custom-rules/), [Under Attack mode](https://developers.cloudflare.com/waf/tools/security-level/), [existing scheduler](monitor-scheduler/README.md), [existing alerts](OPERATIONS_ALERT_RECIPIENTS.md).
