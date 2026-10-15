import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("staff email API authenticates before filters, rejects CSRF/direct sends and returns only safe errors", async () => {
  let authenticated = false, sameOrigin = true, calls = 0, crash = false;
  const bundle = await build({ entryPoints: ["src/app/api/v1/operations/event-emails/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "staff-email-api-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(scope|request-security|staff-event-email-source|staff-event-email-service)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/scope") ? `export const requirePermissionScope=async permission=>{if(permission!=='staff_event_emails.view')throw Error('BAD_PERMISSION');if(!__authenticated())throw Error('UNAUTHENTICATED');return {userId:'staff'}};` : a.path.endsWith("/request-security") ? "export const sameOrigin=()=>__sameOrigin();" : a.path.endsWith("/staff-event-email-source") ? `export const STAFF_EMAIL_VIEW='staff_event_emails.view';` : `const run=async()=>{__called();return {safe:true}};export const readStaffEventEmails=run,previewStaffEventEmail=run,prepareStaffEventEmail=run,reviewStaffEventEmail=run,evaluateStaffEventEmail=run;` }));
  } }] });
  const loaded = { exports: {} as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__authenticated", "__sameOrigin", "__called", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, () => authenticated, () => sameOrigin, () => { calls++; if (crash) throw Error("private database recipient@example.invalid token=secret"); });
  const get = () => new Request("https://example.invalid/api/v1/operations/event-emails");
  assert.equal((await loaded.exports.GET(get())).status, 401); assert.equal(calls, 0);
  authenticated = true;
  assert.equal((await loaded.exports.GET(new Request(`${get().url}?enabled=true`))).status, 422); assert.equal(calls, 0);
  assert.equal((await loaded.exports.GET(get())).status, 200); assert.equal(calls, 1);
  const post = (body: unknown) => new Request(get().url, { method: "POST", body: JSON.stringify(body) });
  sameOrigin = false; assert.equal((await loaded.exports.POST(post({ action: "send" }))).status, 403); assert.equal(calls, 1);
  sameOrigin = true; assert.equal((await loaded.exports.POST(post({ action: "send" }))).status, 422); assert.equal(calls, 1);
  crash = true; const failed = await loaded.exports.GET(get()); assert.equal(failed.status, 500); assert.doesNotMatch(await failed.text(), /private database|recipient@|secret/); assert.match(failed.headers.get("cache-control")!, /no-store/);
});

test("worker endpoint requires a strong exact private key before calling its default-off dispatcher", async () => {
  let calls = 0; const before = process.env.STAFF_EVENT_EMAIL_WORKER_KEY;
  const bundle = await build({ entryPoints: ["src/app/api/internal/staff-event-emails/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "worker-fixture", setup(b) { b.onResolve({ filter: /staff-event-email-worker$/ }, a => ({ path: a.path, namespace: "fixture" })); b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const processStaffEventEmail=async()=>{__called();return {disabled:true}};" })); } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__called", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, () => { calls++; });
  const request = (key: string) => new Request("https://example.invalid/api/internal/staff-event-emails", { method: "POST", headers: { authorization: `Bearer ${key}` } });
  try {
    delete process.env.STAFF_EVENT_EMAIL_WORKER_KEY; assert.equal((await loaded.exports.POST(request(""))).status, 401);
    process.env.STAFF_EVENT_EMAIL_WORKER_KEY = "isolated-worker-key-12345678901234567890";
    assert.equal((await loaded.exports.POST(request("wrong"))).status, 401); assert.equal(calls, 0);
    assert.equal((await loaded.exports.POST(request(process.env.STAFF_EVENT_EMAIL_WORKER_KEY))).status, 200); assert.equal(calls, 1);
  } finally { if (before === undefined) delete process.env.STAFF_EVENT_EMAIL_WORKER_KEY; else process.env.STAFF_EVENT_EMAIL_WORKER_KEY = before; }
});

test("generic configuration cannot disclose or overwrite protected staff email policy/outbox domains", async () => {
  const hidden = ["STAFF_EVENT_EMAIL_POLICY", "STAFF_EVENT_EMAIL_OUTBOX"];
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
