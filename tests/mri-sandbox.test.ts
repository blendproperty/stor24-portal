import assert from "node:assert/strict";
import test from "node:test";
import { verifyMriAccess } from "../src/lib/integrations/mri-provider";
import { build } from "esbuild";

test("sandbox provider check refuses missing, ambiguous, renamed or changed target before property read", async () => {
  for (const discovery of [[], [{ DatabaseName: "Blend", DatabaseIdentifier: "ci-test" }], [{ DatabaseName: "BlendTest", DatabaseIdentifier: "changed" }], [{ DatabaseName: "BlendTest", DatabaseIdentifier: "ci-test" }, { DatabaseName: "BlendTest", DatabaseIdentifier: "duplicate" }]]) {
    let reads = 0;
    await assert.rejects(verifyMriAccess({ login: "ci", password: "ci", databaseIdentifier: "ci-test", expectedDatabaseLabel: "BlendTest" }, async url => {
      if (String(url).endsWith("/Token")) return Response.json({ access_token: "ci-token", token_type: "Bearer" });
      if (String(url).endsWith("GetDatabaseAccessList")) return Response.json(discovery);
      reads++; return Response.json({ ResultCount: 1, ResultSet: [] });
    }), /MRI_SANDBOX_TARGET/);
    assert.equal(reads, 0);
  }
});
test("sandbox endpoint denies scope, origin, live-target injection and unbounded requests", async () => {
  const bundle = await build({ stdin: { contents: 'export { GET, POST } from "./src/app/api/v1/billing/mri/sandbox/route"; export { state } from "fixture";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "sandbox-boundary", setup(b) {
    const mocks: Record<string, string> = {
      fixture: 'export const state={auth:true,manage:true,org:true,limited:false,calls:[]};',
      "@/lib/scope": 'import{state}from"fixture";export async function requirePermissionScope(p){if(!state.auth)throw Error("UNAUTHENTICATED");if(p==="mri.manage"&&!state.manage)throw Error("FORBIDDEN");return{organisationId:"ci",userId:"ci",unrestrictedFacilities:state.org,facilityIds:[]};}',
      "@/lib/request-security": 'import{state}from"fixture";export const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;export const rateLimit=async()=>state.limited;',
      "@/lib/mri-service": 'import{state}from"fixture";export async function mriSandboxWorkspace(s){if(!s.unrestrictedFacilities)throw Error("MRI_ORG_PERMISSION");return{target:"BlendTest",postingEnabled:false};}export const prepareStoredMriSandbox=async(s,c)=>{state.calls.push(c);return{target:"BlendTest"};};export const checkMriConnection=async(s,r,f,l)=>{state.calls.push({revision:r,lane:l});};',
    };
    b.onResolve({filter:/^(fixture|@\/lib\/(scope|request-security|mri-service))$/},args=>({path:args.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:mocks[args.path]}));
  } }] });
  const endpoint = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const url = "https://portal.example.invalid/api/v1/billing/mri/sandbox", revision = "2026-10-13T07:00:00.000Z";
  const post = (input: unknown, origin = "https://portal.example.invalid") => endpoint.POST(new Request(url, { method: "POST", headers: { origin }, body: typeof input === "string" ? input : JSON.stringify(input) }));
  assert.equal((await post({}, "https://other.invalid")).status, 403);
  endpoint.state.auth = false; assert.equal((await endpoint.GET()).status, 401);
  endpoint.state.auth = true; endpoint.state.org = false; assert.equal((await endpoint.GET()).status, 403); assert.equal((await post({action:"check",revision})).status,403);
  endpoint.state.org = true; endpoint.state.manage = false; assert.equal((await endpoint.GET()).status, 200); assert.equal((await post({action:"check",revision})).status,403);
  endpoint.state.manage = true;
  for (const injection of [{action:"save",environment:"live"},{action:"check",revision,databaseIdentifier:"live-id"},{action:"prepare",revision:null,sourceRevision:revision,endpoint:"https://other.invalid"},"x".repeat(3001)]) assert.equal((await post(injection)).status,400);
  assert.equal(endpoint.state.calls.length, 0);
  endpoint.state.limited = true; assert.equal((await post({action:"check",revision})).status,429); endpoint.state.limited = false;
  const result = await post({action:"check",revision}); assert.equal(result.status,200); assert.deepEqual(endpoint.state.calls,[{revision,lane:"sandbox"}]); assert.match(result.headers.get("cache-control")!,/private, no-store/);
});
