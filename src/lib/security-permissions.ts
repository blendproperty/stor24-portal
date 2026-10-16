export const securityPermissionGroups = [
  { label: "Scheduled collection letters", permissions: [["collection_schedules.view", "View scoped schedules and exact run letters"], ["collection_schedules.manage", "Prepare or cancel collection schedules and runs"], ["collection_schedules.approve", "Independently review each collection run"]] },
  { label: "Staff event email review", permissions: [["staff_event_emails.view", "View scoped staff email policies and outbox"], ["staff_event_emails.manage", "Prepare or cancel staff event email policies"], ["staff_event_emails.approve", "Independently review staff event email policies"]] },
  { label: "Governed booking quotes", permissions: [["reservation_prices.view", "Read original booking quotes and amendment evidence"], ["reservation_prices.propose", "Propose or withdraw unsigned booking price changes"], ["reservation_prices.approve", "Independently approve booking quote proposals"]] },
  { label: "Customers and leasing", permissions: [
    ["customer_history.export", "Download a customer's contact history (scoped delegation)"],
    ["leads.*", "Manage leads"], ["reservations.*", "Manage reservations"], ["move_in.create", "Process move-ins"], ["operations.view", "View tenant operations"], ["operations.manage", "Edit customers and operational work"],
  ] },
  { label: "Accounting integration", permissions: [
    ["mri.view", "Review MRI accounting preparation"], ["mri.manage", "Manage encrypted MRI connection settings"],
  ] },
  { label: "Unidentified payment investigation", permissions: [["receipt_review.view", "View unidentified payment investigations"], ["receipt_review.capture", "Retain unidentified evidence without financial posting"], ["receipt_review.propose", "Suggest accounts or withdraw matching investigations"], ["receipt_review.approve", "Independently review matching suggestions without financial posting"]] },
  { label: "Settlement reviews", permissions: [
    ["settlements.view", "View merchant settlement statements"], ["settlements.import", "Import settlement and bank evidence"], ["settlements.manage", "Match and reopen settlement reviews"], ["settlements.approve", "Independently review settlements"], ["settlements.export", "Export settlement reviews"],
  ] },
  { label: "Adjustments and refunds", permissions: [
    ["adjustments.view", "View adjustment requests and records"], ["adjustments.request", "Request or withdraw adjustments"], ["adjustments.approve", "Independently approve adjustments"], ["adjustments.record_refund", "Record externally completed refunds"],
  ] },
  { label: "Billing and debit orders", permissions: [
    ["billing.view", "View monthly billing and invoices"], ["billing.manage", "Post approved monthly billing"], ["billing.documents.send", "Send reviewed customer documents and notices"],
    ["debit_orders.view", "View debit-order runs"], ["debit_orders.manage", "Prepare and review debit-order runs"], ["debit_orders.submit", "Submit approved test debit-order runs"],
  ] },
  { label: "Ledgers and collections", permissions: [
    ["ledger.view", "View tenant ledgers and statements"], ["ledger.*", "Manage tenant ledgers"], ["payments.view", "Review payment records and provider evidence"], ["payments.manage", "Record receipts and prepare payment requests"], ["payments.*", "Take and reverse payments"], ["collections.*", "Manage collections"], ["collections.view", "View aged collections"], ["collections.manage", "Record collection follow-ups"], ["collections.policy", "Record approved collection terms"], ["collections.export", "Export aged collections"],
  ] },
  { label: "Identity and physical access", permissions: [
    ["identity.review", "Privately review customer identity documents"], ["access.view", "View physical access"], ["access.manage", "Enrol and revoke physical access"], ["access.suspend", "Suspend access"], ["access.restore", "Restore access"],
  ] },
  { label: "Store operations", permissions: [
    ["facility.*", "Manage store setup"], ["inventory.view", "View units and inventory"], ["inventory.*", "Manage units and inventory"], ["daily_close.*", "Perform daily close"], ["facility_map.view", "View facility map"], ["phone.view", "Use phone workspace"],
  ] },
  { label: "Reports and communications", permissions: [
    ["reports.view", "View reports"], ["reports.financial", "View financial reports"], ["reports.sales", "View sales reports"], ["reports.collections", "View collections reports"], ["reports.export", "Export reports"], ["data.personal_export", "Export personal data (Super Admin authorisation)"], ["reports.schedule", "Schedule reports"], ["communications.view", "View communications"],
  ] },
  { label: "Administration", permissions: [
    ["configuration.view", "View company configuration"], ["configuration.manage", "Change company configuration"], ["users.view", "View employees"], ["users.manage", "Manage employees and access"], ["integrations.view", "View integrations"], ["integrations.manage", "Manage integrations"],
  ] },
] as const;

export const securityPermissionKeys = securityPermissionGroups.flatMap((group) => group.permissions.map(([key]) => key));
