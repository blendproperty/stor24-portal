import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
async function fixture() {
  const state = { personal: false, owner: false, authorised: true, failAudit: false, audits: [] as Record<string, unknown>[] };
  const built = await build({ entryPoints: ["src/app/api/v1/reports/csv/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|auth-guards|scope|request-security)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents:
      args.path.endsWith("/db") ? "export const db={auditEvent:{create:async({data})=>{if(__state.failAudit)throw Error('AUDIT_DOWN');__state.audits.push(data);}}};" :
      args.path.endsWith("/scope") ? "export const requirePermissionScope=async()=>({organisationId:'synthetic-org',facilityIds:['a'],unrestrictedFacilities:false});export const requireFacility=async(s,id)=>{if(id!=='a')throw Error('FORBIDDEN');};" :
      args.path.endsWith("/request-security") ? "export const sameOrigin=r=>r.headers.get('origin')===new URL(r.url).origin;export const rateLimit=async()=>false;" :
      "export const requirePermission=async()=>{if(!__state.authorised)throw Error('FORBIDDEN');return {organisationId:'synthetic-org',allowedFacilityIds:['a'],user:{id:'synthetic-actor',roleAssignments:[{facilityId:__state.owner?null:'a',role:{name:__state.owner?'Organisation owner':'Manager',permissions:__state.personal?['data.personal_export']:['*']}}]}};};export const authErrorResponse=e=>Response.json({error:{code:e.message==='FORBIDDEN'?'FORBIDDEN':'INTERNAL_ERROR'}},{status:e.message==='FORBIDDEN'?403:500});"
    }));
  } }] });
  const loaded = { exports: {} as { POST: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__state", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const post = (rows: (string | number)[][], changes: Record<string, unknown> = {}, origin = "https://example.invalid") => loaded.exports.POST(new Request("https://example.invalid/api/v1/reports/csv", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ kind: "marketing", rows, ...changes }) }));
  return { state, post };
}
test("workspace CSV downloads audit exact server-released bytes and protect formula cells", async () => {
  const f = await fixture();
  const response = await f.post([["Campaign", "Spend"], ["=SUM(1,2)", 3]]);
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer()), "\uFEFF\"Campaign\",\"Spend\"\r\n\"'=SUM(1,2)\",\"3\"");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const after = f.state.audits[0].after as Record<string, unknown>;
  assert.equal(after.payloadSource, "browser-selected"); assert.equal(after.rowCount, 1);
  assert.doesNotMatch(JSON.stringify(f.state.audits), /SUM/);
});
test("workspace exports cannot bypass personal grants, existing credential blocks or saved audits", async () => {
  const f = await fixture(), rows = [["Campaign", "Spend"], ["synthetic@example.invalid", 2]];
  assert.equal((await f.post(rows)).status, 403);
  f.state.personal = true; assert.equal((await f.post(rows)).status, 200);
  f.state.personal = false; f.state.owner = true; assert.equal((await f.post(rows, { kind: "advertising" })).status, 200);
  assert.equal((await f.post([["Customer"], ["Synthetic"]], { kind: "rent-review" })).status, 200);
  assert.equal((await f.post([["Campaign"], ["-----BEGIN PRIVATE KEY-----"]])).status, 422);
  f.state.failAudit = true; assert.equal((await f.post(rows)).status, 500);
  assert.doesNotMatch(JSON.stringify(f.state.audits), /synthetic@example/);
});
test("workspace export authority, origin, facility and bounded shape are enforced", async () => {
  const f = await fixture(), rows = [["Campaign"], ["Synthetic"]];
  assert.equal((await f.post(rows, {}, "https://foreign.invalid")).status, 403);
  f.state.authorised = false; assert.equal((await f.post(rows)).status, 403); f.state.authorised = true;
  assert.equal((await f.post(rows, { facilityId: "b" })).status, 403);
  assert.equal((await f.post([["Repeated", "Repeated"], ["a", "b"]])).status, 422);
  assert.equal((await f.post(rows, { kind: "unknown" })).status, 422);
  assert.equal((await f.post([["x".repeat(101)], ["Synthetic"]])).status, 422);
  const headers = Array.from({length: 100}, (_, i) => `Column ${i} ${"x".repeat(80)}`);
  assert.equal((await f.post([headers, ...Array.from({length: 5000}, () => [])])).status, 422);
  assert.equal(f.state.audits.length, 0);
});
