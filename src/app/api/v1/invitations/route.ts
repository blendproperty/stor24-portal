import { addDays } from "date-fns";
import { db } from "@/lib/db";
import {
  createInvitationToken,
  expireOldInvitations,
  hashInvitationToken,
} from "@/lib/invitation-service";
import { createInvitationSchema } from "@/lib/validators";
import { requireOwner } from "@/lib/auth-guards";
import { emailProvider, escapeEmailHtml } from "@/lib/email";

export const dynamic = "force-dynamic";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowedOrigins = new Set([new URL(request.url).origin, process.env.APP_URL].filter(Boolean));
  return allowedOrigins.has(origin);
}

export async function GET() {
  await requireOwner();
  const organisation = await db.organisation.findUniqueOrThrow({ where: { id: (await requireOwner()).user.organisationId } });
  await expireOldInvitations();

  const [invitations, users, roles, facilities] = await Promise.all([
    db.userInvitation.findMany({
      where: { organisationId: organisation.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.user.findMany({
      where: { organisationId: organisation.id },
      include: { roleAssignments: { include: { role: true, facility: true } }, mfaCredential: { select: { enabledAt: true } } },
      orderBy: { name: "asc" },
      take: 100,
    }),
    db.role.findMany({ where: { organisationId: organisation.id, NOT: { name: { startsWith: "Custom access · " } } }, select: { name: true, permissions: true }, orderBy: { name: "asc" } }),
    db.facility.findMany({ where: { organisationId: organisation.id, active: true }, select: { name: true, code: true }, orderBy: { name: "asc" } }),
  ]);

  return Response.json({
    data: invitations.map((invitation) => ({
      id: invitation.id,
      name: invitation.name,
      email: invitation.email,
      roleName: invitation.roleName,
      facilityCode: invitation.facilityCode,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    })),
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      role: user.roleAssignments[0]?.role.name ?? "Unassigned",
      scope: user.roleAssignments[0]?.facility?.name ?? "All facilities",
      permissions: user.roleAssignments[0]?.role.permissions ?? [],
      mfaEnabled: Boolean(user.mfaCredential?.enabledAt),
    })),
    roles,
    facilities,
  });
}

export async function POST(request: Request) {
  const actor = await requireOwner();
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "ORIGIN_REJECTED", message: "The request origin is not allowed." } }, { status: 403 });
  }

  const parsed = createInvitationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Check the invitation details.", fields: parsed.error.flatten().fieldErrors } },
      { status: 422 },
    );
  }

  const organisation = await db.organisation.findUniqueOrThrow({ where: { id: actor.user.organisationId } });
  await expireOldInvitations();

  const [existingUser, existingInvitation] = await Promise.all([
    db.user.findUnique({ where: { organisationId_email: { organisationId: organisation.id, email: parsed.data.email } } }),
    db.userInvitation.findFirst({
      where: { organisationId: organisation.id, email: parsed.data.email, status: "PENDING" },
    }),
  ]);

  if (existingUser) {
    return Response.json({ error: { code: "USER_EXISTS", message: "This email already belongs to an active user." } }, { status: 409 });
  }
  if (existingInvitation) {
    return Response.json({ error: { code: "INVITATION_EXISTS", message: "A pending invitation already exists for this email." } }, { status: 409 });
  }

  const token = createInvitationToken();
  const invitation = await db.userInvitation.create({
    data: {
      organisationId: organisation.id,
      ...parsed.data,
      facilityCode: parsed.data.facilityCode || null,
      tokenHash: hashInvitationToken(token),
      expiresAt: addDays(new Date(), 7),
      invitedByName: actor.name,
    },
  });

  await db.auditEvent.create({
    data: {
      organisationId: organisation.id,
      action: "user.invitation.created",
      entityType: "UserInvitation",
      entityId: invitation.id,
      actorId: actor.user.id,
      after: { email: invitation.email, roleName: invitation.roleName, facilityCode: invitation.facilityCode },
    },
  });

  const appUrl = process.env.APP_URL || new URL(request.url).origin;
  const inviteUrl = `${appUrl}/invite/${token}`;
  try {
    await emailProvider().send({ to: invitation.email, subject: "You are invited to Stor24 CRM", text: `Accept your invitation: ${inviteUrl}`, html: `<p>${escapeEmailHtml(invitation.invitedByName)} invited you to Stor24 CRM.</p><p><a href="${inviteUrl}">Accept invitation</a></p>` });
  } catch {
    await db.userInvitation.update({ where: { id: invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    return Response.json({ error: { code: "DELIVERY_FAILED", message: "The invitation email could not be delivered. Check the email provider configuration and retry." } }, { status: 503 });
  }
  return Response.json(
    {
      data: {
        id: invitation.id,
        status: invitation.status,
        expiresAt: invitation.expiresAt.toISOString(),
        delivery: "SENT",
      },
    },
    { status: 201 },
  );
}
