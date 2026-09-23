import { workflowGuides, pageHelp } from "./guided-help";
import { hasPermission } from "./permissions";
import type { GuideCatalogue } from "./guided-help-state";

export type GuideAssignment = { facilityId: string | null; role: { name: string; permissions: string[] } };
type Rule = { base: string; steps: string[]; organisation?: boolean };
const rule = (base: string, steps: string[], organisation = false): Rule => ({ base, steps, organisation });
// Each row corresponds to the authored step order. Blank means the base permission.
// Commas mean AND, pipes mean OR. @owner uses a current database assignment, never the JWT label.
// Missing guides/steps fail closed; the coverage test requires an explicit editorial decision.
export const guideAccessRules: Record<string, Rule> = {
  "move-in-training": rule("@owner|@manager", ["", "", ""]),
  orientation: rule("operations.view", ["", "", "leads.view,reservations.manage,ledger.view,collections.view", ""]),
  reservations: rule("reservations.manage", ["", "", "", "", "move_in.create"]),
  "move-in": rule("move_in.create", ["reservations.manage", "", "", "payments.manage", "", ""]),
  identity: rule("identity.review", ["", "", "", ""]),
  mri: rule("mri.view", ["", "mri.manage", "", "mri.manage"], true),
  settlements: rule("settlements.view", ["", "settlements.import", "settlements.import", "settlements.manage,settlements.approve,settlements.export"], true),
  "debit-orders": rule("debit_orders.view", ["", "debit_orders.manage", "debit_orders.manage", "debit_orders.submit"]),
  "monthly-billing": rule("billing.view", ["", "billing.manage", "billing.manage", "billing.manage"]),
  tenants: rule("operations.view", ["", "operations.manage", "operations.manage", "ledger.view", "reservations.manage,move_in.create,ledger.view"]),
  leads: rule("leads.view", ["leads.create,operations.manage", "", "reservations.manage", "reservations.manage,operations.manage"]),
  "unsigned-move-in": rule("move_in.create", ["reservations.manage", "", "", "integrations.view,operations.manage"]),
  accounts: rule("ledger.view", ["", "", "", "payments.manage,operations.manage,billing.documents.send"]),
  payments: rule("ledger.view,payments.manage", ["", "", "", ""]),
  transfer: rule("ledger.view,operations.manage", ["", "", "", "inventory.view,access.view"]),
  "move-out": rule("ledger.view,operations.manage", ["", "", "", "", "access.manage"]),
  statements: rule("ledger.view", ["", "", "", "billing.documents.send"]),
  billing: rule("billing.view", ["", "ledger.view,billing.manage,payments.view,daily_close.perform", "", "daily_close.perform,payments.view"]),
  collections: rule("collections.view", ["", "", "collections.manage", "collections.manage"]),
  adjustments: rule("adjustments.view", ["adjustments.request", "adjustments.request", "adjustments.approve", "adjustments.record_refund"]),
  "netcash-operations": rule("payments.view", ["", "", "", "integrations.manage"]),
  operations: rule("operations.view", ["move_in.create,ledger.view,operations.manage", "operations.manage", "operations.manage", "operations.manage", "operations.manage,daily_close.perform"]),
  units: rule("inventory.view", ["", "inventory.manage", "inventory.manage", "inventory.manage", "operations.manage", "inventory.manage", "@owner"]),
  map: rule("facility_map.view", ["", "", "inventory.manage", "inventory.manage", "inventory.manage"]),
  merchandise: rule("operations.view", ["", "inventory.manage", "inventory.manage", "inventory.manage"]),
  packages: rule("operations.view,inventory.manage", ["", "", "", ""]),
  fulfilment: rule("operations.view,inventory.manage", ["", "", "", ""]),
  insurance: rule("operations.view", ["", "operations.manage", "operations.manage", ""]),
  access: rule("access.view", ["", "access.manage", "move_in.create", "integrations.manage"]),
  calendar: rule("operations.view", ["", "", "operations.manage"]),
  prorate: rule("move_in.create|operations.manage|billing.view", ["", "", ""]),
  reports: rule("reports.view|reports.financial|reports.sales|reports.collections", ["", "reports.export", "reports.export", "ledger.view"]),
  graphs: rule("reports.view", ["", "", "ledger.view,payments.view", "inventory.view"]),
  audit: rule("audit.view", ["", "", "ledger.view,integrations.manage", ""]),
  company: rule("configuration.view,configuration.manage", ["inventory.manage", "", "", "", ""]),
  "tenant-defaults": rule("configuration.view,configuration.manage", ["", "", "", ""]),
  "program-defaults": rule("configuration.view,configuration.manage", Array(20).fill("")),
  // The employee/invitation register itself currently requires owner access.
  users: rule("users.view,@owner", ["", "", "", "users.manage,audit.view", ""]),
  settings: rule("configuration.view,configuration.manage,users.view,users.manage,integrations.view,integrations.manage", ["", "", "", "", ""]),
  communications: rule("operations.view,communications.view", ["", "@owner", "", "operations.manage", "@owner"]),
  integrations: rule("operations.view,integrations.view", ["", "", "operations.manage", "", "integrations.manage,@owner"]),
  hikvision: rule("integrations.view,integrations.manage", ["", "", "", ""], true),
  "netcash-settings": rule("integrations.view,integrations.manage", ["", "", "", ""], true),
  phone: rule("phone.view", ["", "operations.view,leads.view,reservations.manage,ledger.view", "operations.manage"]),
  "offline-readiness": rule("operations.manage", ["", "operations.view", "operations.view", "operations.view,leads.create,reservations.manage"]),
  offline: rule("operations.view", ["", "", "leads.create", "leads.create,reservations.manage", "leads.create,reservations.manage", "leads.create,reservations.manage", "", ""]),
};

function permitted(assignments: GuideAssignment[], requirement: string, organisation = false) {
  const scopes = organisation ? [null] : [null, ...new Set(assignments.flatMap(a => a.facilityId ? [a.facilityId] : []))];
  return scopes.some(facility => {
    const relevant = assignments.filter(a => a.facilityId === null || (facility !== null && a.facilityId === facility));
    const grants = relevant.flatMap(a => a.role.permissions);
    return requirement.split(",").filter(Boolean).every(all => all.split("|").some(permission =>
      permission === "@owner" ? relevant.some(a => a.facilityId === null && a.role.name === "Organisation owner" && hasPermission(a.role.permissions, "*")) : permission === "@manager" ? relevant.some(a => a.role.name === "Facility manager") : hasPermission(grants, permission)));
  });
}

export function catalogueForAssignments(assignments: GuideAssignment[]): GuideCatalogue {
  const guides = workflowGuides.flatMap(guide => {
    const policy = guideAccessRules[guide.id];
    if (!policy || !assignments.length) return [];
    const steps = guide.steps.filter((_, index) => typeof policy.steps[index] === "string" && permitted(assignments, [policy.base, policy.steps[index]].filter(Boolean).join(","), policy.organisation));
    if (!steps.length) return [];
    return [{ ...guide, steps, ...(steps.length < guide.steps.length ? {
      title: `${guide.steps[0].screen}: your available tasks`,
      description: "Guidance for the tasks available to your account. Your store permissions still apply.",
      duration: `${Math.max(1, Math.ceil(steps.length * .7))} min`,
    } : {}) }];
  });
  const pages = pageHelp.flatMap(page => {
    const guide = guides.find(g => g.id === page.guideId);
    return guide ? [{ ...page, body: guide.steps.length === workflowGuides.find(g => g.id === guide.id)?.steps.length ? page.body : guide.description }] : [];
  });
  return { guides, pages };
}
