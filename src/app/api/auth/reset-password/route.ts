import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { clearSession } from "@/lib/session";
import { hashResetToken } from "@/lib/password-reset";
import { resetPasswordSchema } from "@/lib/validators";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const parsed = resetPasswordSchema.safeParse(await request.json());
  if (!parsed.success || parsed.data.password === parsed.data.token) return Response.json({ error: "The reset link or password is invalid." }, { status: 422 });
  const reset = await db.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(parsed.data.token) } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) return Response.json({ error: "This reset link is invalid, expired or already used." }, { status: 410 });
  const passwordHash = await hash(parsed.data.password, 12);
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gte: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new Error("TOKEN_CLAIMED");
      const updated = await tx.user.updateMany({ where: { id: reset.userId, organisationId: reset.organisationId, active: true }, data: { passwordHash, passwordChangedAt: new Date(), sessionVersion: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("USER_INACTIVE");
      await tx.passwordResetToken.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { organisationId: reset.organisationId, actorId: reset.userId, action: "user.password_reset.completed", entityType: "User", entityId: reset.userId } });
    });
  } catch { return Response.json({ error: "This reset link is invalid, expired or already used." }, { status: 410 }); }
  await clearSession();
  return Response.json({ data: { reset: true } });
}
