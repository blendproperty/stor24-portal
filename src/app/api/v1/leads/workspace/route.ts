import { leadsWorkspace } from "@/lib/leads-workspace-service";
import { requirePermissionScope } from "@/lib/scope";
import { requireSession } from "@/lib/auth-guards";
import { currentRoleAccess } from "@/lib/current-role-access";
import { apiError } from "@/lib/api";
export async function GET() {
  try {
    const scope = await requirePermissionScope("leads.view");
    const session = await requireSession();
    const data = await leadsWorkspace(scope);
    return Response.json({ data: { ...data, facilities: data.facilities.map(f => ({ ...f,
      canCreate: currentRoleAccess(session.user.roleAssignments, "leads.create", f.id).allowed,
      canManage: currentRoleAccess(session.user.roleAssignments, "leads.manage", f.id).allowed,
      canReserve: currentRoleAccess(session.user.roleAssignments, "reservations.manage", f.id).allowed,
    })) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
