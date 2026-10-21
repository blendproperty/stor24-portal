import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("bulk cancellation validates the selection and intersects view/manage store access", async () => {
  const scope = { organisationId: "org", userId: "staff", facilityIds: ["store"], unrestrictedFacilities: false };
  const fixture = { denied: "", visible: scope, managed: scope, calls: [] as { facility: { facilityIds: string[]; unrestrictedFacilities: boolean } }[] };
  const output = await build({ entryPoints: ["src/app/api/v1/leads/cancel-tests/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "bulk-boundary", setup(b) {
    b.onResolve({filter:/^@\/generated\/prisma\/client$/},a=>({path:a.path,namespace:"prisma-fixture"}));
    b.onLoad({filter:/.*/,namespace:"prisma-fixture"},()=>({contents:"export const Prisma={join:values=>values};"}));
    b.onResolve({ filter: /^@\/lib\/(scope|db|request-security)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/scope") ? "export const requirePermissionScope=async p=>{if(p===__fixture.denied)throw Error('FORBIDDEN');return p==='leads.view'?__fixture.visible:__fixture.managed;};export const facilityWhere=s=>s;" : a.path.endsWith("/db") ? "export const db={$transaction:async fn=>fn({lead:{count:async args=>{__fixture.calls.push(args.where);return 0;}}})};" : "export const sameOrigin=r=>r.headers.get('origin')==='https://fixture.invalid';" }));
  } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__fixture", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, fixture);
  const selection = { confirmed: true, leads: [{ id: "one", updatedAt: "2026-10-21T08:00:00.000Z" }, { id: "two", updatedAt: "2026-10-21T08:00:00.000Z" }] };
  const request = (body: unknown, origin = "https://fixture.invalid") => new Request("https://fixture.invalid/api/v1/leads/cancel-tests", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await loaded.exports.POST(request(selection, "https://other.invalid"))).status, 403);
  for (const permission of ["leads.view", "leads.manage"]) { fixture.denied = permission; assert.equal((await loaded.exports.POST(request(selection))).status, 403); }
  fixture.denied = "";
  for (const body of [{ ...selection, confirmed: false }, { ...selection, leads: [] }, { ...selection, leads: [selection.leads[0], selection.leads[0]] }, { ...selection, leads: Array.from({ length: 101 }, (_, i) => ({ ...selection.leads[0], id: String(i) })) }, { ...selection, leads: [{ id: "one" }] }, { ...selection, operation: "purge" }, { ...selection, deleteCustomers: true }]) assert.equal((await loaded.exports.POST(request(body))).status, 422);
  assert.equal(fixture.calls.length, 0);
  assert.equal((await loaded.exports.POST(request({...selection, operation:"delete"}))).status,404);
  assert.equal((await loaded.exports.POST(new Request("https://fixture.invalid/api/v1/leads/cancel-tests", { method: "POST", headers: { origin: "https://fixture.invalid" }, body: "{" }))).status, 422);
  for (const [visible, managed, expected] of [
    [{ ...scope, facilityIds: ["store", "view-only"] }, { ...scope, facilityIds: ["store", "manage-only"] }, ["store"]],
    [{ ...scope, unrestrictedFacilities: true }, scope, ["store"]],
    [scope, { ...scope, unrestrictedFacilities: true }, ["store"]],
    [{ ...scope, facilityIds: ["view-only"] }, { ...scope, facilityIds: ["manage-only"] }, []],
  ] as const) {
    fixture.visible = { ...visible, facilityIds: [...visible.facilityIds] }; fixture.managed = { ...managed, facilityIds: [...managed.facilityIds] };
    assert.equal((await loaded.exports.POST(request(selection))).status, 404);
    assert.deepEqual(fixture.calls.at(-1)?.facility.facilityIds, expected);
    assert.equal(fixture.calls.at(-1)?.facility.unrestrictedFacilities, false);
  }
});
