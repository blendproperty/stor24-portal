import { compare, hash } from "bcryptjs";
import { db } from "@/lib/db";
import { clearSession } from "@/lib/session";
import { requireSession } from "@/lib/auth-guards";
import { changePasswordSchema } from "@/lib/validators";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  const auth = await requireSession();
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const parsed = changePasswordSchema.safeParse(await request.json());
  if (!parsed.success || !auth.user.passwordHash || !(await compare(parsed.data.currentPassword, auth.user.passwordHash))) return Response.json({ error: "The current password is incorrect or the new password is not strong enough." }, { status: 422 });
  const passwordHash = await hash(parsed.data.password, 12);
  try {
    await db.$transaction(async tx => {
      const changed = await tx.user.updateMany({ where: { id: auth.user.id, organisationId: auth.user.organisationId, active: true, sessionVersion: auth.user.sessionVersion, passwordHash: auth.user.passwordHash }, data: { passwordHash, passwordChangedAt: new Date(), sessionVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("PASSWORD_CHANGE_REVOKED");
      await tx.passwordResetToken.updateMany({ where: { userId: auth.user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { organisationId: auth.user.organisationId, actorId: auth.user.id, action: "user.password.changed", entityType: "User", entityId: auth.user.id } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PASSWORD_CHANGE_REVOKED") return Response.json({ error: "Your account changed while this request was being processed. Sign in again before changing your password." }, { status: 401 });
    throw error;
  }
  await clearSession();
  return Response.json({ data: { changed: true } });
}
