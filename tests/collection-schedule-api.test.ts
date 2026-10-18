import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("staff schedule API rejects anonymous, cross-origin, unbounded and direct-send commands before service mutations", async () => {
  let signedIn = false, origin = true, reads = 0, writes = 0, crash = false;
  const bundle = await build({ entryPoints: ["src/app/api/v1/collections/schedules/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "schedule-api-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(scope|request-security|collection-schedule-service)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path.endsWith("/scope") ? `export const requirePermissionScope=async p=>{if(p!=='collection_schedules.view')throw Error('BAD_PERMISSION');if(!__signedIn())throw Error('UNAUTHENTICATED');return {userId:'fixture',organisationId:'fixture'}};` : a.path.endsWith("/request-security") ? `export const sameOrigin=()=>__origin();export const rateLimit=async()=>false;` : `import {collectionScheduleCommand} from './src/lib/collection-schedule-policy';export const SCHEDULE_VIEW='collection_schedules.view';export const readCollectionSchedules=async()=>{__read();return {safe:true}};export const commandCollectionSchedule=async(scope,input)=>{collectionScheduleCommand.parse(input);__write();return {emailSent:false}};` }));
  } }] });
  const loaded = { exports: {} as { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__signedIn", "__origin", "__read", "__write", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, () => signedIn, () => origin, () => { reads++; if (crash) throw Error("Private sender@example.invalid secret"); }, () => { writes++; });
  const url = "https://example.invalid/api/v1/collections/schedules", post = (body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });
  assert.equal((await loaded.exports.GET(new Request(url))).status, 401); assert.equal(reads, 0);
  signedIn = true; assert.equal((await loaded.exports.GET(new Request(`${url}?enabled=true`))).status, 400); assert.equal(reads, 0);
  origin = false; assert.equal((await loaded.exports.POST(post({ action: "send" }))).status, 403); assert.equal(writes, 0);
  origin = true; assert.equal((await loaded.exports.POST(post({ action: "send" }))).status, 400); assert.equal(writes, 0);
  assert.equal((await loaded.exports.POST(new Request(url, { method: "POST", body: "x".repeat(12001) }))).status, 400); assert.equal(writes, 0);
  assert.equal((await loaded.exports.GET(new Request(url))).status, 200); assert.equal(reads, 1);
  crash = true; const result = await loaded.exports.GET(new Request(url)); assert.equal(result.status, 409); assert.doesNotMatch(await result.text(), /sender@|Private|secret/); assert.match(result.headers.get("cache-control")!, /no-store/);
});

test("worker endpoint requires a strong exact private key before calling its default-off dispatcher", async () => {
  let calls = 0; const before = process.env.COLLECTION_SCHEDULE_WORKER_KEY;
  const bundle = await build({ entryPoints: ["src/app/api/internal/collection-schedules/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "worker-fixture", setup(b) { b.onResolve({ filter: /collection-schedule-worker$/ }, a => ({ path: a.path, namespace: "fixture" })); b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const processCollectionSchedules=async()=>{__called();return {disabled:true}};" })); } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__called", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, () => { calls++; });
  const request = (key: string) => new Request("https://example.invalid/api/internal/collection-schedules", { method: "POST", headers: { authorization: `Bearer ${key}` } });
  try {
    delete process.env.COLLECTION_SCHEDULE_WORKER_KEY; assert.equal((await loaded.exports.POST(request(""))).status, 401);
    process.env.COLLECTION_SCHEDULE_WORKER_KEY = "isolated-worker-key-12345678901234567890";
    assert.equal((await loaded.exports.POST(request("wrong"))).status, 401); assert.equal(calls, 0);
    assert.equal((await loaded.exports.POST(request(process.env.COLLECTION_SCHEDULE_WORKER_KEY))).status, 200); assert.equal(calls, 1);
  } finally { if (before === undefined) delete process.env.COLLECTION_SCHEDULE_WORKER_KEY; else process.env.COLLECTION_SCHEDULE_WORKER_KEY = before; }
});

test("internal arrears endpoint rejects missing, short and incorrect keys before dispatcher access", async () => {
  let calls = 0; const before = process.env.ARREARS_REVIEW_WORKER_KEY;
  const bundle = await build({ entryPoints: ["src/app/api/internal/arrears-review-schedules/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "internal-review-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/collections-service$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const processArrearsReviewSchedules=async()=>{__called();return {disabled:true}};" }));
  } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__called", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, () => { calls++; });
  const request = (key: string) => new Request("https://example.invalid/api/internal/arrears-review-schedules", { method: "POST", headers: { authorization: `Bearer ${key}` } });
  try {
    delete process.env.ARREARS_REVIEW_WORKER_KEY; assert.equal((await loaded.exports.POST(request(""))).status, 401);
    process.env.ARREARS_REVIEW_WORKER_KEY = "short"; assert.equal((await loaded.exports.POST(request("short"))).status, 401);
    process.env.ARREARS_REVIEW_WORKER_KEY = "synthetic-internal-review-key-at-least-32-characters";
    assert.equal((await loaded.exports.POST(request("wrong"))).status, 401); assert.equal(calls, 0);
    const response = await loaded.exports.POST(request(process.env.ARREARS_REVIEW_WORKER_KEY));
    assert.equal(response.status, 200); assert.equal((await response.json()).data.disabled, true); assert.equal(calls, 1);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  } finally { if (before === undefined) delete process.env.ARREARS_REVIEW_WORKER_KEY; else process.env.ARREARS_REVIEW_WORKER_KEY = before; }
});

test("generic configuration cannot disclose or overwrite protected operational plan/policy/outbox domains", async () => {
  const hidden = ["COLLECTION_PHONE_NOTICE", "ARREARS_ACCESS_REVIEW_SCHEDULE", "ARREARS_ACCESS_REVIEW_CURSOR", "COLLECTION_SCHEDULE_PLAN", "COLLECTION_SCHEDULE_RUN", "STAFF_EVENT_EMAIL_POLICY", "STAFF_EVENT_EMAIL_OUTBOX"];
  let writes = 0, excluded: string[] = [];
  const database = { configurationProfile: { findMany: async (args: { where: { domain: { notIn: string[] } } }) => { excluded = args.where.domain.notIn; return []; } }, $transaction: async () => { writes++; throw Error("Unexpected write"); }, integrationConnection: { findMany: async () => [] }, chargeDefinition: { findMany: async () => [] }, discountPlan: { findMany: async () => [] }, facility: { findMany: async () => [] }, role: { findMany: async () => [] }, user: { findMany: async () => [] } };
  const bundle = await build({ entryPoints: ["src/app/api/v1/configuration/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "config-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const requirePermission=async()=>({organisationId:'org',user:{id:'owner'},allowedFacilityIds:null});export const authErrorResponse=()=>Response.json({error:'failed'},{status:500});" }));
  } }] });
  const loaded = { exports: {} as { GET: () => Promise<Response>; PUT: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database);
  assert.equal((await loaded.exports.GET()).status, 200); for (const domain of hidden) assert.ok(excluded.includes(domain));
  for (const domain of hidden) assert.equal((await loaded.exports.PUT(new Request("https://example.invalid/api/v1/configuration", { method: "PUT", body: JSON.stringify({ kind: "profile", payload: { domain, name: "forged", status: "APPROVED", config: {} } }) }))).status, 400);
  assert.equal(writes, 0);
});
