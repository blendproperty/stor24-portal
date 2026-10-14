import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
test("card subscription endpoints require tenant ownership, origin, strict source-only inputs, rate limits and explicit enrollment/cancellation consent", async () => {
  const state = { auth: true, origin: true, limited: false, calls: [] as string[] };
  const global = globalThis as typeof globalThis & { cardRouteFixture?: typeof state }; global.cardRouteFixture = state;
  const mocks: Record<string, string> = {
    "@/lib/tenant-portal-auth": `export async function requireTenantSession(){if(!globalThis.cardRouteFixture.auth)throw Error('TENANT_UNAUTHENTICATED');return{organisationId:'synthetic-org',email:'synthetic@example.invalid',customerIds:['synthetic-customer'],tokenHash:'synthetic-token'}}export async function tenantRateLimit(){return globalThis.cardRouteFixture.limited}`,
    "@/lib/request-security": `export const sameOrigin=()=>globalThis.cardRouteFixture.origin`,
    "@/lib/payments/card-autopay-service": `const run=n=>async(...args)=>{if(args[0].customerIds[0]!=='synthetic-customer')throw Error('TENANT_NOT_FOUND');globalThis.cardRouteFixture.calls.push(n);return{status:'REQUESTED'}};export const previewCardAutopayRequest=run('request-preview'),saveCardAutopayRequest=run('request-save'),withdrawCardAutopayRequest=run('withdraw')`,
    "@/lib/payments/card-autopay-enrollment-service": `const run=n=>async(...args)=>{if(args[0].organisationId!=='synthetic-org')throw Error('TENANT_NOT_FOUND');globalThis.cardRouteFixture.calls.push(n);return{status:'test-fixture'}};export const cardSandboxPreparationAvailable=run('availability'),cardSubscriptionSnapshot=run('snapshot'),previewCardEnrollment=run('enrollment-preview'),issueCardEnrollment=run('enroll'),previewCardCancellation=run('cancellation-preview'),cancelCardSubscription=run('cancel')`,
  };
  const result = await build({ entryPoints: ["src/app/api/tenant/card-subscriptions/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-route", setup(builder) { builder.onResolve({ filter: /^@\/lib\// }, args => mocks[args.path] ? { path: args.path, namespace: "fixture" } : undefined); builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" })); } }] });
  const compiled = { exports: {} as { POST: (request: Request) => Promise<Response>; GET: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  const post = (body: unknown) => compiled.exports.POST(new Request("https://portal.example.invalid/api/tenant/card-subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const body = { action: "enroll", accountId: "synthetic-account", documentId: "synthetic-document", fingerprint: "a".repeat(64), accepted: true };
  const good = await post(body); assert.equal(good.status, 200); assert.match(good.headers.get("cache-control") ?? "", /private, no-store/); assert.equal(state.calls.at(-1), "enroll");
  const count = state.calls.length;
  for (const extra of [{ amount: "1.00" }, { environment: "live" }, { originalReference: "foreign" }, { serviceKey: "untrusted" }, { methodCode: "1" }]) assert.equal((await post({ ...body, ...extra })).status, 422);
  assert.equal((await post({ ...body, accepted: false })).status, 422);
  assert.equal((await post({ ...body, documentId: "x".repeat(5000) })).status, 422);
  assert.equal(state.calls.length, count);
  state.auth = false; assert.equal((await post(body)).status, 401); assert.equal((await compiled.exports.GET(new Request("https://portal.example.invalid/api/tenant/card-subscriptions?accountId=synthetic-account"))).status, 401);
  state.auth = true; state.origin = false; assert.equal((await post(body)).status, 404);
  state.origin = true; state.limited = true; assert.equal((await post(body)).status, 429); assert.equal(state.calls.length, count);
  state.limited = false;
  assert.equal((await post({ action: "cancel", subscriptionId: "synthetic-subscription", fingerprint: "a".repeat(64), accepted: false })).status, 422);
  assert.equal((await post({ action: "cancel", subscriptionId: "synthetic-subscription", fingerprint: "a".repeat(64), accepted: true })).status, 200); assert.equal(state.calls.at(-1), "cancel");
  const read = await compiled.exports.GET(new Request("https://portal.example.invalid/api/tenant/card-subscriptions?accountId=synthetic-account")); assert.equal(read.status, 200); assert.equal(state.calls.at(-1), "snapshot");
  delete global.cardRouteFixture;
});
