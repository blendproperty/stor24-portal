# Operational checklists and padlock walkthroughs

Implementation checkpoint: 30 October 2026, Africa/Johannesburg. Entry point: **Operations centre → Checklists & padlocks** (`/operations/checklists`). This extends existing Tasks, Operations queues, Calendar, assignment/cover and audit records. Release and live acceptance status belong in `PROJECT_CONTEXT.md`.

## Plan and perform a run

1. Staff with current store-scoped `operations.view` and `operations.manage` choose **Plan checklist**, store, template, first date, SAST start/due time, responsible staff, optional absence cover and a separate manager/GM reviewer. The reviewer needs current view/manage access to that store. No existing role or grant changes.
2. Choose one occurrence or a finite daily/weekly series, up to 31 occurrences. Padlock runs support once or weekly. Each occurrence is an independent Task; the series does not automatically replenish. The planner uses same-day windows; the API rejects windows longer than 24 hours. Store timezone must be `Africa/Johannesburg`.
3. The named preparer or cover selects **Start inspection** once the window starts. Assigned staff need current `operations.view`; assignment delegates this specific checklist work without generic task/financial/inventory/access management. Other viewers cannot enter results. Managers may reassign staff/cover/reviewer before closure, with audit history.
4. Enter each result: Passed, Issue/failed or Not applicable. Failed/skipped checks require an explanation. Trolley checks require numerical counts, including zero where appropriate. Evidence references can identify existing photographs or maintenance records; this workflow does not upload files or certify evidence. Save progress explicitly.
5. **Submit for manager review** requires complete results/counts/reasons and freezes results in WAITING. The separate assigned reviewer returns the run with a correction note or signs off with an action/review note. Review is internal; no email/SMS is sent.
6. Signed-off/cancelled runs remain history and cannot reopen through this workflow or the ordinary task-completion button. Each change and audit commit together. Sign-off does not mark underlying faults repaired; use existing maintenance/operational queues for follow-up.

Operations and Calendar link to the record. The dedicated list offers store/open/history filters, due/overdue labels and pagination. A failed or uncertain save blocks further writes until reload; nothing automatically replays. Reload asks before discarding dirty results. Request keys protect creation from duplicate transport retries; versions reject stale edits.

## Attachment mapping

Sources: Faeez's 28 October operational attachments and 29 October follow-up. Originals remain private local evidence; see `FAEEZ_EMAIL_REVIEW_2026-10-30.md`.

| Template | Attachment and behavior |
|---|---|
| Opening | `Checklist 1 Opening.xlsx`: opening, ground/first/second floors and yard; doors, alarm, fire equipment, HVAC, cameras, lights, sprinklers and trolley counts. |
| Closing | `Checklist 2 Closing.xlsx`: doors/gates, alarm, lights, charging, taps, dedicated plugs, air conditioning and trolley counts. |
| Cleaning | `Cleaning Roster.xlsx`: reception, yards, kitchen and storage floors. Reception windows and office-front cleaning are added on scheduled Sundays. |
| Management | `MANAGEMENT CHECKLIST.xlsx`: daily infrastructure/security/service-date checks; pump/ICV and generator tests are added on scheduled Fridays. Scheduled SAST day controls additions across UTC date boundaries. |
| Padlocks | `Padlock Count - Blank.xlsx` and `The Procedure of the padlock Count.docx`: all current standalone units, physical observations/counts, rent-roll and collections comparison, discrepancy reasons and manager/GM review. Old sample A/B/etc. unit labels are not imported. |

These are work/evidence records, not employee attendance, payroll, financial reconciliation or equipment controls. Site relevance, actual floor/equipment layout, safe instructions, evidence requirements, responsibilities, absence cover and operating hours require manager/Faeez acceptance. Not-applicable items require a reason.

## Padlock comparison

- Future planned runs hold no stale inventory. Starting reads current permitted standalone units, excluding combined components; captured labels/time stay with the run. Limit: 1,500 units, failing explicitly above that.
- Expected VACANT means AVAILABLE with no active/notice occupancy. OCCUPIED means OCCUPIED with one consistent active/notice tenancy/occupancy. Other/inconsistent states are REVIEW. No customer financial/contact details are copied. These expectations are system records, not physical observations.
- Existing open `PHYSICAL_OVERLOCK` tasks flag units for comparison. They do not prove eligibility or fitted locks. Staff compare a manager-approved collections list and record that reference with the rent-roll reference. Unpermitted CSOs are not given access to debt through this workflow.
- Every unit needs Vacant, Occupied or Overlocked and a numerical lock count. Mismatches, REVIEW states, observed overlocks and open-overlock flags need reasons. Aggregate counts concern locks on inspected units, not warehouse/spare-lock stock.
- Submission checks the snapshot against a fresh scoped read. Changed units/states/overlock flags cause conflict. Save notes if needed, then explicitly restart and repeat the inspection. Restart clears draft results but retains earlier saved versions in audit. Submitted/reviewed records are evidence of their stated snapshot time.
- Review shows observations, counts, reasons, evidence/comparison references, submitting identity/time and reviewer feedback. Findings stay visible after sign-off. Investigation, fitting/removing locks and maintenance remain separate work.

No AccessDecision, gate command, physical overlock action, debtor notice, fee, payment, billing adjustment, stock movement or outward message is created. Observations do not change Unit.status or tenant access.

## Schema and validation

Migration `20261030080000_operational_checklists` adds nullable JSONB `Task.operationalChecklist`; old tasks are unchanged. Existing store/purpose/status/due indices are reused. Ordinary dashboard/calendar reads omit detailed JSON. New reads are private/no-store. Mutations require same origin and current active staff/store access; service validation checks assignment/version. Row locks serialize results/reviews; an advisory lock/request hash protects finite-series creation.

- Policy: `tests/operational-checklist-policy.test.ts`.
- Real PostgreSQL, actual route guards, concurrency, inventory drift and audit rollback: `tests/integration/operational-checklists.test.ts`.
- Actual React browser scenarios with compiled styles at 1440/390/320: `scripts/test-operational-checklists.mjs`. Includes planning, counts/results, save/submit/correction/review/history, padlocks, stale/lost responses and clearing data on access loss. Screenshots: ignored `output/checklist-browser/`.
- Adjacent scheduling/current-role/task-status tests also run. Combine fault-injection database suites using `--test-concurrency=1`; their temporary database-wide audit constraints must not overlap.

Full checks and environment limitations are recorded in canonical context. Initial Windows full-suite shell failures are distinct from feature assertions; Linux/Node 24.22.1 provides the production-compatible unit-suite check.

## Remaining gates

Protected CI/review, merge, normal deployment/migration, authenticated live verification, manager/Faeez/device acceptance and training remain distinct until evidenced. Do not enable financial/legal/collections or physical-access actions through this workflow. All prior data/provider/security/privacy/recovery/approval gates remain. No production staff assignment, recurring schedule, permission or outbound-message configuration is created by this implementation.
