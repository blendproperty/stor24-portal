import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

async function fixture() {
  let rows: { count: number }[] = [], failed = false, calls = 0;
  const database = new Proxy({}, { get(_target, name) {
    if (name !== "$queryRaw") throw Error(`UNEXPECTED_DATABASE_WORK:${String(name)}`);
    return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls++;
      assert.ok(strings.join("?").includes('ON CONFLICT ("key") DO UPDATE'));
      assert.ok(!strings.join("?").includes("synthetic-key"));
      assert.ok(values.length > 0);
      if (failed) throw Error("DATABASE_UNAVAILABLE");
      return rows;
    };
  } });
  const out = await build({ stdin: { contents: 'export {rateLimit} from "./src/lib/request-security";export {POST as login} from "./src/app/api/auth/login/route";export {POST as forgot} from "./src/app/api/auth/forgot-password/route";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "rate-limit-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/db$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const db=__db;" }));
  } }] });
  const loaded = { exports: {} as { rateLimit: (key: string, limit: number, window: number) => Promise<boolean>; login: (r: Request) => Promise<Response>; forgot: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", out.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database);
  return { ...loaded.exports, setRows: (value: { count: number }[]) => { rows = value; }, fail: () => { failed = true; }, calls: () => calls };
}
const request = (body: unknown) => new Request("http://localhost/api/auth/login", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": "192.0.2.1" }, body: JSON.stringify(body) });
test("atomic limiter preserves polarity, validates internal limits and propagates database failure", async () => {
  const f = await fixture();
  assert.equal(await f.rateLimit("synthetic-key", 5, 60_000), true);
  f.setRows([{ count: 1 }]); assert.equal(await f.rateLimit("synthetic-key", 5, 60_000), false);
  const before = f.calls();
  for (const [limit, window] of [[0, 1], [-1, 1], [1.5, 1], [2_147_483_648, 1], [1, 0], [1, NaN], [1, Number.MAX_SAFE_INTEGER]]) await assert.rejects(f.rateLimit("synthetic-key", limit, window), /INVALID_RATE_LIMIT/);
  assert.equal(f.calls(), before);
  f.fail(); await assert.rejects(f.rateLimit("synthetic-key", 5, 60_000), /DATABASE_UNAVAILABLE/);
});
test("limited login stops before credential work and reset retains generic response", async () => {
  const f = await fixture();
  assert.equal((await f.login(request({ email: "synthetic@example.invalid", password: "invented-password" }))).status, 429);
  const reset = await f.forgot(request({ email: "synthetic@example.invalid" }));
  assert.equal(reset.status, 200); assert.match((await reset.json()).data.message, /If an active account matches/);
  f.setRows([{ count: 1 }]);
  assert.equal((await f.login(request({ email: "invalid", password: "" }))).status, 401);
  f.fail(); await assert.rejects(f.login(request({})), /DATABASE_UNAVAILABLE/);
});