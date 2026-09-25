import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { moveOutSchema } from "../src/lib/validators";


const base = { tenancyId: "synthetic-tenancy", movedOutAt: new Date(), finalCharge: 0, depositAction: "NONE", depositAmount: 0, idempotencyKey: "synthetic-move-out", notes: "Synthetic final settlement" };
test("move-out money is exact cents within existing limits", async () => {
  for (const value of [0.005, 1.001, 0.000001, -1, 10_000_000.01, Infinity, NaN]) {
    assert.equal(moveOutSchema.safeParse({ ...base, finalCharge: value }).success, false);
    assert.equal(moveOutSchema.safeParse({ ...base, depositAction: "REFUND_DUE", depositAmount: value }).success, false);
  }
  for (const value of [0, 0.01, 0.29, 100.99, 10_000_000]) assert.equal(moveOutSchema.safeParse({ ...base, finalCharge: value }).success, true);
  assert.equal(moveOutSchema.parse({ ...base, finalCharge: "0.29", depositAction: "APPLY_TO_BALANCE", depositAmount: "10.01" }).depositAmount, 10.01);

});
test("direct move-out rejects invalid amounts before reads, access or writes", async () => {
  let calls = 0;
  const database = new Proxy({}, { get() { calls++; throw Error("DATABASE_REACHED"); } });
  const output = await build({ stdin: { contents: 'export {moveOut} from "./src/lib/leasing-service";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-money", setup(b) {
    b.onResolve({ filter: /^@\/lib\/db$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const db=__db;" }));
  } }] });
  const loaded = { exports: {} as { moveOut: (scope: unknown, input: unknown) => Promise<unknown> } };
  new Function("require", "module", "exports", "__db", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database);
  for (const patch of [{ finalCharge: 0.005 }, { depositAction: "REFUND_DUE", depositAmount: 0.005 }, { depositAction: "NONE", depositAmount: 1 }]) {
    await assert.rejects(loaded.exports.moveOut({}, { ...base, ...patch }), e => e instanceof Error && e.name === "ZodError");
  }
  assert.equal(calls, 0);
});
test("move-out endpoint returns field validation before invoking the workflow", async () => {
  const output = await build({ stdin: { contents: 'export {POST} from "./src/app/api/v1/leasing/workflows/[action]/route";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-route", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(leasing-service|scope|blendsign-lease-service|db)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db={};" : a.path.endsWith("/scope") ? 'export const requirePermissionScope=()=>{throw Error("AUTH_REACHED")}' : a.path.endsWith("/blendsign-lease-service") ? 'export const dispatchBlendSignLease=()=>{throw Error("PROVIDER_REACHED")}' : 'export const moveOut=()=>{throw Error("WORKFLOW_REACHED")};export const moveIn=moveOut,transfer=moveOut,giveNotice=moveOut;' }));
  } }] });
  const loaded = { exports: {} as { POST: (r: Request, c: unknown) => Promise<Response> } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const response = await loaded.exports.POST(new Request("http://localhost/api/v1/leasing/workflows/move-out", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ ...base, finalCharge: 0.005 }) }), { params: Promise.resolve({ action: "move-out" }) });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.fields.finalCharge.length);
});