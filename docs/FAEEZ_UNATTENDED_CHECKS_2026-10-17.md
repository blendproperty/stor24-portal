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

Proof: original `output/faeez-23-unattended/hostinger-latest-actions.jpg` captured17October15:28:33.811UTC (17:28SAST),149140bytes,SHA256 `d8f766a61688cb2bc94d37115dcd39cd2fbd5756cea76b285c696969873b4c49`. The companion original `.txt` is only an accessibility no-change observation, not a full action-table transcript. A complete recapture at15:36:11.656UTC (17:36SAST) is `hostinger-latest-actions-full.txt` (7935bytes,SHA256 `2ceef913a4401e3ea15466504414c85d37e2c7d125e6a6f31a4a682c082c7989`) and `hostinger-latest-actions-full.jpg` (same149140bytes/image hash). `provider-proof-metadata.json` records exact filesystem UTC timestamps and hashes. The loaded action rows still match the original observation. No power, restart, account/security/settings, credential, support submission or provider message action was taken. The original user-owned provider tab was restored to its initial Hermes landing URL.

## Items 14 and 16: current cohort and retained-location readback

Ran the existing **Enquiry sources, booking quotes and payment outcomes** template through the genuine Reports library. Its actual filters are1–17October2026, Enquiry created (SAST), All permitted stores, no extra filters. Generated17:31:06SAST:15 source/result rows, all Midpoint;13 NOT_CONVERTED and2 REVIEW_REQUIRED. Both review rows explicitly say Original booking price snapshot is missing. Local result search for REVIEW_REQUIRED shows exactly those two rows. No missing quote, accepted amendment, receipt or overdue amount is invented.

Independent read-only SQL under the same organisation/date interval (30September22:00UTC inclusive to17October22:00UTC exclusive) returns15 leads,10 linked bookings,0 converted bookings,2 bookings without initial snapshots and1 retained enquiry-location object. The live report shows that one city/province entry as Midrand/Gauteng. This proves current persistence/report consumption for that existing entry; it does not prove all five public forms' real-customer submissions, historic location completeness or finance reconciliation for a converted account.

One of the15 rows is explicitly labelled Staff training only, with zero bookings and no financial amounts. It must not be counted as genuine customer demand when interpreting this current dataset. This verification did not alter historical sources or hide the synthetic row. The fixed R600 training amount is not represented as a posted receipt or overdue financial charge in this report.

Proof: `cohort-report-current.txt/jpg`, `cohort-report-scope.txt`, `cohort-two-review-holds.txt/jpg` and `cohort-count-readback.json` in the private evidence directory. No report definition was saved, scheduled or exported; no source data was changed. A role-based selector mismatch was resolved using the observed native checkbox control, without changing the application.

## Ownership and publication

This checkout owns live browser verification and its evidence/documentation only. It has **no source changes** to booking-confirmation-email, tenant-welcome-email, customer-history, exports, marketing or their producer tests. The existing guide/email-history owner retains those source changes and sole PR544 deployment/runtime proof. The outage owner retains origin logs/remedy. Main promotion remains coordinated; this report and canonical context are supplied on `codex/faeez-23-closeout-20261017`, without competing main promotion or resuming paused REA533/521.

Implementation: this supplement is documentation; the test exercised released code. Testing: genuine UI/reload/filter plus independent task/audit readback above. Commit/push: review branch history. Merge: pending coordinated normal union. Deployment/configuration: none introduced here. Live verification: actual scope above; no all23 operational completion or deferred human acceptance is claimed.
