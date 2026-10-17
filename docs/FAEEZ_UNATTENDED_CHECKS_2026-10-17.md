# Unattended live verification, 17 October 2026

Brett explicitly authorised completing unattended work for later review. This supplements the original 23-item register and the earlier same-day technical reconciliation. It does not convert deferred physical/device/customer/provider or business-policy decisions into accepted results.

## Item 7: remaining title and queue checks

Actual existing owner session in the production portal, using only the synthetic customer `TEST Faeez debtor training` / `TRAINING-DEBTOR-001` (`cmvav2xwy000001oequ7hejvn`). No other customer's existing appointment was changed.

| Check | Actual result |
| --- | --- |
| Required custom title | Choosing Other and saving an empty custom title displayed the browser's required-field validation and focused that field. No appointment appeared from that attempt. |
| Custom title and SAST persistence | Saved `TEST unattended title check 17 Oct`, 19 October 11:00 SAST. A full reload retained the title, customer, details and time. |
| Reopen custom title | Edit correctly reopened Other and preserved the original custom text. |
| Preset title edit | Changed only the title to Customer call. A full reload retained the preset, same customer and 11:00 SAST time. |
| Queue filtering | From tomorrow showed the synthetic future appointment; Due today & overdue excluded it and retained the pre-existing overdue task. The existing task was not modified. |
| Test closeout | Completed the synthetic appointment. Reloading the upcoming view showed No open agreed appointments. No open reminder from this test remains. |
| Independent readback | Task `cmvcjuktc000701pf9e95velm` is COMPLETED; dueAt `2026-10-19T09:00:00` UTC equals 11:00 SAST; completedAt `2026-10-17T15:27:15.770` UTC. Exactly one task matches the synthetic description. |
| Audit | One `staff_followup.created` at15:26:36.007UTC; one `staff_followup.update` at15:26:57.232UTC preserving before/after title; one `staff_followup.complete` at15:27:15.774UTC. |

These are genuine live technical checks, performed unattended by the agent under the owner session. They are not a new human acceptance claim, independent cover acknowledgement, changed-cover invalidation or a real customer promise. The fixed R600 training balance remains visibly available afterwards. No money, provider request, external message, role/grant, unit or access change was performed.

Private proof: `output/faeez-23-unattended/followup-{created,upcoming,custom-edit,preset-reloaded,due-excludes-training,completed-reloaded}.txt`, relevant JPGs, `followup-db-readback.json`, `followup-audit-readback.jsonl`, and `training-balance-current.{txt,jpg}`. One observation initially waited for an incorrect empty-state phrase; the actual UI text was inspected and recorded as No open agreed appointments. No product failure or repeated mutation is inferred.

## Read-only provider investigation support

The existing signed-in Hostinger session can access the correct running VPS. Its **Latest Actions** table was inspected through the visible UI: the newest record is `backup_create`, Success, displayed17October02:30:15; remaining first-page records predate the outage window. There is no displayed power-down/start action, initiating actor, task ID, maintenance reason or forty-minute recovery explanation on that page. The displayed timestamp has no timezone label, so it is not relabelled UTC.

The account **Account activity** page is a login/device history with country search, rather than a VPS power/maintenance audit. Unneeded login-location rows were not exported. Therefore access to the signed-in account is available; the unresolved evidence is the provider-side hypervisor/maintenance audit that these customer-facing pages do not expose. Absence of a displayed action does not establish that no provider action occurred. The separate outage owner retains the host-journal investigation and remedy decision.

Proof: `output/faeez-23-unattended/hostinger-latest-actions.{txt,jpg}`. No power, restart, account/security/settings, credential, support submission or provider message action was taken. The original user-owned provider tab was restored to its initial Hermes landing URL.

## Ownership and publication

This checkout owns live browser verification and its evidence/documentation only. It has **no source changes** to booking-confirmation-email, tenant-welcome-email, customer-history, exports, marketing or their producer tests. The existing guide/email-history owner retains those source changes and sole PR544 deployment/runtime proof. The outage owner retains origin logs/remedy. Main promotion remains coordinated; this report and canonical context are supplied on `codex/faeez-23-closeout-20261017`, without competing main promotion or resuming paused REA533/521.

Implementation: this supplement is documentation; the test exercised released code. Testing: genuine UI/reload/filter plus independent task/audit readback above. Commit/push: review branch history. Merge: pending coordinated normal union. Deployment/configuration: none introduced here. Live verification: actual scope above; no all23 operational completion or deferred human acceptance is claimed.
