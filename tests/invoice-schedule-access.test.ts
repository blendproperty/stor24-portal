import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("schedule changes require the separate permission for the requested store", async () => {
  const result = await build({ stdin: { contents: 'export { POST } from "./src/app/api/v1/billing/invoice-schedule/route"; export { state } from "fixture";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "boundaries", setup(b) {
    const mocks: Record<string, string> = {
      fixture: 'export const state={grants:[],calls:[]};',
      "@/lib/scope": 'import {state} from "fixture"; export async function requirePermissionScope(p,f){if(!state.grants.some(g=>g[0]===p&&g[1]===f))throw Error("FORBIDDEN");return {facilityIds:[f]}}',
      "@/lib/request-security": 'export const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;',
      "@/lib/auth-guards": 'export const authErrorResponse=()=>new Response(null,{status:403});',
      "@/lib/invoice-schedule": 'import {state} from "fixture"; export async function saveInvoiceSchedule(s,f,v){state.calls.push([f,v]);return v} export async function readInvoiceSchedule(){}',
    };
    b.onResolve({filter:/^(fixture|@\/lib\/(scope|request-security|invoice-schedule|auth-guards))$/}, a => ({path:a.path,namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"}, a => ({contents:mocks[a.path]}));
  }}] });
  const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const facility = "claaaaaaaaaaaaaaaaaaaaaaa", other = "clbbbbbbbbbbbbbbbbbbbbbbb", url = "https://portal.example.invalid/api/v1/billing/invoice-schedule";
  const post = (id: string, origin = "https://portal.example.invalid") => api.POST(new Request(url, {method:"POST",headers:{origin},body:JSON.stringify({facilityId:id,date:"2026-11-17"})}));
  api.state.grants = [["billing.manage",facility],["configuration.manage",facility],["billing.schedule.manage",other]];
  assert.equal((await post(facility)).status,403);
  api.state.grants.push(["billing.schedule.manage",facility]);
  assert.equal((await post(facility,"https://other.invalid")).status,403);
  assert.equal((await post(facility)).status,200);
  assert.deepEqual(api.state.calls,[[facility,{date:"2026-11-17"}]]);
});
