# Customer appointments and covering-staff handovers

Implementation checkpoint15October2026. Follow release evidence in PROJECT_CONTEXT.md; this guide alone is not proof of deployment or staff acceptance.

1. Open **Operations centre → Customer follow-ups & covering-staff handovers**.
2. Choose **Schedule follow-up**. Search the customer by name, then select the exact record and store. Existing store/customer permissions apply.
3. Select the responsible staff member and, where needed, covering staff. Only active staff with access to that store are offered.
4. Enter the date/time in **SAST**, a clear title and the agreed action. For example: “Customer agreed that Faeez may call on14October at09:00 about the promise due15October.” Save the appointment.
5. The appointment appears in the open queue and existing calendar. **Customer history** opens that exact customer's notes and communications. Those downloads still require the separately delegated customer-history export permission.
6. The named cover signs in with their own account and chooses **Acknowledge cover**. Other staff cannot acknowledge on their behalf. Updating/removing cover clears the old acknowledgement. Completion/cancellation and cover changes require operations management permission and are audited.
7. Choose **Complete** after carrying out the agreed action, or **Cancel** if it no longer applies. Closed appointments leave the open queue; recorded audit history remains. Use **Load more appointments** for later open pages.

An agreed appointment is separate from collection debt-chasing eligibility. An open payment promise due15October keeps ordinary collection calls held through that date. Scheduling an agreed call on14October does not remove that hold, send a message, record a receipt, approve a financial adjustment or change access.

If saving cannot be confirmed, use **Reload follow-ups** and check what was saved before retrying. A new appointment keeps the same retry identifier during that page session; changed details after an uncertain save can be rejected as a conflict. If a handover changed meanwhile, reload the current version rather than overwriting it. A failed reload leaves changes blocked. Loss of access clears the displayed records.

Staff acceptance remains open: Faeez and a named covering staff member must use their own accounts to create/read the exact14th/15th scenario, acknowledge and reassign cover, complete a call, and download permitted customer history. Record tester, store, time, expected result, actual result and retest evidence. Automatic browser/database tests do not establish their acceptance. Manager notifications, arrival readiness and payment review have separate rollout items.
