import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("follow-up GET rejects invalid queue input before reading appointments and forwards valid scoped views", async () => {
  const calls: unknown[][] = [];
  const scope = { organisationId: "org", userId: "actor", facilityIds: ["store-a"], unrestrictedFacilities: false };
  const output = await build({ entryPoints: ["src/app/api/v1/operations/followups/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "followup-route-boundary", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(scope|staff-followup-service|request-security)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/request-security") ? "export const sameOrigin=()=>true;" : a.path.endsWith("/scope") ? "export const requirePermissionScope=async()=>__scope;" : "export const listStaffFollowups=async(...args)=>{__calls.push(args);return {tasks:[]}};export const createStaffFollowup=async()=>{throw Error('UNEXPECTED_WRITE')};" }));
  } }] });
  const loaded = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__scope", "__calls", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, scope, calls);
  const invalid = await loaded.exports.GET(new Request("https://example.invalid/api/v1/operations/followups?view=bad"));
  assert.equal(invalid.status, 422); assert.equal(calls.length, 0);
  for (const view of ["all", "due", "upcoming"]) {
    const response = await loaded.exports.GET(new Request(`https://example.invalid/api/v1/operations/followups?view=${view}&search=Alex`));
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.deepEqual(calls.at(-1), [scope, "Alex", undefined, view]);
  }
});
