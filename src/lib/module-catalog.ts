export type ModuleItem = {
  title: string;
  description: string;
  status?: "Ready" | "Configure" | "Planned";
  evidence?: string;
};

export type ModuleGroup = {
  title: string;
  description: string;
  items: ModuleItem[];
};

export const adjustmentsGroups: ModuleGroup[] = [
  {
    title: "Account corrections",
    description: "Controlled corrections that preserve the original financial trail.",
    items: [
      { title: "Ledger adjustments", description: "Post credits, charges, write-offs and reason-coded corrections.", status: "Ready", evidence: "Adjustments / Ledger Adjustments" },
      { title: "NSF payment reversal", description: "Reverse a returned payment and restart collections and access rules.", status: "Ready", evidence: "Adjustments / NSF Payment Reversal" },
      { title: "Moved-out accounts", description: "Find and resolve balances that remain after occupancy has ended.", status: "Ready", evidence: "Adjustments / Moved Out Accounts" },
      { title: "Refunds", description: "Review refundable balances and route approvals before payment.", status: "Ready", evidence: "Adjustments / Refunds" },
    ],
  },
  {
    title: "Inventory corrections",
    description: "Trace every stock change back to an operator and reason.",
    items: [
      { title: "Returns", description: "Return merchandise and create the linked financial reversal.", status: "Planned", evidence: "Stock movements exist; linked financial returns workflow remains in issue #55" },
      { title: "Stock adjustments", description: "Record damage, shrinkage, receipts and cycle-count corrections.", status: "Ready", evidence: "Adjustments / Returns and Inventory Adjustments" },
    ],
  },
];

export const companyGroups: ModuleGroup[] = [
  {
    title: "Facility and inventory",
    description: "Configure the physical estate, prices and sellable stock.",
    items: [
      { title: "Store information", description: "Address, locale, tax, trading hours and facility contacts.", status: "Configure" },
      { title: "Unit types and units", description: "Types, dimensions, floors, attributes, rates and walk-through order.", status: "Ready" },
      { title: "Price optimisation", description: "Push rates, tenant rate changes and effective-date approvals.", status: "Planned" },
      { title: "Merchandise", description: "Products, barcodes, tax, stock, order points and pricing.", status: "Ready" },
      { title: "Charges and discounts", description: "Fee defaults, discount plans, promotions and approval thresholds.", status: "Ready" },
    ],
  },
  {
    title: "People and control",
    description: "Administer staff, permissions and business defaults.",
    items: [
      { title: "Program defaults", description: "Proration, move-in/out, invoices, tenders, refunds, close, late fees and reservations.", status: "Configure" },
      { title: "Tenant defaults", description: "Required fields, address rules, notices and account defaults.", status: "Configure" },
      { title: "Security levels", description: "Facility-scoped roles covering operations, adjustments, company, reports and setup.", status: "Ready" },
      { title: "Employees", description: "Users, facility assignments, approval limits and activity history.", status: "Ready" },
      { title: "IP restrictions", description: "Conditional access rules for privileged administration.", status: "Planned" },
    ],
  },
  {
    title: "Finance and communications",
    description: "Connect billing, accounting, templates and lifecycle messaging.",
    items: [
      { title: "Banking and accounting", description: "Bank accounts, chart mappings and export batches.", status: "Configure" },
      { title: "Forms, printing and reports", description: "Versioned agreements, notices, receipts and batch jobs.", status: "Ready" },
      { title: "Email and SMS", description: "Provider settings, templates, delivery logs and opt-outs.", status: "Configure" },
      { title: "CRM campaign schedule", description: "Lifecycle campaigns, follow-ups and suppression rules.", status: "Ready" },
      { title: "Past-due schedule", description: "Stage-based fees, notices, tasks, access actions and escalation.", status: "Ready" },
    ],
  },
  {
    title: "Marketplace and integrations",
    description: "Vendor-neutral connectors based on the thirteen observed marketplace sections.",
    items: [
      { title: "Listings, websites and apps", description: "Availability feeds, online reservations and webhooks.", status: "Configure" },
      { title: "Cards and bank debit", description: "Tokenised payment gateways, mandates, retries and settlement.", status: "Configure" },
      { title: "Insurance and protection", description: "Plans, eligibility, pricing, documents and participation reporting.", status: "Configure" },
      { title: "Access control and locks", description: "Credentials, command outbox, provider state and reconciliation.", status: "Configure" },
      { title: "Call centres and phone", description: "Caller matching, call activity, lead and account shortcuts.", status: "Configure" },
      { title: "Notifications and texting", description: "Email, SMS, postal notices and delivery evidence.", status: "Configure" },
      { title: "Kiosks, analytics, auction and lien", description: "Specialist adapters with scoped permissions and auditable commands.", status: "Planned" },
    ],
  },
];

