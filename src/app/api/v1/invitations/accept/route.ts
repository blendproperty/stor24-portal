import { db } from "@/lib/db";
import { hashInvitationToken } from "@/lib/invitation-service";
import { acceptInvitationSchema } from "@/lib/validators";
import { hash } from "bcryptjs";
import { setSession } from "@/lib/session";

export async function POST(request: Request) {
  const parsed = acceptInvitationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID_TOKEN", message: "The invitation link is invalid." } }, { status: 422 });
  }

  const invitation = await db.userInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(parsed.data.token) },
  });

  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
    return Response.json({ error: { code: "INVITATION_UNAVAILABLE", message: "This invitation is invalid, expired or already used." } }, { status: 410 });
  }

  const role = await db.role.findUnique({
    where: { organisationId_name: { organisationId: invitation.organisationId, name: invitation.roleName } },
  });
  const facility = invitation.facilityCode
    ? await db.facility.findUnique({
        where: { organisationId_code: { organisationId: invitation.organisationId, code: invitation.facilityCode } },
      })
    : null;

  if (!role) {
    return Response.json({ error: { code: "ROLE_UNAVAILABLE", message: "The assigned role is no longer available." } }, { status: 409 });
  }
  if (invitation.roleName === "Facility manager" && !facility) return Response.json({ error: { code: "FACILITY_REQUIRED", message: "This invitation needs a valid facility. Ask an administrator for a new invitation." } }, { status: 409 });

  try {
    const passwordHash = await hash(parsed.data.password, 12);
    const user = await db.$transaction(async (tx) => {
      const claimed = await tx.userInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING", expiresAt: { gte: new Date() } },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("INVITATION_ALREADY_CLAIMED");

      const createdUser = await tx.user.create({
        data: {
          organisationId: invitation.organisationId,
          email: invitation.email,
          name: invitation.name,
          passwordHash,
        },
      });
      await tx.roleAssignment.create({
        data: { userId: createdUser.id, roleId: role.id, facilityId: facility?.id },
      });
      await tx.auditEvent.create({
        data: {
          organisationId: invitation.organisationId,
          actorId: createdUser.id,
          action: "user.invitation.accepted",
          entityType: "User",
          entityId: createdUser.id,
          after: { email: createdUser.email, roleName: invitation.roleName, facilityCode: invitation.facilityCode },
        },
      });
      return createdUser;
    });

    await setSession({ userId: user.id, name: user.name, email: user.email, role: role.name, sessionVersion: user.sessionVersion });
    return Response.json({ data: { id: user.id, name: user.name, email: user.email, status: "ACTIVE" } });
  } catch {
    return Response.json({ error: { code: "ACCEPTANCE_FAILED", message: "The invitation could not be accepted." } }, { status: 409 });
  }
}
