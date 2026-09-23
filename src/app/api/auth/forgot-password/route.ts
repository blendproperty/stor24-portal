import { passwordResetEmail } from "@/lib/password-reset-email";
import { addMinutes } from "date-fns";
import { db } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { createResetToken, hashResetToken } from "@/lib/password-reset";
import { forgotPasswordSchema } from "@/lib/validators";
import { privacyHash, rateLimit, requestIp, sameOrigin } from "@/lib/request-security";

const generic = { data: { message: "If an active account matches that address, reset instructions will be sent." } };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const parsed = forgotPasswordSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json(generic);
  const limited = await rateLimit(`forgot:${privacyHash(`${requestIp(request)}:${parsed.data.email}`)}`, 3, 30 * 60 * 1000);
  if (limited) return Response.json(generic);
  const user = await db.user.findFirst({ where: { email: parsed.data.email, active: true } });
  if (!user) return Response.json(generic);
  const token = createResetToken();
  await db.$transaction([
    db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    db.passwordResetToken.create({ data: { userId: user.id, organisationId: user.organisationId, tokenHash: hashResetToken(token), expiresAt: addMinutes(new Date(), 30) } }),
    db.auditEvent.create({ data: { organisationId: user.organisationId, action: "user.password_reset.requested", entityType: "User", entityId: user.id, ipHash: privacyHash(requestIp(request)) } }),
  ]);
  const appUrl = process.env.APP_URL || new URL(request.url).origin;
  try { await emailProvider().send({ to: user.email, ...passwordResetEmail({ name: user.name, resetUrl: `${appUrl.replace(/\/$/, "")}/reset-password/${token}` }) }); } catch (error) { console.error("Password reset email delivery failed", error instanceof Error ? error.message : "unknown error"); }
  return Response.json(generic);
}
