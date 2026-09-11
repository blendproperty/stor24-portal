import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { tenantCode, tenantCodeHash, tenantToken, tenantTokenHash, tenantCustomerScope, TENANT_SESSION_COOKIE } from "../src/lib/tenant-portal-security";
import { tenantError, tenantPdf } from "../src/lib/tenant-portal-response";
import { renderTenantDocumentPdf } from "../src/lib/finance/tenant-document-pdf";

test("tenant tokens are random and only digests are persisted", () => {
  const tokens = Array.from({ length: 100 }, tenantToken);
  assert.equal(new Set(tokens).size, 100);
  for (const token of tokens) { assert.match(token, /^[a-f0-9]{64}$/); assert.notEqual(tenantTokenHash(token), token); }
  for (let i = 0; i < 100; i++) assert.match(tenantCode(), /^\d{6}$/);
  assert.equal(TENANT_SESSION_COOKIE, "stor24_tenant_session");
});
test("code digests require configured secret and are challenge-bound", () => {
  const original = process.env.AUTH_SECRET;
  try {
    delete process.env.AUTH_SECRET;
    assert.throws(() => tenantCodeHash("a", "123456"), /UNCONFIGURED/);
    process.env.AUTH_SECRET = "test-only-not-a-production-secret-000000";
    assert.notEqual(tenantCodeHash("a", "123456"), tenantCodeHash("b", "123456"));
    assert.notEqual(tenantCodeHash("a", "123456"), tenantCodeHash("a", "123457"));
  } finally { if (original === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = original; }
});
test("customer scope binds captured IDs, organisation and currently verified email", () => {
  assert.deepEqual(tenantCustomerScope({ organisationId: "org-a", email: "tenant@example.invalid", customerIds: ["own-id"] }), {
    organisationId: "org-a", id: { in: ["own-id"] }, email: { equals: "tenant@example.invalid", mode: "insensitive" }, emailVerifiedAt: { not: null },
  });
  assert.deepEqual(tenantCustomerScope({ organisationId: "org-a", email: "x", customerIds: [] }).id, { in: [] });
});
test("private responses do not leak exceptions or permit caching", async () => {
  for (const [code, status] of [["TENANT_UNAUTHENTICATED", 401], ["TENANT_NOT_FOUND", 404], ["INVALID_PERIOD", 422], ["database-secret", 503]] as const) {
    const response = tenantError(new Error(code));
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.doesNotMatch(await response.text(), /database-secret/);
  }
  const response = tenantPdf(new Uint8Array([1, 2]), "statement.pdf");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition")!, /attachment/);
});
test("PDF renderer produces a branded paginated document", async () => {
  const bytes = await renderTenantDocumentPdf({ title: "Account statement", reference: "TEST-ONLY", customerName: "Sample Tenant", subtitle: "Layout test - no customer data", columns: ["Date", "Description", "Debit", "Credit", "Balance"], rows: Array.from({ length: 70 }, (_, i) => ["10 Sep 2026", `Test transaction ${i + 1}`, "ZAR 100.00", "-", "ZAR 100.00"]), notes: ["Test document only."] });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3);
  assert.match(pdf.getTitle()!, /STOR24/);
});
test("all tenant data routes authenticate and apply customer scope", () => {
  for (const file of ["accounts/route.ts", "accounts/[id]/statement/route.ts", "documents/[kind]/[id]/route.ts", "merchandise/route.ts"]) {
    const source = readFileSync(`src/app/api/tenant/${file}`, "utf8");
    assert.match(source, /await requireTenantSession\(\)/);
    assert.match(source, /tenantCustomerScope\(session\)/);
  }
});
test("OTP consumption and attempts are atomic and session is rechecked", () => {
  const source = readFileSync("src/lib/tenant-portal-auth.ts", "utf8");
  assert.match(source, /attempts: \{ lt: 5 \}/);
  assert.match(source, /database\.\$transaction/);
  assert.match(source, /consumed\.count !== 1/);
  assert.match(source, /revokedAt: null, expiresAt: \{ gt: new Date\(\) \}/);
  assert.match(source, /where: tenantCustomerScope\(session\)/);
});
