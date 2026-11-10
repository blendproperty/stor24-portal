import { db } from "@/lib/db";
import { requireOwner, authErrorResponse } from "@/lib/auth-guards";
import { createResetToken, hashResetToken } from "@/lib/password-reset";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const actor = await requireOwner();
    const { id } = await context.params;
    if (id === actor.user.id) return Response.json({ error: { message: "Use account recovery to reset your own password." } }, { status: 409 });
    const token = createResetToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const result = await db.$transaction(async tx => {
      const target = await tx.user.findFirst({ where: { id, organisationId: actor.user.organisationId, active: true } });
      if (!target) return false;
      const changed = await tx.user.updateMany({ where: { id, organisationId: actor.user.organisationId, active: true, sessionVersion: target.sessionVersion }, data: { passwordHash: null, sessionVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("RESET_CONFLICT");
      await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({ data: { userId: id, organisationId: target.organisationId, tokenHash: hashResetToken(token), expiresAt } });
      await tx.auditEvent.create({ data: { organisationId: target.organisationId, actorId: actor.user.id, action: "user.temporary_password.created", entityType: "User", entityId: id } });
      return true;
    });
    if (!result) return Response.json({ error: { message: "Active user not found." } }, { status: 404 });
    return Response.json({ data: { temporaryPassword: token, expiresAt: expiresAt.toISOString() } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "RESET_CONFLICT") return Response.json({ error: { message: "The account changed. Please try again." } }, { status: 409 });
    return authErrorResponse(error);
  }
}
