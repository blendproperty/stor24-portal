export const MIDPOINT_STORE = "Store 1 - Midpoint";
export const MIDPOINT_MAINTENANCE_MANAGER = "carlo@blendproperty.co.za";
export const MIDPOINT_JOB_CARD_ROLE = "Midpoint job card manager";
export const MIDPOINT_JOB_CARD_PERMISSION = "maintenance.job_cards.manage";
export const MIDPOINT_JOB_CARD_PAGE = "/operations/job-cards";
export const MIDPOINT_JOB_CARD_API = "/api/v1/operations/job-cards";

export function validMidpointJobCardRole(
  email: string,
  permissions: string[],
  facility: { name: string; active: boolean } | null,
) {
  return email.toLowerCase() === MIDPOINT_MAINTENANCE_MANAGER &&
    permissions.length === 1 && permissions[0] === MIDPOINT_JOB_CARD_PERMISSION &&
    facility?.name === MIDPOINT_STORE && facility.active;
}

export function jobCardManagerRouteAllowed(path: string, method: string) {
  if (path === MIDPOINT_JOB_CARD_PAGE || path === "/settings") return method === "GET" || method === "HEAD";
  if (path === MIDPOINT_JOB_CARD_API) return method === "GET";
  if (/^\/api\/v1\/operations\/maintenance\/[^/]+$/.test(path)) return method === "PATCH";
  return ["/api/auth/mfa", "/api/auth/logout", "/api/auth/change-password"].includes(path);
}

export function midpointMaintenanceRole(email: string) {
  switch (email.toLowerCase()) {
    case "katlego@stor24.co.za": return "verifier";
    case MIDPOINT_MAINTENANCE_MANAGER: return "manager";
    default: return null;
  }
}

export function maintenanceJobActionAllowed(
  role: ReturnType<typeof midpointMaintenanceRole>,
  status: string,
  repairReported: boolean,
  action: "manage" | "report" | "verify" | "return" | "cancel",
) {
  if (status === "COMPLETED" || status === "CANCELLED") return false;
  if (action === "manage" || action === "report") return role === "manager" && !repairReported;
  return role === "verifier" && (action === "cancel" ? !repairReported : repairReported);
}
