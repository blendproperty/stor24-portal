import { sameOrigin } from "@/lib/request-security";
import { apiError } from "@/lib/api";
import { listBiometricAccess, revokeBiometricAccess } from "@/lib/biometric-access-service";
import { requirePermissionScope } from "@/lib/scope";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ data: await listBiometricAccess(await requirePermissionScope("access.view")) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    await requirePermissionScope("access.manage");
    return Response.json({ error: { code: "FACIAL_ACCESS_REQUIRES_REVIEWED_QUEUE", message: "Use the private customer photo queue. New enrolment is held until privacy and provider requirements are approved." } }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("access.manage");
    const { enrollmentId } = await request.json() as { enrollmentId?: string };
    if (!enrollmentId) return Response.json({ error: { code: "VALIDATION_ERROR", message: "An enrolment is required." } }, { status: 422 });
    return Response.json({ data: await revokeBiometricAccess(scope, enrollmentId) });
  } catch (error) { return apiError(error); }
}
