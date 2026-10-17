export type OperationsGuideLink = { label: string; href: string };
export type OperationsGuideJob = { id: string; label: string; href: string; steps: [string, string, string] };
export type OperationsGuideGroup = { id: string; label: string; description: string; jobs: OperationsGuideJob[] };

// Navigation guidance only. Availability comes from the existing scoped dashboard.
export function operationsStartGroups(links: OperationsGuideLink[]): OperationsGuideGroup[] {
  const job = (id: string, label: string, source: string, steps: OperationsGuideJob["steps"]): OperationsGuideJob[] => {
    const link = links.find(item => item.label === source);
    return link ? [{ id, label, href: link.href, steps }] : [];
  };
  const tasks = links.find(item => item.label === "Reminders" || item.label === "Tasks due");
  return [
    { id: "customer", label: "Help a customer", description: "Booking, move-in, account or tenancy", jobs: [
      ...job("walkin", "Start a walk-in booking", "Walk-in on tablet", ["Choose the store and start the customer journey.", "Let the customer complete their booking details.", "Open the saved booking in Move in when ready to continue."]),
      ...job("movein", "Move a customer in", "Move in", ["Find the customer's booking or select the appropriate unit.", "Follow the Move in steps and review the current documents, identity and payment checks.", "Complete handover only when the existing readiness checks allow it."]),
      ...job("payment", "Record or review an account payment", "Customer accounts", ["Find the customer and open the correct tenancy account.", "Review the balance and original payment evidence.", "Use the account's payment workflow, then check the saved result."]),
      ...job("transfer", "Transfer a tenant", "Transfer", ["Open the tenant's current account and occupancy.", "Choose Transfer and review the destination unit, date and amounts.", "Complete the existing transfer workflow and check the updated occupancy."]),
      ...job("moveout", "Move a tenant out", "Move out", ["Find the tenant account and review the agreed move-out date.", "Follow the Move out checks and review any account matters separately.", "Confirm the saved occupancy and unit status after completion."]),
    ] },
    { id: "cover", label: "Plan work and cover", description: "Follow-ups, arrivals and handovers", jobs: [
      ...job("followup", "Schedule a customer follow-up", "Customer follow-ups", ["Find the customer and agree the appointment date and time.", "Choose a title, responsible colleague and cover; save the agreed action.", "Reload to check the appointment. The named cover acknowledges their handover."]),
      ...job("arrivals", "Prepare arrivals and weekend cover", "Expected arrivals", ["Choose the store and arrival dates, including the weekend you need to cover.", "Review each booking's blockers, then assign responsibility, cover and instructions.", "The named cover reviews and acknowledges the current plan. Key handover still requires all move-in checks."]),
    ] },
    { id: "review", label: "Review today's work", description: "Tasks, outstanding checks and day-end", jobs: [
      ...(tasks ? [{ id: "tasks", label: "Work through assigned tasks", href: tasks.href, steps: ["Choose Assigned to me or the colleague and store you are covering.", "Apply the task filters and open the relevant task or appointment.", "Complete work at its source, then refresh the queue to check the result."] as [string, string, string] }] : []),
      ...job("payment-review", "Review payments awaiting confirmation", "Payments awaiting review", ["Open the pending payment and receipt-evidence queue.", "Review the original customer, account and recorded evidence.", "Resolve through the authorised payment workflow. A review entry does not establish bank settlement."]),
      ...job("events", "Read booking and move-in events", "Booking and move-in events", ["Open the store event inbox.", "Read the event and open its source booking or customer where needed.", "Mark the event read after review; do any required work in the source workflow."]),
      ...job("maintenance", "Review maintenance", "Service required", ["Review the maintenance queue for the store.", "Open the request and record the appropriate work status.", "Check the saved result and the unit's availability before booking it."]),
      ...job("stock", "Review stock and merchandise", "Merchandise", ["Review available stock and any reorder indicators.", "Open the product, order or stock workflow needed for the job.", "Check the saved stock or order result before moving to the next item."]),
      ...(tasks ? [{ id: "close", label: "Prepare day-end close", href: "/operations#operations-daily-close", steps: ["Review the day's account and operational records.", "Open End-of-day control and complete the checks for your store.", "If authorised to record a close, check the saved snapshot and any variance."] as [string, string, string] }] : []),
    ] },
  ].filter(group => group.jobs.length > 0);
}
