import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { db } from "../src/lib/db";
import { emailProvider } from "../src/lib/email";
import { guardDlpTransfer, protectDlpResponse } from "../src/lib/dlp-transfer-service";
import { DLP_POLICY_VERSION } from "../src/lib/dlp-policy";

// Operator-only proof. Bundle into the running app and opt in explicitly.
// Creates and removes only a new synthetic organisation; no customer/provider calls.
async function main() {
  assert.equal(process.env.DLP_LIVE_PROOF, "synthetic-only");
  const nonce = randomUUID();
  const org = await db.organisation.create({ data: { name: "Synthetic DLP release proof", slug: `dlp-proof-${nonce}` } });
  try {
    const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic DLP release proof", email: `${nonce}@example.invalid` } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
    await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    const cookie = await new SignJWT({ userId: user.id, name: user.name, email: user.email, role: role.name, sessionVersion: user.sessionVersion })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("90s").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    const request = (path: string) => fetch(`http://127.0.0.1:3000${path}`, { headers: { cookie: `stor24_session=${cookie}` }, redirect: "manual" });
    const route = "/api/v1/reports/export?reportKey=unit-availability&from=2026-10-01&to=2026-10-01";
    for (const format of ["CSV", "JSON"]) {
      const response = await request(`${route}&format=${format}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-stor24-dlp-policy"), DLP_POLICY_VERSION);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      if (format === "JSON") assert.deepEqual((await response.json()).data, []); else await response.text();
    }
    await db.rateLimitBucket.update({ where: { key: `dlp:${org.id}:DOWNLOAD:${user.id}` }, data: { count: 60 } });
    const blocked = await request(`${route}&format=JSON`);
    assert.equal(blocked.status, 422); assert.equal((await blocked.json()).error.code, "DLP_EXPORT_BLOCKED");
    await assert.rejects(emailProvider().send({ to: "recipient@example.invalid", subject: "Synthetic proof", text: "4111 1111 1111 1111", html: "Synthetic proof", dlp: { organisationId: org.id, resourceId: "synthetic-mail", approvedRecipient: "recipient@example.invalid" } }), /DLP_TRANSFER_BLOCKED/);
    await assert.rejects(guardDlpTransfer({ organisationId: org.id, resourceId: "synthetic-recipient", channel: "EMAIL", classification: "confidential", recipient: "wrong@example.invalid", approvedRecipient: "approved@example.invalid" }), /DLP_TRANSFER_BLOCKED/);
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const secured = await protectDlpResponse(new Response(bytes, { headers: { "content-type": "application/pdf" } }), { organisationId: org.id, resourceId: "synthetic-file" });
    assert.deepEqual(new Uint8Array(await secured.arrayBuffer()), bytes);
    const page = await request("/audit/data-protection"); assert.equal(page.status, 200);
    const html = await page.text(); assert.match(html, /Data protection/);
    const events = await db.auditEvent.findMany({ where: { organisationId: org.id, action: { startsWith: "dlp." } } });
    assert.equal(events.length, 6); assert.equal(events.filter(event => event.action.endsWith(".blocked")).length, 3);
    assert.doesNotMatch(JSON.stringify(events), /4111 1111|recipient@example|wrong@example|approved@example/);
    console.log(JSON.stringify({ policy: DLP_POLICY_VERSION, csv: "allowed", json: "allowed", rateLimit: "blocked", sensitiveEmail: "blocked-before-provider", recipientMismatch: "blocked", pdfBytes: "preserved", auditPage: "200", safePersistedDecisions: events.length, customerMessagesSent: 0, customerRecordsChanged: 0 }));
  } finally {
    await db.auditEvent.deleteMany({ where: { organisationId: org.id } });
    await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: `dlp:${org.id}:` } } });
    await db.organisation.delete({ where: { id: org.id } });
    await db.$disconnect();
  }
}
main().catch(() => { console.error("Synthetic DLP proof failed; inspect the controlled test without exposing credentials."); process.exitCode = 1; });
