import { z } from "zod";
import { historicalReportDatasets } from "./historical-report-datasets";

export type ReportField = { key: string; label: string; type: "text" | "number" | "money" | "date" | "boolean"; personal?: boolean };
export type ReportDataset = { key: string; name: string; group: string; permission: string; extraPermission?: string; importOnly?: boolean; requiredFields?: string[]; basis: string; grain: string; fields: ReportField[] };
const text = (key: string, label: string, personal = false): ReportField => ({ key, label, type: "text", ...(personal ? { personal } : {}) });
const money = (key: string, label: string): ReportField => ({ key, label, type: "money" });
const number = (key: string, label: string): ReportField => ({ key, label, type: "number" });
const date = (key: string, label: string): ReportField => ({ key, label, type: "date" });
const bool = (key: string, label: string): ReportField => ({ key, label, type: "boolean" });
const facility = text("facility", "Store");
const account = text("account", "Account", true);
const customer = text("customer", "Customer", true);
export const visualReportDatasets: ReportDataset[] = [
  { key: "tenants", name: "Tenants & leases", group: "Tenants", permission: "reports.financial", basis: "Current lease and balance records, including closed leases. Dates filter lease start, not a historical balance.", grain: "One lease/account; balances are counted once. Units are listed together.", fields: [facility, account, customer, text("email", "Email", true), text("phone", "Phone", true), text("status", "Lease status"), text("units", "Units"), text("product", "Product"), text("paymentMethod", "Payment method"), money("monthlyRate", "Current contracted monthly rent"), money("balance", "Current account balance"), text("currency", "Currency"), date("start", "Lease start"), date("end", "Lease end"), date("notice", "Notice given"), number("unitCount", "Current occupied units")] },
  { key: "units", name: "Units & prices", group: "Units", permission: "reports.view", basis: "Current inventory snapshot. Closed floors and combined child units are excluded from bookable availability.", grain: "One unit; no tenant financial details.", fields: [facility, text("unit", "Unit"), text("floor", "Floor"), text("type", "Unit type"), text("status", "Recorded status"), text("effectiveStatus", "Operational status"), text("products", "Products"), money("monthlyRate", "Listed monthly rent"), number("area", "Area (m²)"), bool("operational", "Floor operational")] },
  { key: "occupancies", name: "Rental & move history", group: "Units", permission: "reports.financial", basis: "Recorded occupancy intervals. Date selection is for starts or ends in the period; notice and scheduled-end filters can be applied separately. Transfer pairing is not inferred.", grain: "One occupancy interval. Do not sum account balances across units.", fields: [facility, account, customer, text("unit", "Unit"), text("status", "Occupancy status"), date("start", "Move-in"), date("end", "Recorded move-out / scheduled end"), date("notice", "Lease notice date"), money("monthlyRate", "Recorded occupancy rent"), text("accessState", "Recorded access state")] },
  { key: "ledger", name: "Ledger transactions", group: "Finance", permission: "reports.financial", basis: "Posted ledger entries by effective date, with positive amount magnitudes and reversal references. Not a general ledger, recognised income or bank settlement.", grain: "One entry; amount totals are magnitudes by type, not a net balance.", fields: [facility, account, customer, text("entry", "Entry reference"), text("type", "Entry type"), date("date", "Effective date"), money("amount", "Amount magnitude"), money("tax", "Recorded tax"), text("currency", "Currency"), text("description", "Description"), text("reversalOf", "Reverses entry")] },
  { key: "payments", name: "Payments & receipts", group: "Finance", permission: "reports.financial", basis: "Production payment records only; test/sandbox/simulator records are excluded. Receipt templates require a succeeded payment; creation and processed dates are separate.", grain: "One payment; payment records are not proof of bank settlement.", fields: [facility, account, customer, text("payment", "Payment reference"), text("status", "Payment status"), text("method", "Method"), text("provider", "Provider"), money("amount", "Payment amount"), text("currency", "Currency"), date("date", "Created date"), date("processed", "Processed date"), text("failure", "Failure code")] },
  { key: "leads", name: "Leads & enquiries", group: "Marketing", permission: "reports.sales", basis: "Enquiries created in the selected period with their current stages. Not historical stage transitions.", grain: "One enquiry.", fields: [facility, customer, text("source", "Recorded source"), text("stage", "Current stage"), text("product", "Product"), text("assignedTo", "Assigned to", true), date("date", "Enquiry created"), date("expectedMoveIn", "Expected move-in"), date("nextAction", "Next action")] },
  { key: "insurance", name: "Insurance & waivers", group: "Insurance", permission: "reports.view", extraPermission: "operations.view", basis: "Recorded insurance decisions and premium snapshots; not insurer remittance, historical cover reconstruction or settlement.", grain: "One enrollment/waiver per lease.", fields: [facility, account, customer, text("status", "Decision status"), text("plan", "Plan"), text("provider", "Provider"), money("coverage", "Cover amount"), money("premium", "Monthly premium"), money("excess", "Excess"), date("date", "Acknowledged"), date("start", "Effective from"), date("end", "Ended"), text("waiver", "Waiver reason")] },
  { key: "products", name: "Merchandise stock", group: "Merchandise", permission: "reports.view", extraPermission: "operations.view", basis: "Current stock and selling prices; not sales or stock valuation accounting.", grain: "One product per store.", fields: [facility, text("sku", "SKU"), text("product", "Product"), text("category", "Category"), number("onHand", "On hand"), number("reserved", "Reserved"), number("available", "Available"), number("reorderPoint", "Reorder point"), money("sellingPrice", "Selling price"), bool("active", "Active")] },
  { key: "stock", name: "Stock movements", group: "Merchandise", permission: "reports.view", extraPermission: "operations.view", basis: "Recorded stock movements by creation date; not payment receipts.", grain: "One stock movement.", fields: [facility, text("sku", "SKU"), text("product", "Product"), text("type", "Movement type"), number("quantity", "Quantity"), money("unitCost", "Recorded unit cost"), date("date", "Recorded"), text("reason", "Reason")] },
  { key: "sales", name: "Merchandise orders", group: "Merchandise", permission: "reports.financial", extraPermission: "operations.view", basis: "Non-test merchandise orders. Payment and fulfilment status are separate; order totals are counted once.", grain: "One order, with item descriptions combined.", fields: [facility, account, customer, text("order", "Order reference"), text("status", "Order status"), text("paymentStatus", "Payment status"), money("total", "Order total"), text("currency", "Currency"), text("items", "Items"), number("quantity", "Item quantity"), date("date", "Ordered"), date("fulfilled", "Fulfilled")] },
  { key: "closes", name: "Daily cash controls", group: "Deposits", permission: "reports.financial", extraPermission: "daily_close.view", basis: "Recorded daily closes and cash variance. This is not a bank deposit or accrual allocation report.", grain: "One store/business date.", fields: [facility, date("date", "Business date"), text("status", "Close status"), money("expected", "Expected cash"), money("counted", "Counted cash"), money("variance", "Cash variance"), date("closed", "Closed at")] },
  { key: "notes", name: "Unit notes", group: "Units", permission: "reports.view", extraPermission: "operations.view", basis: "Recorded unit notes by creation date. Free text remains subject to export data protection.", grain: "One note.", fields: [facility, text("unit", "Unit"), text("author", "Author", true), text("note", "Note"), bool("pinned", "Pinned"), date("date", "Recorded")] },
  { key: "maintenance", name: "Site maintenance", group: "Management", permission: "reports.view", extraPermission: "operations.view", basis: "Recorded maintenance requests; not an unrecorded site-inspection checklist.", grain: "One maintenance request.", fields: [facility, text("unit", "Unit"), text("title", "Request"), text("status", "Status"), text("priority", "Priority"), text("assignedTo", "Assigned to", true), date("date", "Created"), date("due", "Due"), date("completed", "Completed")] },
  { key: "communications", name: "Communication activity", group: "Tenants", permission: "reports.view", extraPermission: "communications.view", basis: "Recorded communication metadata only; message bodies, recipients and provider identifiers are excluded.", grain: "One communication log.", fields: [facility, customer, text("channel", "Channel"), text("direction", "Direction"), text("type", "Message type"), text("status", "Delivery status"), date("date", "Queued"), date("sent", "Sent"), date("delivered", "Delivered"), text("failure", "Failure code")] },
  { key: "access", name: "Access decisions", group: "Management", permission: "reports.view", extraPermission: "access.view", basis: "Requested and confirmed access-control decisions. These are not gate passage events.", grain: "One access decision.", fields: [facility, text("unit", "Unit"), text("action", "Action"), text("source", "Source"), text("state", "State"), text("reason", "Reason"), date("date", "Requested"), date("confirmed", "Confirmed"), number("attempts", "Attempts"), text("failure", "Failure code")] },
  { key: "audit", name: "Staff activity", group: "Management", permission: "reports.view", extraPermission: "users.view", basis: "Recorded audit metadata; excludes event payloads, security credentials and org-wide events for facility-scoped users.", grain: "One audit event.", fields: [facility, text("actor", "Employee", true), text("action", "Action"), text("entityType", "Record type"), date("date", "Occurred")] },
  { key: "adjustments", name: "Credits, refunds & write-offs", group: "Finance", permission: "reports.financial", extraPermission: "adjustments.view", basis: "Recorded adjustment requests and their approvals/postings. A request is not a paid refund; payout date/reference must be recorded.", grain: "One adjustment.", fields: [facility, account, customer, text("kind", "Adjustment kind"), text("status", "Status"), money("amount", "Amount"), money("tax", "Tax"), text("currency", "Currency"), text("reason", "Reason"), date("date", "Requested"), date("posted", "Posted"), date("payout", "Recorded payout date")] },
  { key: "marketing", name: "Marketing activity & spend", group: "Marketing", permission: "reports.sales", extraPermission: "leads.view", basis: "Recorded campaign activity, spend, clicks and impressions; not verified ad-platform billing or bank settlement.", grain: "One campaign activity; campaign lifetime budgets are excluded to prevent duplication.", fields: [facility, text("campaign", "Campaign"), text("source", "Source"), text("medium", "Medium"), text("kind", "Activity type"), text("title", "Activity"), date("date", "Occurred"), money("spend", "Recorded spend"), number("clicks", "Clicks"), number("impressions", "Impressions")] },
];

