import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { RequestScope } from "../src/lib/scope";
import { canReadCollectionLetter } from "../src/lib/customer-history-body-access";

const scope = { userId: "actor", organisationId: "org", facilityIds: ["A"], unrestrictedFacilities: false };
test("collection letter content needs intersected communication and collection authority at its actual store", () => {
  assert.equal(canReadCollectionLetter(scope, scope, scope, "A"), true);
  const cases: Array<[RequestScope | null, RequestScope | null, string | null]> = [[scope, null, "A"], [null, scope, "A"], [scope, { ...scope, facilityIds: ["B"] }, "A"], [{ ...scope, facilityIds: ["B"] }, scope, "A"], [scope, { ...scope, userId: "other" }, "A"], [scope, { ...scope, organisationId: "other" }, "A"], [scope, scope, null], [scope, scope, "B"]];
  for (const [communications, collections, facility] of cases) assert.equal(canReadCollectionLetter(scope, communications, collections, facility), false);
});

test("a collection-view revocation during export prevents PDF, CSV and Excel bytes and download audit", async () => {
  let revoked = false, audited = 0, dlp = 0, inspected = 0;
  const proof = { id: "message", facilityId: "A", provider: "twilio", providerRef: null, recipientHash: "synthetic", channel: "EMAIL", direction: "OUTBOUND", messageType: "COLLECTION_REMINDER", metadata: { historyEvidence: { version: 1, text: "Actual retained reminder: R731.25 overdue.", subject: "Account reminder", redacted: true } } };
  const database = { communicationLog: { findMany: async () => [proof] }, auditEvent: { create: async () => { audited++; } } };
  const customer = { id: "customer", firstName: "Synthetic", lastName: "Customer", companyName: null, phone: null };
  const history = { entries: [{ id: "message", kind: "COMMUNICATION", at: "2026-10-15T09:00:00.000Z", title: "EMAIL · COLLECTION REMINDER", body: null, category: null, author: null, facility: "A", channel: "EMAIL", status: "SUCCEEDED", sentAt: null, deliveredAt: null, readAt: null }], nextCursor: null, legacyNotes: null, visibility: { communications: true, collections: true } };
  const result = await build({ entryPoints: ["src/lib/customer-history-export.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "letter-revocation-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|scope|customer-history-service|leasing-service|dlp-export-service|dlp-transfer-service)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : a.path.endsWith("/scope") ? "export const requirePermissionScope=__scope;" : a.path.endsWith("/customer-history-service") ? "export const customerHistory=async()=>__history;" : a.path.endsWith("/leasing-service") ? "export const requireLeasingCustomer=async()=>__customer;" : a.path.endsWith("/dlp-export-service") ? "export const guardReportExport=__decision;" : "export const guardDlpTransfer=__dlp;" }));
  } }] });
  const loaded = { exports: {} as { releaseCustomerHistoryExport: (input: unknown) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__scope", "__history", "__customer", "__decision", "__dlp", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database,
    async (permission: string) => { if (permission === "collections.view" && revoked) throw Error("FORBIDDEN"); return scope; }, history, customer,
    async (input: { rows: Array<{ body: string }> }) => { assert.match(input.rows[0].body, /R731.25/); inspected++; revoked = true; return { allowed: true }; },
    async () => { dlp++; return {}; });
  for (const format of ["CSV", "PDF", "XLSX"]) {
    revoked = false;
    await assert.rejects(loaded.exports.releaseCustomerHistoryExport({ scope, customerId: "customer", query: { kind: "COMMUNICATION", search: "" }, access: { communications: scope, collections: scope, financial: null }, format }), /FORBIDDEN/);
  }
  assert.equal(inspected, 3); assert.equal(audited, 0); assert.equal(dlp, 0);
});
