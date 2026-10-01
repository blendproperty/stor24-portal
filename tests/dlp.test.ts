import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { inspectReportExport, DLP_MAX_ROWS, DLP_MAX_BYTES } from "../src/lib/dlp-policy";

test("normal operational and empty reports remain confidential and exportable", () => {
  assert.equal(inspectReportExport("rent-roll", [{ customer: "Synthetic customer", account: "TEST-1", balance: 100 }]).allowed, true);
  assert.equal(inspectReportExport("rent-roll", []).classification, "confidential");
  assert.equal(inspectReportExport("unknown-report", []).allowed, false);
});
test("restricted fields, credentials, valid card patterns and nested objects are blocked without recording content", () => {
  for (const row of [{ bank_account_number: "synthetic-bank" }, { note: "-----BEGIN PRIVATE KEY-----" }, { note: "4111 1111 1111 1111" }, { metadata: { secret: "synthetic-secret" } }]) {
    const decision = inspectReportExport("rent-roll", [row]);
    assert.equal(decision.allowed, false);
    assert.doesNotMatch(JSON.stringify(decision), /synthetic-bank|4111|synthetic-secret|BEGIN PRIVATE/);
  }
  assert.equal(inspectReportExport("rent-roll", [{ note: "4111 1111 1111 1112" }]).allowed, true);
});
test("row and UTF-8 data size limits block bulk release", () => {
  assert.equal(inspectReportExport("rent-roll", Array.from({ length: DLP_MAX_ROWS }, () => ({ balance: 1 }))).allowed, true);
  assert.ok(inspectReportExport("rent-roll", Array.from({ length: DLP_MAX_ROWS + 1 }, () => ({ balance: 1 }))).reasons.includes("ROW_LIMIT"));
  assert.ok(inspectReportExport("rent-roll", [{ note: "é".repeat(DLP_MAX_BYTES / 2) }]).reasons.includes("SIZE_LIMIT"));
});

type Audit = { action: string; organisationId: string; actorId: string; after: unknown };
async function fixture() {
  const state = { rows: [{ customer: "Synthetic customer", balance: 100 }] as Record<string, unknown>[], audits: [] as Audit[], failAudit: false, allowed: true };
  const result = await build({ entryPoints: ["src/app/api/v1/reports/export/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "dlp-fixture", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|auth-guards|scope|report-data-service)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
      args.path.endsWith("/db") ? "export const db={$queryRaw:async()=>[{count:1}],auditEvent:{create:async({data})=>{if(__state.failAudit)throw Error('AUDIT_DOWN');__state.audits.push(data);return data;}}};" :
      args.path.endsWith("/scope") ? "export const requirePermissionScope=async()=>({organisationId:'org-a',facilityIds:['facility-a'],unrestrictedFacilities:false});" :
      args.path.endsWith("/report-data-service") ? "export const buildReportRows=async()=>__state.rows;" :
      "export const requirePermission=async()=>{if(!__state.allowed)throw Error('FORBIDDEN');return {organisationId:'org-a',user:{id:'actor-a'},permissions:['*'],allowedFacilityIds:['facility-a']};};export const authErrorResponse=e=>Response.json({error:{code:e.message==='FORBIDDEN'?'FORBIDDEN':'INTERNAL_ERROR'}},{status:e.message==='FORBIDDEN'?403:500});"
    }));
  } }] });
  const loaded = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__state", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const get = (format = "CSV") => loaded.exports.GET(new Request(`https://example.invalid/api/v1/reports/export?reportKey=rent-roll&from=2026-09-01&to=2026-09-30&format=${format}`));
  return { state, get };
}
test("CSV and JSON pass the same audited policy boundary and private response headers", async () => {
  const f = await fixture();
  for (const format of ["CSV", "JSON"]) {
    const response = await f.get(format);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.headers.get("x-stor24-data-classification"), "confidential");
    assert.ok(response.headers.get("x-request-id"));
  }
  assert.equal(f.state.audits.length, 2);
  assert.equal(f.state.audits[0].organisationId, "org-a");
  assert.equal(f.state.audits[0].actorId, "actor-a");
  assert.doesNotMatch(JSON.stringify(f.state.audits), /Synthetic customer/);
});
test("blocked data is never released and audit failure fails closed", async () => {
  const f = await fixture();
  f.state.rows = [{ bankAccountNumber: "synthetic-sensitive" }];
  for (const format of ["CSV", "JSON"]) {
    const response = await f.get(format);
    assert.equal(response.status, 422);
    assert.doesNotMatch(await response.text(), /synthetic-sensitive/);
  }
  assert.equal(f.state.audits[0].action, "dlp.export.blocked");
  f.state.rows = [{ customer: "Synthetic customer" }]; f.state.failAudit = true;
  const failed = await f.get();
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /Synthetic customer|AUDIT_DOWN/);
});
test("DLP does not grant report access to an unauthorised actor", async () => {
  const f = await fixture(); f.state.allowed = false;
  assert.equal((await f.get()).status, 403);
  assert.equal(f.state.audits.length, 0);
});
