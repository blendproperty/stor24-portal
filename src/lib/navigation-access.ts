import { hasPermission } from "./permissions";

export type NavigationAccess = { owner: boolean; permissions: string[] };
// Navigation hints only. Existing page/API and facility-scope checks remain authoritative.
const rules: Record<string, string[]> = {
  "/tenants": ["operations.view"], "/users": ["@owner"],
  "/leads": ["leads.view"], "/reservations": ["reservations.manage"],
  "/identity": ["identity.review"], "/units": ["inventory.view"],
  "/billing": ["billing.view"], "/billing/monthly": ["billing.view"],
  "/billing/netcash": ["payments.view"], "/billing/mri": ["mri.view"],
  "/billing/settlements": ["settlements.view"],
  "/billing/debit-orders": ["debit_orders.view"],
  "/collections": ["collections.view"], "/access": ["access.view"],
  "/operations": ["operations.view"], "/operations/move-in": ["move_in.create"],
  "/operations/accounts": ["ledger.view"],
  "/insurance": ["operations.view"], "/adjustments": ["adjustments.view"],
  "/company": ["configuration.view"],
  "/reports": ["reports.view", "reports.financial", "reports.sales", "reports.collections"],
  "/graphs": ["reports.view"], "/communications": ["operations.view"],
  "/integrations": ["operations.view"], "/calendar": ["operations.view"],
  "/map": ["facility_map.view"], "/phone": ["phone.view"],
  "/audit": ["audit.view"], "/offline-readiness": ["operations.manage"],
  "/settings/integrations": ["integrations.view"],
};
export function canVisit(path: string, access: NavigationAccess) {
  // Training has its own current-role/controller checks; personal Settings remain available.
  if (path === "/operations/move-in/training") return true;
  const route = Object.keys(rules).sort((a, b) => b.length - a.length)
    .find(key => path === key || path.startsWith(`${key}/`));
  return !route || access.owner || rules[route].some(permission => hasPermission(access.permissions, permission));
}
export const restrictedMessage = "If you require access, please contact your administrator.";
