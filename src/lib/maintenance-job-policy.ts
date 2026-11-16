export const MIDPOINT_STORE = "Store 1 - Midpoint";
export const MIDPOINT_MAINTENANCE_MANAGER = "carlo@blendproperty.co.za";

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
