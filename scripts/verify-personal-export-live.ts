import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { db } from "../src/lib/db";
import { southAfricaDateKey } from "../src/lib/south-africa-time";
import { DLP_POLICY_VERSION } from "../src/lib/dlp-policy";

// Operator-only, explicitly opted-in proof using one disposable synthetic organisation.
// No provider calls, real customer edits or existing staff permission changes.
async function main() {
  assert.equal(process.env.PERSONAL_EXPORT_LIVE_PROOF, "synthetic-only");
  const nonce = randomUUID();
  const org = await db.organisation.create({ data: { name: "Synthetic personal export proof", slug: `personal-export-proof-${nonce}` } });
  try {
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic facility", code: "SYN" } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", lastName: "export proof", email: "synthetic@example.invalid" } });
    await db.lead.create({ data: { facilityId: facility.id, customerId: customer.id, source: "SYNTHETIC_PROOF" } });
    const owner = await db.user.create({ data: { organisationId: org.id, name: "Synthetic owner", email: `owner-${nonce}@example.invalid` } });
    const delegate = await db.user.create({ data: { organisationId: org.id, name: "Synthetic administrator", email: `admin-${nonce}@example.invalid` } });
    const ownerRole = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
    const broadRole = await db.role.create({ data: { organisationId: org.id, name: "Synthetic administrator", permissions: ["*"] } });
    await db.roleAssignment.createMany({ data: [{ userId: owner.id, roleId: ownerRole.id }, { userId: delegate.id, roleId: broadRole.id, facilityId: facility.id }] });
    async function cookie(userId: string) {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      return new SignJWT({ userId, name: user.name, email: user.email, role: "Synthetic", sessionVersion: user.sessionVersion }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("90s").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    }
    const ownerCookie = await cookie(owner.id); let delegateCookie = await cookie(delegate.id);
    const request = (path: string, token: string, body?: unknown) => fetch(`http://127.0.0.1:3000${path}`, { method: body ? "PATCH" : "GET", headers: { cookie: `stor24_session=${token}`, origin: process.env.APP_URL ?? "http://127.0.0.1:3000", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
    const day = southAfricaDateKey(new Date());
    const route = `/api/v1/reports/export?reportKey=lead-conversion&from=${day}&to=${day}&facilityId=${facility.id}`;
    for (const format of ["CSV", "JSON", "XLSX", "PDF"]) {
      const denied = await request(`${route}&format=${format}`, delegateCookie);
      assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, "PERSONAL_EXPORT_FORBIDDEN");
      const allowed = await request(`${route}&format=${format}`, ownerCookie);
      assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("x-stor24-dlp-policy"), DLP_POLICY_VERSION); assert.ok((await allowed.arrayBuffer()).byteLength > 0);
    }
    const permissionsPath = `/api/v1/users/${delegate.id}/permissions`;
    const basePermissions = ["reports.view", "reports.sales", "reports.export"];
    assert.equal((await request(permissionsPath, delegateCookie, { permissions: [...basePermissions, "data.personal_export"] })).status, 403);
    assert.equal((await request(`/api/v1/users/${delegate.id}`, delegateCookie, { roleName: "Organisation owner" })).status, 403);
    assert.equal((await request(permissionsPath, ownerCookie, { permissions: [...basePermissions, "data.personal_export"] })).status, 200);
    assert.equal((await request(`${route}&format=JSON`, delegateCookie)).status, 401);
    delegateCookie = await cookie(delegate.id);
    assert.equal((await request(`${route}&format=JSON`, delegateCookie)).status, 200);
    assert.equal((await request(permissionsPath, ownerCookie, { permissions: basePermissions })).status, 200);
    assert.equal((await request(`${route}&format=JSON`, delegateCookie)).status, 401);
    delegateCookie = await cookie(delegate.id);
    assert.equal((await request(`${route}&format=JSON`, delegateCookie)).status, 403);
    const preview = await request(route.replace("/export?", "/preview?") + "&format=JSON", delegateCookie);
    assert.equal(preview.status, 200);
    const events = await db.auditEvent.findMany({ where: { organisationId: org.id } });
    assert.equal(events.filter(e => e.action === "dlp.export.blocked").length, 5);
    assert.equal(events.filter(e => e.action === "user.permissions.updated").length, 2);
    assert.doesNotMatch(JSON.stringify(events), /Synthetic export proof|synthetic@example.invalid/);
    const page = await request("/audit/data-protection", ownerCookie); assert.equal(page.status, 200);
    assert.match(await page.text(), /Channel \/ format/);
    console.log(JSON.stringify({ policy: DLP_POLICY_VERSION, ownerFormats: 4, wildcardFormatsDenied: 4, selfDelegationDenied: true, selfPromotionDenied: true, ownerGrantAndRevoke: true, sessionInvalidation: true, delegatedExport: 200, revokedExport: 403, authorisedPreview: 200, blockedAuditCount: 5, permissionAuditCount: 2, auditPage: 200, existingStaffOrCustomerChanges: 0, providerCalls: 0 }));
  } finally {
    await db.auditEvent.deleteMany({ where: { organisationId: org.id } });
    await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: `dlp:${org.id}:` } } });
    await db.lead.deleteMany({ where: { facility: { organisationId: org.id } } });
    await db.organisation.delete({ where: { id: org.id } });
    assert.equal(await db.organisation.count({ where: { id: org.id } }), 0);
    await db.$disconnect();
  }
}
main().catch(() => { console.error("Synthetic personal-export proof failed; inspect the controlled test without exposing credentials."); process.exitCode = 1; });
