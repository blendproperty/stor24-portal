import { withMfaUserLock } from "@/lib/mfa-credential-lock";
import { clearMfaChallenge, getMfaChallenge } from "@/lib/mfa-challenge";
import { consumeRecoveryCode, decryptMfaSecret, verifyTotp } from "@/lib/mfa";
import { setSession } from "@/lib/session";
import { privacyHash, rateLimit, requestIp, sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const ip = requestIp(request);
  if (await rateLimit(`mfa-login:${privacyHash(ip)}`, 8, 15 * 60 * 1000)) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  const challenge = await getMfaChallenge();
  if (!challenge) return Response.json({ error: "Your verification session expired. Sign in again." }, { status: 401 });
  const { userId } = challenge;
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const result = await withMfaUserLock(userId, async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roleAssignments: { include: { role: true } }, mfaCredential: true } });
    if (!user?.active || user.sessionVersion !== challenge.sessionVersion || !user.mfaCredential?.enabledAt) return { ok: false as const, response: Response.json({ error: "Your verification session is no longer valid." }, { status: 401 }) };
    const recoveryHashes = Array.isArray(user.mfaCredential.recoveryCodeHashes) ? user.mfaCredential.recoveryCodeHashes.filter((value): value is string => typeof value === "string") : [];
    const remaining = consumeRecoveryCode(recoveryHashes, code);
    const validTotp = verifyTotp(decryptMfaSecret(user.mfaCredential.secretEncrypted), code);
    if (!validTotp && !remaining) {
      await tx.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.mfa_failed", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } });
      return { ok: false as const, response: Response.json({ error: "The verification code is incorrect." }, { status: 401 }) };
    }
    if (remaining) {
      await tx.mfaCredential.update({ where: { userId }, data: { recoveryCodeHashes: remaining } });
      await tx.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.recovery_code_used", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } });
    }
    await tx.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.succeeded", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } });
    return { ok: true as const, user };
  });
  if (!result.ok) return result.response;
  const user = result.user;
  await setSession({ userId: user.id, name: user.name, email: user.email, role: user.roleAssignments[0]?.role.name ?? "Unassigned", sessionVersion: user.sessionVersion });
  await clearMfaChallenge();
  return Response.json({ data: { name: user.name } });
}
