import { db } from "@/lib/db";
import { clearMfaChallenge, getMfaChallenge } from "@/lib/mfa-challenge";
import { consumeRecoveryCode, decryptMfaSecret, verifyTotp } from "@/lib/mfa";
import { setSession } from "@/lib/session";
import { privacyHash, rateLimit, requestIp, sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const ip = requestIp(request);
  if (await rateLimit(`mfa-login:${privacyHash(ip)}`, 8, 15 * 60 * 1000)) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  const userId = await getMfaChallenge();
  if (!userId) return Response.json({ error: "Your verification session expired. Sign in again." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const user = await db.user.findUnique({ where: { id: userId }, include: { roleAssignments: { include: { role: true } }, mfaCredential: true } });
  if (!user?.active || !user.mfaCredential?.enabledAt) return Response.json({ error: "Your verification session is no longer valid." }, { status: 401 });

  const recoveryHashes = Array.isArray(user.mfaCredential.recoveryCodeHashes) ? user.mfaCredential.recoveryCodeHashes.filter((value): value is string => typeof value === "string") : [];
  const remaining = consumeRecoveryCode(recoveryHashes, code);
  const validTotp = verifyTotp(decryptMfaSecret(user.mfaCredential.secretEncrypted), code);
  if (!validTotp && !remaining) {
    await db.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.mfa_failed", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } });
    return Response.json({ error: "The verification code is incorrect." }, { status: 401 });
  }
  if (remaining) await db.mfaCredential.update({ where: { userId }, data: { recoveryCodeHashes: remaining } });
  await db.$transaction([
    ...(remaining ? [db.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.recovery_code_used", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } })] : []),
    db.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.succeeded", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } }),
  ]);
  await setSession({ userId: user.id, name: user.name, email: user.email, role: user.roleAssignments[0]?.role.name ?? "Unassigned", sessionVersion: user.sessionVersion });
  await clearMfaChallenge();
  return Response.json({ data: { name: user.name } });
}
