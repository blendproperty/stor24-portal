import { randomUUID } from "node:crypto";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { resendBlendSignInvitation } from "@/lib/blendsign-client";
import { retryBlendSignLease } from "@/lib/blendsign-lease-service";
import { db } from "@/lib/db";

export async function POST(_request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await context.params;
    if (action !== "retry-dispatch" && action !== "resend-invitation") return Response.json({ error: { code: "NOT_FOUND", message: "Document action not found." } }, { status: 404 });
    const auth = await requirePermission("operations.manage");
    const scope = { userId: auth.user.id, organisationId: auth.organisationId, facilityIds: auth.allowedFacilityIds ?? [], unrestrictedFacilities: auth.allowedFacilityIds === null };
    if (action === "retry-dispatch") {
      const envelope = await retryBlendSignLease(scope, id);
      return Response.json({ data: { envelopeId: envelope.envelopeId, idempotent: envelope.idempotent }, message: "BlendSign envelope dispatch retried." });
    }
    const document = await db.document.findFirst({ where: { id, provider: "BLENDSIGN", externalId: { not: null }, status: { in: ["SENT", "PARTIALLY_SIGNED"] }, tenancy: { facility: { organisationId: auth.organisationId }, ...(auth.allowedFacilityIds ? { facilityId: { in: auth.allowedFacilityIds } } : {}) } }, include: { tenancy: true } });
    if (!document?.externalId) return Response.json({ error: { code: "NOT_FOUND", message: "Active signing request not found." } }, { status: 404 });
    const requestId = `REM-${randomUUID().slice(0, 12).toUpperCase()}`;
    const upstream = await resendBlendSignInvitation(document.externalId, requestId);
    const payload = await upstream.json().catch(() => ({})) as { error?: string; recipients?: number; idempotent?: boolean };
    if (!upstream.ok) return Response.json({ error: { code: "BLENDSIGN_RESEND_FAILED", message: payload.error ?? "The signing invitation could not be resent." } }, { status: upstream.status === 409 ? 409 : 502 });
    await db.auditEvent.create({ data: { organisationId: auth.organisationId, facilityId: document.tenancy.facilityId, actorId: auth.user.id, action: "document.blendsign_invitation_resent", entityType: "Document", entityId: document.id, requestId, after: { envelopeId: document.externalId, recipients: payload.recipients ?? 0, idempotent: payload.idempotent ?? false } } });
    return Response.json({ data: { requestId, recipients: payload.recipients ?? 0 }, message: "Signing invitation queued again." });
  } catch (error) {
    if (error instanceof Error && (error.message === "NOT_FOUND" || error.message === "INVALID_PAYMENT_METHOD")) return Response.json({ error: { code: error.message, message: "This lease is not eligible for that retry action." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
