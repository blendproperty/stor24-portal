import { clearSession } from "@/lib/session";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  const actor = await requireSession({ allowMfaSetup: true });
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  await db.auditEvent.create({ data: { organisationId: actor.user.organisationId, actorId: actor.user.id, action: "user.logout", entityType: "User", entityId: actor.user.id } });
  await clearSession();
  return Response.json({ data: { signedOut: true } });
}
