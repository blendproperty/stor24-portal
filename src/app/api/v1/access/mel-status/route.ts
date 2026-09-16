import { apiError } from "@/lib/api";
import { listAccessDecisions, listIdentityLinks } from "@/lib/mel-integration-status-service";
import { requirePermissionScope } from "@/lib/scope";

// Read-only status endpoint for the Stage 6 MEL/HikCentral integration panel.
// There is deliberately no POST/PUT/DELETE here: nothing in this route can
// create, approve, or execute a MEL status change or access decision. See
// src/lib/integrations/mel-provider.ts (every method refuses; no contract is
// approved) and src/lib/access-decision-service.ts (not yet wired into any
// live caller) for why.
export const runtime = "nodejs";

export async function GET() {
  try {
    const scope = await requirePermissionScope("access.view");
    const [identityLinks, accessDecisions] = await Promise.all([
      listIdentityLinks(scope),
      listAccessDecisions(scope),
    ]);
    return Response.json({ data: { identityLinks, accessDecisions } });
  } catch (error) {
    return apiError(error);
  }
}