export const reportGroups: ModuleGroup[] = [
  {
    title: "Operations",
    description: "Daily facility and portfolio decisions.",
    items: [
      { title: "Occupancy and revenue", description: "Physical and economic occupancy, revenue and achieved rate.", status: "Ready" },
      { title: "Unit availability", description: "Current inventory, reservations, service state and forecast.", status: "Ready" },
      { title: "Move activity", description: "Move-ins, move-outs, transfers, notices and net rentals.", status: "Ready" },
      { title: "Lead conversion", description: "Source, stage velocity, loss reasons and conversion.", status: "Ready" },
    ],
  },
  {
    title: "Finance and control",
    description: "Governed, exportable financial views.",
    items: [
      { title: "Rent roll and tenant ledger", description: "Rates, balances, recurring methods and account activity.", status: "Ready" },
      { title: "Receivables ageing", description: "Balance by age, delinquency stage, facility and owner.", status: "Ready" },
      { title: "Payments and deposits", description: "Tender, refund, settlement and daily-close reconciliation.", status: "Ready" },
      { title: "Audit and exceptions", description: "Overrides, reversals, reopened periods and access exceptions.", status: "Ready" },
    ],
  },
  {
    title: "Products and integrations",
    description: "Secondary revenue and service performance.",
    items: [
      { title: "Merchandise", description: "Sales, margin, stock movement and reorder requirements.", status: "Planned", evidence: "Catalogue and stock views exist; complete retail reporting remains in issue #55" },
      { title: "Protection plans", description: "Coverage, participation, premium and exception analysis.", status: "Configure" },
      { title: "Autopay performance", description: "Success, decline reasons, retries and recovered revenue.", status: "Configure" },
      { title: "Integration health", description: "Provider uptime, command backlog, delivery and reconciliation.", status: "Ready" },
    ],
  },
];

export const workflowGroups: ModuleGroup[] = [
  {
    title: "Tenant lifecycle",
    description: "Transaction-safe workflows with linked ledger and access changes.",
    items: [
      { title: "Move in", description: "Customer, unit, price, protection, agreement, payment and access.", status: "Ready" },
      { title: "Payment", description: "Allocate card, bank, EFT or cash payments and issue a receipt.", status: "Ready" },
      { title: "Transfer", description: "Reserve a target, prorate, update documents and switch access atomically.", status: "Ready" },
      { title: "Move out", description: "Notice, final balance, refund, access revocation and unit turn.", status: "Ready" },
    ],
  },
  {
    title: "Front desk",
    description: "Common work initiated from the observed Operations panel.",
    items: [
      { title: "Tenant lookup", description: "Search people, accounts, units, contacts and balances.", status: "Ready" },
      { title: "Lead to lease", description: "Enquiry, quote, reservation, follow-up and conversion.", status: "Ready" },
      { title: "Merchandise purchase", description: "Barcode cart, discounts, tax, payment and stock posting.", status: "Planned", evidence: "Package booking is separate; full counter POS remains in issue #55" },
      { title: "Access", description: "Issue, suspend, restore and reconcile facility credentials.", status: "Configure" },
    ],
  },
  {
    title: "Billing and close",
    description: "Scheduled finance operations with exception handling.",
    items: [
      { title: "Invoices", description: "Generate and deliver invoices and statements by billing cycle.", status: "Ready" },
      { title: "Card and bank debit runs", description: "Submit tokenised recurring payments and manage failures.", status: "Configure" },
      { title: "Daily close", description: "Reconcile tenders and settlements before locking the period.", status: "Ready" },
      { title: "Receipt audit", description: "Trace receipts, reversals, refunds and operator actions.", status: "Ready" },
    ],
  },
];

