import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { emailProvider, escapeEmailHtml } from "@/lib/email";
import { tenantCode, tenantCodeHash, tenantCustomerScope, tenantToken, tenantTokenHash, TENANT_CHALLENGE_COOKIE, TENANT_CODE_MS, TENANT_SESSION_COOKIE, TENANT_SESSION_MS } from "@/lib/tenant-portal-security";

/** Single atomic statement prevents concurrent requests bypassing limits. */
export async function tenantRateLimit(key: string, limit: number, windowMs: number) {
  const now = new Date(), resetAt = new Date(now.getTime() + windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt") VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END,
      "updatedAt" = ${now}
    RETURNING "count"`;
  return rows[0].count > limit;
}

export function tenantEmailHtml(title: string, body: string) {
  const origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
  return `<!doctype html><html><body style="margin:0;background:#f5f3ea;color:#071411;font-family:Arial,sans-serif"><div style="max-width:560px;margin:32px auto;background:#fff;padding:32px;border-top:6px solid #ff5a0a;border-radius:18px"><img src="${escapeEmailHtml(origin)}/brand/stor24-logo-official-email-20260909.png" width="183" alt="STOR24"><h1 style="font-size:28px">${escapeEmailHtml(title)}</h1>${body}<p style="margin-top:32px;color:#52615b;font-size:12px">STOR24 · Space for life in motion.</p></div></body></html>`;
}

export async function startTenantChallenge(organisationSlug: string, email: string, id = tenantToken()) {
  // Remove expired authentication material after a 24-hour troubleshooting window.
  // Business records and the separate security audit trail are not deleted.
  const retentionCutoff = new Date(Date.now() - 86400000);
  await db.tenantPortalChallenge.deleteMany({ where: { expiresAt: { lt: retentionCutoff } } });
  await db.tenantPortalSession.deleteMany({ where: { expiresAt: { lt: retentionCutoff } } });
  const code = tenantCode();
  const codeHash = tenantCodeHash(id, code);
  const organisation = await db.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true } });
  const customers = organisation ? await db.customer.findMany({
    where: { organisationId: organisation.id, email: { equals: email, mode: "insensitive" }, emailVerifiedAt: { not: null }, OR: [{ accounts: { some: {} } }, { reservations: { some: { publicLease: { status: "SIGNED" } } } }] },
    select: { id: true },
  }) : [];
  // Inert challenges keep responses indistinguishable for unregistered emails.
  await db.tenantPortalChallenge.create({ data: { id, organisationId: organisation?.id ?? "unmatched", email, codeHash, customerIds: customers.map(customer => customer.id), expiresAt: new Date(Date.now() + TENANT_CODE_MS) } });
  if (customers.length && organisation) {
    try {
      await emailProvider().send({ to: email, subject: "Your My STOR24 sign-in code", text: `Your My STOR24 code is ${code}. It expires in 10 minutes. Never share this code. If you did not request it, ignore this email.`, html: tenantEmailHtml("Your space. Your account.", `<p>Use this code to sign in to My STOR24.</p><p style="background:#071411;color:white;padding:24px;font-size:32px;letter-spacing:8px;text-align:center">${code}</p><p>Expires in 10 minutes. Never share this code, including with the STOR24 team. If you did not request it, ignore this email.</p>`) });
      await db.auditEvent.create({ data: { organisationId: organisation.id, action: "tenant_portal.code_sent", entityType: "TenantPortalChallenge", entityId: id } });
    } catch {
      await db.tenantPortalChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
      await db.auditEvent.create({ data: { organisationId: organisation.id, action: "tenant_portal.code_delivery_failed", entityType: "TenantPortalChallenge", entityId: id } });
    }
  }
  return id;
}

export async function verifyTenantChallenge(id: string, code: string, database = db) {
  const now = new Date();
  // Reserve an attempt atomically, including successful attempts.
  const attempt = await database.tenantPortalChallenge.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
  if (attempt.count !== 1) throw new Error("TENANT_INVALID_CODE");
  const challenge = await database.tenantPortalChallenge.findUnique({ where: { id } });
  if (!challenge || challenge.customerIds.length === 0 || !timingSafeEqual(Buffer.from(challenge.codeHash, "hex"), Buffer.from(tenantCodeHash(id, code), "hex"))) throw new Error("TENANT_INVALID_CODE");
  const customers = await database.customer.findMany({ where: tenantCustomerScope(challenge), select: { id: true } });
  if (!customers.length) throw new Error("TENANT_INVALID_CODE");
  const token = tenantToken();
  await database.$transaction(async tx => {
    const consumed = await tx.tenantPortalChallenge.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new Error("TENANT_INVALID_CODE");
    await tx.tenantPortalSession.create({ data: { tokenHash: tenantTokenHash(token), organisationId: challenge.organisationId, email: challenge.email, customerIds: customers.map(customer => customer.id), expiresAt: new Date(Date.now() + TENANT_SESSION_MS) } });
    await tx.auditEvent.create({ data: { organisationId: challenge.organisationId, action: "tenant_portal.signed_in", entityType: "TenantPortalChallenge", entityId: id } });
  });
  return token;
}

export async function requireTenantSession() {
  const token = (await cookies()).get(TENANT_SESSION_COOKIE)?.value;
  return tenantSessionForToken(token);
}

export async function tenantSessionForToken(token: string | undefined, database = db) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("TENANT_UNAUTHENTICATED");
  const session = await database.tenantPortalSession.findFirst({ where: { tokenHash: tenantTokenHash(token), revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!session) throw new Error("TENANT_UNAUTHENTICATED");
  const customers = await database.customer.findMany({ where: tenantCustomerScope(session), select: { id: true } });
  if (!customers.length) throw new Error("TENANT_UNAUTHENTICATED");
  return { ...session, customerIds: customers.map(customer => customer.id) };
}

export async function setTenantCookie(name: typeof TENANT_SESSION_COOKIE | typeof TENANT_CHALLENGE_COOKIE, token: string, seconds: number) {
  (await cookies()).set(name, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: seconds });
}

export async function endTenantSession() {
  const jar = await cookies();
  const token = jar.get(TENANT_SESSION_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const session = await db.tenantPortalSession.findFirst({ where: { tokenHash: tenantTokenHash(token), revokedAt: null } });
    if (session) await db.$transaction([
      db.tenantPortalSession.updateMany({ where: { tokenHash: session.tokenHash, revokedAt: null }, data: { revokedAt: new Date() } }),
      db.auditEvent.create({ data: { organisationId: session.organisationId, action: "tenant_portal.signed_out", entityType: "Customer", entityId: session.customerIds[0] } }),
    ]);
  }
  jar.delete(TENANT_SESSION_COOKIE); jar.delete(TENANT_CHALLENGE_COOKIE);
}
