import { db } from "@/lib/db";
import { authErrorResponse, requireOwner } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireOwner();
    if (!sameOrigin(request)) {
      return Response.json({ error: { code: "ORIGIN_REJECTED", message: "The request origin is not allowed." } }, { status: 403 });
    }
    const { id } = await context.params;
    const invitation = await db.userInvitation.findFirst({ where: { id, organisationId: actor.user.organisationId } });
    if (!invitation || invitation.status !== "PENDING") {
      return Response.json({ error: { code: "NOT_PENDING", message: "Only pending invitations can be revoked." } }, { status: 409 });
    }
    await db.$transaction([
      db.userInvitation.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } }),
      db.auditEvent.create({
        data: {
          organisationId: invitation.organisationId,
          actorId: actor.user.id,
          action: "user.invitation.revoked",
          entityType: "UserInvitation",
          entityId: id,
        },
      }),
    ]);
    return Response.json({ data: { id, status: "REVOKED" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
