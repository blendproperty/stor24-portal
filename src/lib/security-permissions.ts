export const securityPermissionGroups = [
  { label: "Customers and leasing", permissions: [
    ["leads.*", "Manage leads"], ["reservations.*", "Manage reservations"], ["move_in.create", "Process move-ins"], ["operations.view", "View tenant operations"],
  ] },
  { label: "Payments and adjustments", permissions: [
    ["mri.view", "Review MRI accounting preparation"], ["mri.manage", "Manage encrypted MRI connection settings"],
    ["settlements.view", "View merchant settlement statements"], ["settlements.import", "Import settlement and bank evidence"], ["settlements.manage", "Match and reopen settlement reviews"], ["settlements.approve", "Independently review settlements"], ["settlements.export", "Export settlement reviews"],
    ["adjustments.view", "View adjustment requests and records"], ["adjustments.request", "Request or withdraw adjustments"], ["adjustments.approve", "Independently approve adjustments"], ["adjustments.record_refund", "Record externally completed refunds"],
    ["billing.view", "View monthly billing and invoices"], ["billing.manage", "Post approved monthly billing"],
    ["debit_orders.view", "View debit-order runs"], ["debit_orders.manage", "Prepare and review debit-order runs"], ["debit_orders.submit", "Submit approved test debit-order runs"],
    ["ledger.*", "Manage tenant ledgers"], ["payments.*", "Take and reverse payments"], ["collections.*", "Manage collections"], ["collections.view", "View aged collections"], ["collections.manage", "Record collection follow-ups"], ["collections.policy", "Record approved collection terms"], ["collections.export", "Export aged collections"], ["access.view", "View physical access"], ["access.manage", "Enrol and revoke physical access"], ["access.suspend", "Suspend access"], ["access.restore", "Restore access"],
  ] },
  { label: "Store operations", permissions: [
    ["facility.*", "Manage store setup"], ["inventory.*", "Manage units and inventory"], ["daily_close.*", "Perform daily close"], ["facility_map.view", "View facility map"], ["phone.view", "Use phone workspace"],
  ] },
  { label: "Reports and communications", permissions: [
    ["reports.view", "View reports"], ["reports.financial", "View financial reports"], ["reports.sales", "View sales reports"], ["reports.collections", "View collections reports"], ["reports.export", "Export reports"], ["reports.schedule", "Schedule reports"], ["communications.view", "View communications"],
  ] },
  { label: "Administration", permissions: [
    ["configuration.view", "View company configuration"], ["configuration.manage", "Change company configuration"], ["users.view", "View employees"], ["users.manage", "Manage employees and access"], ["integrations.view", "View integrations"], ["integrations.manage", "Manage integrations"],
  ] },
] as const;

export const securityPermissionKeys = securityPermissionGroups.flatMap((group) => group.permissions.map(([key]) => key));
