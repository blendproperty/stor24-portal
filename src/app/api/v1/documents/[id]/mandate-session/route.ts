import { apiError } from "@/lib/api";
import { prepareStaffMandateSession } from "@/lib/debit-mandate-session";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("move_in.create");
    const data = await prepareStaffMandateSession(scope, (await params).id);
    return Response.json({ data }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof Error && ["MANDATE_BOOKING_UNAVAILABLE", "MANDATE_AGREEMENT_CHANGED"].includes(error.message)) return Response.json({ error: { message: "Review the signed lease, unit and monthly rent before preparing a bank mandate." } }, { status: 409, headers: { "cache-control": "private, no-store" } });
    return apiError(error);
  }
}
