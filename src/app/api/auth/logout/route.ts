import { clearSession } from "@/lib/session";
import { authErrorResponse, requireSession } from "@/lib/auth-guards";
import { clearMfaChallenge } from "@/lib/mfa-challenge";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    const actor = await requireSession({ allowMfaSetup: true });
    if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
    await db.$transaction(async tx => {
      // Revoke this generation on every device without revoking a newer racing sign-in.
      const revoked = await tx.user.updateMany({ where: { id: actor.user.id, organisationId: actor.user.organisationId, active: true, sessionVersion: actor.user.sessionVersion }, data: { sessionVersion: { increment: 1 } } });
      if (revoked.count === 1) await tx.auditEvent.create({ data: { organisationId: actor.user.organisationId, actorId: actor.user.id, action: "user.logout", entityType: "User", entityId: actor.user.id } });
    });
    await clearSession();
    await clearMfaChallenge();
    return Response.json({ data: { signedOut: true } });
  } catch (error) { return authErrorResponse(error); }
}
