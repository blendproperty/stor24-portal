# Internal arrears review tasks

19 October 2026. Source/native/browser qualification, promotion and normal deployment are technically verified. Staff acceptance remains deferred. Exact dates/refs/runtime evidence and separate stages are recorded in PROJECT_CONTEXT.md.

In Collections, open an account and Request internal escalation review. Enter the case note, review topic, proposed notice channel if relevant, and requested review date. Record held review request retains the existing history-only behaviour. Create internal review task records the same held request and an assigned Operations task together.

The task option requires current Collections view/manage and Operations view/manage authority at the same store. The saved follow-up owner is used only if currently eligible; otherwise the requesting staff member is assigned. Existing open work for the same account/topic/channel is reused without silently changing its date or assignee. An ineligible/unassigned existing task must be cancelled in Operations before a replacement is requested. The actual task-status API reads the current row under lock and prevents a completed/cancelled review task from reopening behind a replacement; a new explicit request may create new work. Same-request retries do not duplicate either record.

The requested date is due by the end of that South African calendar day. Operations shows the task in the existing store/person/status/date filters. Completing it records task progress only. Policy/source review can be requested while evidence is held; it does not satisfy or replace seven-day access-review eligibility. Open Collections and recheck the current case before any later separately authorised workflow.

Task descriptions contain the account number and generic review instructions, not the case note, policy reference, amounts, bank details or message body. Detailed evidence remains in Collections. Fresh assignee authority is rechecked before linking an existing task. Task creation, case revision, activity and audit are one serializable, account-locked transaction. No account balance, ledger, payment, promise, dispute, fee amount, customer communication, worker schedule or physical-access state is changed. Fee amount remains unset pending Liezl/Mark; no financial or access approval is granted. No new permission or provider setting is introduced.

Remaining legal wording, Netcash authenticated final-result ingestion, installed-provider lifecycle and physical/device/staff acceptance gates remain. User hands-on testing is deferred.
