import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { setSession } from "@/lib/session";
import { loginSchema } from "@/lib/validators";
import { privacyHash, rateLimit, requestIp, sameOrigin } from "@/lib/request-security";
import { hash } from "bcryptjs";
import { setMfaChallenge } from "@/lib/mfa-challenge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const ip = requestIp(request);
  if (await rateLimit(`login:${privacyHash(ip)}`, 5, 15 * 60 * 1000)) {
    return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }

  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
  const user = await db.user.findFirst({
    where: { email: parsed.data.email, active: true },
    include: { roleAssignments: { include: { role: true } }, mfaCredential: { select: { enabledAt: true } } },
  });
  const comparisonHash = user?.passwordHash ?? await hash("constant-time-invalid-password", 12);
  const valid = await compare(parsed.data.password, comparisonHash);
  if (!user || !valid) {
    if (user) await db.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.failed", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } });
    return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  if (user.mfaCredential?.enabledAt) {
    await setMfaChallenge(user.id);
    await db.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.mfa_required", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } });
    return Response.json({ data: { mfaRequired: true } });
  }

  await db.auditEvent.create({ data: { organisationId: user.organisationId, actorId: user.id, action: "user.login.succeeded", entityType: "User", entityId: user.id, ipHash: privacyHash(ip) } });
  await setSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.roleAssignments[0]?.role.name ?? "Unassigned",
    sessionVersion: user.sessionVersion,
  });
  return Response.json({ data: { name: user.name } });
}
