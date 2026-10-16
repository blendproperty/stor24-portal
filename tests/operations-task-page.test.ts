import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { operationsTaskQuerySchema } from "../src/lib/operations-task-policy";

test("task filters reject unsupported or conflicting input", () => {
  assert.equal(operationsTaskQuerySchema.parse({}).status, "active");
  for (const input of [{ status: "PAID" }, { assignee: "search", person: " " }, { person: "Not selected" }, { cursor: "foreign/not-an-id" }, { q: "x".repeat(101) }, { overrideScope: true }]) assert.equal(operationsTaskQuerySchema.safeParse(input).success, false);
  assert.equal(operationsTaskQuerySchema.parse({ assignee: "search", person: "  Brett  " }).person, "Brett");
});

test("actual task queue route enforces fresh access, strict input, no-store errors and no false zero on failed reads", async () => {
  const scope = { organisationId: "org", userId: "actor", facilityIds: ["store-a"], unrestrictedFacilities: false };
  const state = { calls: [] as unknown[][], denied: false, failure: "" };
  const bundle = await build({ entryPoints: ["src/app/api/v1/operations/tasks/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "task-route", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(scope|operations-task-service)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/scope") ? "export const requirePermissionScope=async permission=>{if(permission!=='operations.view')throw Error('WRONG_PERMISSION');if(__state.denied)throw Error('FORBIDDEN');return __scope};" : "export const operationsTaskPage=async(...args)=>{__state.calls.push(args);if(__state.failure)throw Error(__state.failure);return {items:[],total:0}};" }));
  } }] });
  const loaded = { exports: {} as { GET: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__scope", "__state", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, scope, state);
  const get = (query = "") => loaded.exports.GET(new Request(`https://example.invalid/api/v1/operations/tasks?${query}`));
  for (const query of ["status=NOPE", "due=today&due=all", "unknown=true", "assignee=search&person=x"]) assert.equal((await get(query)).status, 422);
  assert.equal(state.calls.length, 0);
  const valid = await get("assignee=mine&due=today&q=inspection"); assert.equal(valid.status, 200); assert.match(valid.headers.get("cache-control")!, /private, no-store/);
  assert.deepEqual(state.calls[0], [scope, operationsTaskQuerySchema.parse({ assignee: "mine", due: "today", q: "inspection" })]);
  state.denied = true; assert.equal((await get()).status, 403); assert.equal(state.calls.length, 1);
  state.denied = false;
  for (const failure of ["CONFLICT", "SOURCE_UNAVAILABLE"]) { state.failure = failure; const response = await get(); assert.equal(response.status, failure === "CONFLICT" ? 409 : 500); assert.match(response.headers.get("cache-control")!, /no-store/); assert.equal((await response.json()).data, undefined); }
});


test("actual exact-id recovery GET only reads current organisation/store scope and returns status without private task details", async () => {
  const state = { denied: false, reads: [] as unknown[], found: true, unrestricted: false };
  const bundle = await build({ entryPoints: ["src/app/api/v1/operations/tasks/[id]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "task-id-route", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(auth-guards|db)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db={task:{findFirst:async args=>{__state.reads.push(args);return __state.found?{id:'target',status:'COMPLETED'}:null}}};" : "export const requirePermission=async permission=>{if(permission!=='operations.view')throw Error('WRONG_PERMISSION');if(__state.denied)throw Error('FORBIDDEN');return {organisationId:'org',allowedFacilityIds:__state.unrestricted?null:['store-a']}};export const authErrorResponse=()=>Response.json({error:{message:'Forbidden'}},{status:403});" }));
  } }] });
  const loaded = { exports: {} as { GET: (r: Request, c: { params: Promise<{id:string}> }) => Promise<Response> } };
  new Function("require", "module", "exports", "__state", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const get = () => loaded.exports.GET(new Request('https://example.invalid/task/target'), { params: Promise.resolve({id:'target'}) });
  const response = await get(); assert.equal(response.status,200); assert.deepEqual(await response.json(), {data:{id:'target',status:'COMPLETED'}}); assert.match(response.headers.get('cache-control')!, /private, no-store/);
  assert.deepEqual(state.reads[0], {where:{id:'target',organisationId:'org',facility:{organisationId:'org',id:{in:['store-a']}}},select:{id:true,status:true}});
  state.denied=true;assert.equal((await get()).status,403);assert.equal(state.reads.length,1);
  state.denied=false;state.found=false;assert.equal((await get()).status,404);
  state.unrestricted=true;await get();assert.deepEqual(state.reads.at(-1),{where:{id:'target',organisationId:'org',OR:[{facilityId:null},{facility:{organisationId:'org'}}]},select:{id:true,status:true}});
});
