import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { authErrorResponse, requireSession } from "@/lib/auth-guards";
import { consumeRecoveryCode, decryptMfaSecret, encryptMfaSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCodes, totpUri, verifyTotp } from "@/lib/mfa";
import { sameOrigin } from "@/lib/request-security";

export async function GET() {
  try {
    const auth = await requireSession();
    const credential = await db.mfaCredential.findUnique({ where: { userId: auth.user.id }, select: { enabledAt: true, recoveryCodeHashes: true } });
    return Response.json({ data: { enabled: Boolean(credential?.enabledAt), enabledAt: credential?.enabledAt, recoveryCodesRemaining: Array.isArray(credential?.recoveryCodeHashes) ? credential.recoveryCodeHashes.length : 0 } });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireSession();
    if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (body.action === "begin") {
      const existing = await db.mfaCredential.findUnique({ where: { userId: auth.user.id }, select: { enabledAt: true } });
      if (existing?.enabledAt) return Response.json({ error: "Turn off the current authenticator before replacing it." }, { status: 409 });
      const secret = generateTotpSecret();
      await db.mfaCredential.upsert({ where: { userId: auth.user.id }, create: { userId: auth.user.id, secretEncrypted: encryptMfaSecret(secret), recoveryCodeHashes: [] }, update: { secretEncrypted: encryptMfaSecret(secret), recoveryCodeHashes: [], enabledAt: null } });
      await db.auditEvent.create({ data: { organisationId: auth.user.organisationId, actorId: auth.user.id, action: "user.mfa.enrollment_started", entityType: "User", entityId: auth.user.id } });
      return Response.json({ data: { secret, uri: totpUri(secret, auth.user.email) } });
    }
    const credential = await db.mfaCredential.findUnique({ where: { userId: auth.user.id } });
    if (!credential) return Response.json({ error: "Start authenticator setup first." }, { status: 409 });
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const hashes = Array.isArray(credential.recoveryCodeHashes) ? credential.recoveryCodeHashes.filter((value): value is string => typeof value === "string") : [];
    const remaining = consumeRecoveryCode(hashes, code);
    const valid = verifyTotp(decryptMfaSecret(credential.secretEncrypted), code);
    if (body.action === "enable") {
      if (credential.enabledAt) return Response.json({ error: "Two-step verification is already enabled." }, { status: 409 });
      if (!valid) return Response.json({ error: "The authenticator code is incorrect." }, { status: 422 });
      const recoveryCodes = generateRecoveryCodes();
      await db.$transaction([db.mfaCredential.update({ where: { userId: auth.user.id }, data: { enabledAt: new Date(), recoveryCodeHashes: hashRecoveryCodes(recoveryCodes) } }), db.auditEvent.create({ data: { organisationId: auth.user.organisationId, actorId: auth.user.id, action: "user.mfa.enabled", entityType: "User", entityId: auth.user.id } })]);
      return Response.json({ data: { enabled: true, recoveryCodes } });
    }
    if (body.action === "regenerate") {
      if (!credential.enabledAt || (!valid && !remaining)) return Response.json({ error: "A current authenticator or recovery code is required." }, { status: 422 });
      const recoveryCodes = generateRecoveryCodes();
      await db.$transaction([db.mfaCredential.update({ where: { userId: auth.user.id }, data: { recoveryCodeHashes: hashRecoveryCodes(recoveryCodes) } }), db.auditEvent.create({ data: { organisationId: auth.user.organisationId, actorId: auth.user.id, action: "user.mfa.recovery_codes_regenerated", entityType: "User", entityId: auth.user.id } })]);
      return Response.json({ data: { recoveryCodes } });
    }
    if (body.action === "disable") {
      if (!auth.user.passwordHash || typeof body.password !== "string" || !(await compare(body.password, auth.user.passwordHash)) || (!valid && !remaining)) return Response.json({ error: "Your password and a current verification code are required." }, { status: 422 });
      await db.$transaction([db.mfaCredential.delete({ where: { userId: auth.user.id } }), db.user.update({ where: { id: auth.user.id }, data: { sessionVersion: { increment: 1 } } }), db.auditEvent.create({ data: { organisationId: auth.user.organisationId, actorId: auth.user.id, action: "user.mfa.disabled", entityType: "User", entityId: auth.user.id } })]);
      return Response.json({ data: { disabled: true } });
    }
    return Response.json({ error: "Unsupported MFA action." }, { status: 400 });
  } catch (error) { return authErrorResponse(error); }
}
