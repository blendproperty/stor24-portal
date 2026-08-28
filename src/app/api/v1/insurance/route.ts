import { authErrorResponse } from "@/lib/auth-guards";
import { createInsurancePlan, listInsuranceOperations, recordInsuranceDecision } from "@/lib/insurance-service";
import { requirePermissionScope } from "@/lib/scope";

export async function GET() {
  try {
    return Response.json({ data: await listInsuranceOperations(await requirePermissionScope("operations.view")) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { kind?: string; payload?: unknown };
    const scope = await requirePermissionScope("operations.manage");
    if (body.kind === "plan") return Response.json({ data: await createInsurancePlan(scope, body.payload) }, { status: 201 });
    if (body.kind === "decision") return Response.json({ data: await recordInsuranceDecision(scope, body.payload) });
    return Response.json({ error: { code: "UNKNOWN_INSURANCE_OPERATION", message: "The requested insurance operation is not supported." } }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      const messages: Record<string, string> = {
        INSURANCE_PLAN_EXISTS: "An insurance plan with this code already exists for that scope.",
        INSURANCE_TENANCY_NOT_FOUND: "The tenancy is not available in your permitted facilities.",
        INSURANCE_PLAN_NOT_AVAILABLE: "That plan is not available for this tenancy's facility.",
        INSURANCE_DECISION_NOT_FOUND: "There is no insurance decision to cancel for this tenancy.",
      };
      if (messages[error.message]) return Response.json({ error: { code: error.message, message: messages[error.message] } }, { status: 409 });
    }
    return authErrorResponse(error);
  }
}