visualReportDatasets.push(...historicalReportDatasets);

// All monetary datasets expose their currency so totals cannot combine unlike amounts.
for (const dataset of visualReportDatasets) {
  if (dataset.fields.some(f=>f.type==="money") && !dataset.fields.some(f=>f.key==="currency")) dataset.fields.push(text("currency","Currency"));
  for (const field of dataset.fields) if (["description","reason","note","waiver"].includes(field.key)) field.personal=true;
}

export const filterOperators = ["eq", "ne", "contains", "gt", "gte", "lt", "lte", "isEmpty", "isNotEmpty"] as const;
export type FilterOperator = typeof filterOperators[number];
export const visualReportSchema = z.object({
  version: z.literal(1), name: z.string().trim().min(1).max(100), dataset: z.string().min(1).max(40),
  columns: z.array(z.string().min(1).max(50)).min(1).max(25),
  filters: z.array(z.object({ field: z.string().min(1).max(50), operator: z.enum(filterOperators), value: z.union([z.string().max(300), z.number().finite(), z.boolean()]).optional() }).strict()).max(20).default([]),
  groupBy: z.array(z.string().max(50)).max(3).default([]),
  metrics: z.array(z.object({ field: z.string().max(50), operation: z.enum(["count", "sum", "average", "min", "max"]) }).strict()).max(8).default([]),
  sort: z.object({ field: z.string().max(80), direction: z.enum(["asc", "desc"]) }).strict().optional(),
  facilityId: z.string().min(1).max(100).optional(), from: z.iso.date(), to: z.iso.date(),
  dateField: z.string().max(50).optional(),
  historyImportId: z.string().min(1).max(100).optional(),
  intervalMode: z.enum(["overlap","whole-period"]).optional(),
}).strict().superRefine((query, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const dataset = visualReportDatasets.find(d => d.key === query.dataset);
  if (!dataset) { fail("Choose an available dataset."); return; }
  const fields = new Map(dataset.fields.map(f => [f.key, f]));
  if (query.from > query.to) fail("From must be on or before To.");
  if (new Date(query.to).getTime() - new Date(query.from).getTime() > 366 * 86400000) fail("Choose at most 366 days.");
  if (new Set(query.columns).size !== query.columns.length || new Set(query.groupBy).size !== query.groupBy.length) fail("Choose each field once.");
  if ([...query.columns, ...query.groupBy].some(key => !fields.has(key))) fail("An unrecognised field was selected.");
  if (query.dateField && fields.get(query.dateField)?.type !== "date") fail("Choose a date field for the reporting period.");
  if(query.intervalMode && (query.dataset!=="occupancies" || query.dateField)) fail("Occupancy interval selection requires the Rental & move history dataset without a separate date basis.");
  for (const filter of query.filters) {
    const field = fields.get(filter.field);
    if (!field) { fail("An unrecognised filter was selected."); continue; }
    if (["isEmpty", "isNotEmpty"].includes(filter.operator)) continue;
    if (filter.value === undefined || filter.value === "") { fail("Enter a filter value."); continue; }
    if (field.type === "boolean" && (typeof filter.value !== "boolean" || !["eq", "ne"].includes(filter.operator))) fail("Use Yes/No for this filter.");
    if (field.type === "number" && (typeof filter.value !== "number" || filter.operator === "contains")) fail("Use a numeric filter.");
    if (field.type === "money" && (filter.operator === "contains" || !/^-?\d{1,14}(?:\.\d{1,2})?$/.test(String(filter.value)) || typeof filter.value === "number" && Math.abs(filter.value)>Number.MAX_SAFE_INTEGER/100)) fail("Use a decimal amount with at most two fractional digits.");
    if (field.type === "date" && (typeof filter.value !== "string" || !z.iso.date().safeParse(filter.value).success || filter.operator === "contains")) fail("Use a valid date filter.");
    if (field.type === "text" && (typeof filter.value !== "string" || !["eq", "ne", "contains"].includes(filter.operator))) fail("Use a text filter.");
  }
  const metricKeys = query.metrics.map(m => `${m.operation}_${m.field}`);
  if (new Set(metricKeys).size !== metricKeys.length) fail("Choose each total once.");
  for (const metric of query.metrics) if ((metric.operation === "count" && metric.field !== "*") || (metric.operation !== "count" && !["number", "money"].includes(fields.get(metric.field)?.type ?? ""))) fail("Totals require a compatible numeric field; count uses records.");
  if (query.groupBy.length && !query.metrics.length) fail("Choose a total when grouping.");
  const outputFields = query.metrics.length ? [...query.groupBy, ...metricKeys] : query.columns;
  if (query.sort && !outputFields.includes(query.sort.field)) fail("Sort by a field in the result.");
  // A money total without currency grouping can silently combine currencies.
  if (query.metrics.some(m => fields.get(m.field)?.type === "money") && fields.has("currency") && !query.groupBy.includes("currency")) fail("Include Currency in grouping before totaling money.");
});
export type VisualReportQuery = z.infer<typeof visualReportSchema>;
export type VisualReportRow = Record<string, string | number | boolean | null>;
export function reportFieldLabel(dataset: ReportDataset, key: string) {
  if (key === "count_*") return "Record count";
  const metric = /^(sum|average|min|max)_(.+)$/.exec(key);
  if (metric) return `${({ sum: "Total", average: "Average", min: "Minimum", max: "Maximum" } as Record<string,string>)[metric[1]]} ${dataset.fields.find(f=>f.key===metric[2])?.label ?? metric[2]}`;
  return dataset.fields.find(f => f.key === key)?.label ?? key;
}
