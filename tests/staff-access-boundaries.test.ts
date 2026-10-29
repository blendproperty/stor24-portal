import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { currentRoleAccess } from "../src/lib/current-role-access";
import { securityPermissionKeys } from "../src/lib/security-permissions";

const grants = ["facility.*", "facility_map.view", "leads.*", "move_in.create", "operations.view", "reports.view", "reservations.*", "operations.manage", "inventory.view", "ledger.view", "payments.view", "payments.manage", "collections.view", "collections.manage", "collections.export", "adjustments.view", "adjustments.request", "billing.view", "billing.documents.send", "reports.financial", "reports.sales", "reports.collections", "reports.export", "communications.view", "identity.review", "access.view"];
const held = ["adjustments.approve", "adjustments.record_refund", "settlements.approve", "settlements.manage", "billing.manage", "debit_orders.manage", "debit_orders.submit", "collections.policy", "mri.manage", "users.manage", "configuration.manage", "access.manage", "access.suspend", "access.restore", "data.personal_export", "ledger.manage"];

test("facility-scoped user managers cannot change global or other-store accounts", async () => {
  const role = { name: "Store employee", permissions: [] as string[] };
  let assignments = [{ facilityId: "store-b" as string | null, role }];
  let writes = 0;
  const db = { user: { findFirst: async () => ({ id: "target", organisationId: "org", active: true, roleAssignments: assignments }) }, role: {}, facility: {}, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: { update: async () => { writes++; } }, auditEvent: { create: async () => {} } }) };
  const actor = { allowedFacilityIds: ["store-a"], user: { id: "actor", organisationId: "org", roleAssignments: [{ facilityId: "store-a", role: { name: "Manager", permissions: ["users.manage"] } }] } };
  const bundle = await build({ entryPoints: ["src/app/api/v1/users/[id]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "user-scope-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards|request-security)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : a.path.endsWith("/request-security") ? "export const sameOrigin=()=>true;" : "export const requirePermission=async()=>__actor;" }));
  } }] });
  const loaded = { exports: {} as { PATCH: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__actor", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, actor);
  const request = () => new Request("https://example.invalid/api/v1/users/target", { method: "PATCH", body: JSON.stringify({ active: false }) });
  for (const facilities of [["store-b"], ["store-a", "store-b"], [null]] as (string | null)[][]) {
    assignments = facilities.map(facilityId => ({ facilityId, role }));
    assert.equal((await loaded.exports.PATCH(request(), { params: Promise.resolve({ id: "target" }) })).status, 403);
    assert.equal(writes, 0);
  }
  assignments = [{ facilityId: "store-a", role }];
  assert.equal((await loaded.exports.PATCH(request(), { params: Promise.resolve({ id: "target" }) })).status, 200);
  assert.equal(writes, 1);
});

test("a saved store workflow role allows casework and requests without financial approval or cross-store authority", () => {
  const assignments = [{ facilityId: "store-a", role: { name: "Custom access · staff", permissions: grants } }];
  for (const permission of ["leads.view", "reservations.manage", "move_in.create", "operations.manage", "inventory.view", "ledger.view", "payments.manage", "payments.view", "collections.view", "collections.manage", "adjustments.request", "billing.documents.send", "reports.export", "identity.review"]) {
    assert.equal(currentRoleAccess(assignments, permission, "store-a").allowed, true, permission);
    assert.equal(currentRoleAccess(assignments, permission, "store-b").allowed, false, permission);
    assert.deepEqual(currentRoleAccess(assignments, permission).allowedFacilityIds, ["store-a"]);
  }
  for (const permission of held) assert.equal(currentRoleAccess(assignments, permission, "store-a").allowed, false, permission);
  assert.equal(currentRoleAccess(assignments).owner, false);
  for (const grant of grants) assert.ok(securityPermissionKeys.some(key => key === grant), `Editor cannot save ${grant}`);
});

test("the owner permission endpoint accepts narrow workflow grants, preserves store scope, invalidates old sessions and audits", async () => {
  let owner = true;
  const changes: Array<{kind: string; data: unknown}> = [];
  const target = { id: "staff", organisationId: "org", roleAssignments: [{facilityId:"store-a", role:{name:"Custom access · staff",permissions:["operations.view"]}}] };
  const tx = {
    role: { upsert: async (input: { update: { permissions: string[] } }) => { changes.push({kind:"role",data:input.update}); return {id:"custom-role"}; } },
    roleAssignment: { deleteMany: async () => {}, create: async (input: {data:unknown}) => {changes.push({kind:"assignment",data:input.data});} },
    user: { update: async (input: {data:unknown}) => {changes.push({kind:"session",data:input.data});} },
    auditEvent: { create: async (input: {data:unknown}) => {changes.push({kind:"audit",data:input.data});} },
  };
  const database = { user:{findFirst:async()=>target}, $transaction:async(callback:(client:typeof tx)=>Promise<unknown>)=>callback(tx) };
  const bundle = await build({ entryPoints:["src/app/api/v1/users/[id]/permissions/route.ts"], bundle:true, write:false, platform:"node", format:"cjs", packages:"external", plugins:[{name:"permission-fixture",setup(b){
    b.onResolve({filter:/^@\/lib\/(db|auth-guards|request-security)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db")?"export const db=__db;":a.path.endsWith("/request-security")?"export const sameOrigin=()=>true;":"export const requireOwner=async()=>{if(!__owner())throw Error('FORBIDDEN');return {user:{id:'owner',organisationId:'org'}}};export const authErrorResponse=e=>Response.json({error:e.message},{status:403});"}));
  }}] });
  const loaded = {exports:{} as {PATCH:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>}};
  new Function("require","module","exports","__db","__owner",bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,database,()=>owner);
  const request = () => new Request("https://example.invalid/api/v1/users/staff/permissions",{method:"PATCH",body:JSON.stringify({permissions:grants})});
  assert.equal((await loaded.exports.PATCH(request(),{params:Promise.resolve({id:"staff"})})).status,200);
  assert.deepEqual(changes.find(c=>c.kind==="assignment")?.data,{userId:"staff",roleId:"custom-role",facilityId:"store-a"});
  assert.deepEqual(changes.find(c=>c.kind==="session")?.data,{sessionVersion:{increment:1}});
  const audit = changes.find(c=>c.kind==="audit")?.data as {actorId:string;action:string;after:{permissions:string[]}};
  assert.equal(audit.actorId,"owner");assert.equal(audit.action,"user.permissions.updated");
  assert.deepEqual(audit.after.permissions,[...grants].sort());
  changes.length=0;owner=false;
  assert.equal((await loaded.exports.PATCH(request(),{params:Promise.resolve({id:"staff"})})).status,403);
  assert.deepEqual(changes,[]);
});
