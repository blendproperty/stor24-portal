import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("MRI mapping endpoint enforces authentication, organisation scope, mutation authority and audited downloads", async () => {
  const bundle = await build({ stdin: { contents: 'export { GET, POST } from "./src/app/api/v1/billing/mri/mapping/route"; export { state } from "fixture";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "mapping-boundaries", setup(b) {
    const mocks: Record<string, string> = {
      fixture: 'export const state = { auth: true, manage: true, org: true, limited: false, dlpFailure: false, calls: [], guards: 0 };',
      "@/lib/scope": 'import {state} from "fixture"; export async function requirePermissionScope(permission){if(!state.auth)throw new Error("UNAUTHENTICATED");if(permission==="mri.manage"&&!state.manage)throw new Error("FORBIDDEN");return {organisationId:"ci-org",userId:"ci-user",facilityIds:[],unrestrictedFacilities:state.org};}',
      "@/lib/request-security": 'import {state} from "fixture";export const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;export const rateLimit=async()=>state.limited;',
      "@/lib/mri-mapping-service": 'import {state} from "fixture";export async function mriMappingReview(scope){if(!scope.unrestrictedFacilities)throw new Error("MRI_ORG_PERMISSION");return {revision:null,status:"DRAFT",mapping:{entityCode:"",propertyCode:"",basis:"UNDECIDED",scopeNotes:"",rules:[]},approvedAt:null,approvalReference:null};}export async function changeMriMapping(scope,input){state.calls.push(input);return {status:"DRAFT"};}',
      "@/lib/dlp-transfer-service": 'import {state} from "fixture";export async function protectDlpResponse(response,context){state.guards++;if(context.organisationId!=="ci-org")throw new Error("bad scope");if(state.dlpFailure)throw new Error("DLP_TRANSFER_BLOCKED");response.headers.set("x-reviewed","true");return response;}',
    };
    b.onResolve({ filter: /^(fixture|@\/lib\/(scope|request-security|mri-mapping-service|dlp-transfer-service))$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
  } }] });
  const endpoint = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const url = "https://portal.example.invalid/api/v1/billing/mri/mapping";
  const post = (body = '{}', origin = "https://portal.example.invalid") => endpoint.POST(new Request(url, { method: "POST", headers: { origin }, body }));
  assert.equal((await post('{}', "https://other.invalid")).status, 403); assert.equal(endpoint.state.calls.length, 0);
  endpoint.state.auth = false; assert.equal((await endpoint.GET(new Request(url))).status, 401); assert.equal((await post()).status, 401);
  endpoint.state.auth = true; endpoint.state.org = false; assert.equal((await endpoint.GET(new Request(url))).status, 403); assert.equal((await post()).status, 403);
  endpoint.state.org = true; endpoint.state.manage = false;
  const reading = await endpoint.GET(new Request(url)); assert.equal(reading.status, 200); assert.equal((await reading.json()).canManage, false);
  assert.equal((await post()).status, 403); assert.equal(endpoint.state.calls.length, 0);
  endpoint.state.manage = true; endpoint.state.limited = true; assert.equal((await post()).status, 429);
  endpoint.state.limited = false; assert.equal((await post('not json')).status, 400); assert.equal((await post('x'.repeat(64001))).status, 400);
  assert.equal(endpoint.state.calls.length, 0);
  const csv = await endpoint.GET(new Request(url + "?format=csv")); assert.equal(csv.status, 200); assert.equal(csv.headers.get("x-reviewed"), "true"); assert.match(await csv.text(), /NOT an MRI journal import/);
  endpoint.state.dlpFailure = true; const blocked = await endpoint.GET(new Request(url + "?format=csv")); assert.equal(blocked.status, 409); assert.ok(!(await blocked.text()).includes("Movement")); assert.equal(endpoint.state.guards, 2);
  assert.match(blocked.headers.get("cache-control")!, /private, no-store/);
});
