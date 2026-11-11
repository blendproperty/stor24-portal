import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("batch endpoint checks origin, facility permission, money and payload", async () => {
  const source = await build({ entryPoints: ["src/app/api/v1/move-in-batch/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "mocks", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(api|request-security|scope|leasing-service)$/ }, a => ({ path: a.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: ({ "@/lib/api": "export const apiError=e=>Response.json({error:e.message},{status:403})", "@/lib/request-security": "export const sameOrigin=()=>globalThis.__batchOrigin", "@/lib/scope": "export const requirePermissionScope=async(p,f)=>{globalThis.__batchPermission=[p,f];return {}}", "@/lib/leasing-service": "export const moveInBatch=async(s,k,i)=>{globalThis.__batchInputs=i;return {items:[]}}" })[a.path] }));
  } }] });
  const mod = { exports: {} }; new Function("require", "module", "exports", source.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
  const payload = { requestKey: "d3d6818c-1d39-42a4-bda1-f92843095c5f", facilityId: "facility", customerId: "customer", paymentMethod: "EFT", units: [{ unitId: "unit", startDate: "2026-12-01", monthlyRate: 1000, initialCharge: 10 }] };
  const post = data => mod.exports.POST(new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));
  globalThis.__batchOrigin = false; assert.equal((await post(payload)).status, 403);
  globalThis.__batchOrigin = true; assert.equal((await post({ ...payload, units: [{ ...payload.units[0], initialCharge: 1.001 }] })).status, 422);
  assert.equal((await post(payload)).status, 200); assert.deepEqual(globalThis.__batchPermission, ["move_in.create", "facility"]); assert.equal(globalThis.__batchInputs[0].customerId, "customer");
  delete globalThis.__batchOrigin; delete globalThis.__batchPermission; delete globalThis.__batchInputs;
});
