import { approveFacialSubmission, rejectFacialSubmission } from "@/lib/facial-access-service";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";

const errorStatus: Record<string, number> = {
  NOT_FOUND: 404,
  OCCUPANCY_NOT_ACTIVE: 409,
  PAYMENT_NOT_CLEARED: 409,
  REJECTION_REASON_REQUIRED: 422,
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const scope = await requirePermissionScope("access.manage");
  if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  try {
    if (body.action === "reject") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason) throw new Error("REJECTION_REASON_REQUIRED");
      const data = await rejectFacialSubmission(scope, id, reason);
      return Response.json({ data });
    }
    if (body.action === "approve") {
      const data = await approveFacialSubmission(scope, id);
      return Response.json({ data });
    }
    return Response.json({ error: { code: "ACTION_REQUIRED", message: "Specify action: approve or reject." } }, { status: 422 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return Response.json({ error: { code, message: "The facial-access submission could not be updated." } }, { status: errorStatus[code] ?? 400 });
  }
}
