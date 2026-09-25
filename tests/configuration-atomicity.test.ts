import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

type Row = Record<string, unknown>;
const payloads = [
  { kind: "profile", payload: { domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY", config: { defaults: { Payments: { receiptPrinting: "prompt" } } } } },
  { kind: "integration", payload: { category: "PHONE", provider: "Synthetic", status: "CONFIGURED", config: { notes: "Synthetic" } } },
  { kind: "charge", payload: { code: "TEST", name: "Synthetic charge", amount: 1 } },
  { kind: "discount", payload: { code: "TEST", name: "Synthetic discount", discountType: "FIXED", value: 1, rules: {} } },
];

async function fixture(existing: boolean) {
  const state = { rows: existing ? [{ id: "setting", name: "Original" }] as Row[] : [] as Row[], audits: [] as Row[], failAudit: true, allowed: true };
  const client = (data: typeof state) => {
    const delegate = {
      findFirst: async () => data.rows[0] ?? null,
      create: async ({ data: input }: { data: Row }) => { const saved = { id: "setting", ...input }; data.rows.push(saved); return saved; },
      update: async ({ data: input }: { data: Row }) => { const saved = { ...data.rows[0], ...input }; data.rows[0] = saved; return saved; },
      upsert: async ({ create, update }: { create: Row; update: Row }) => {
        const saved = data.rows.length ? { ...data.rows[0], ...update } : { id: "setting", ...create }; data.rows.splice(0, data.rows.length, saved); return saved;
      },
    };
    return { configurationProfile: delegate, integrationConnection: delegate, chargeDefinition: delegate, discountPlan: delegate, auditEvent: { create: async ({ data: input }: { data: Row }) => { if (state.failAudit) throw Error("SYNTHETIC_AUDIT_FAILURE"); data.audits.push(input); return input; } } };
  };
  const database = { ...client(state), $transaction: async (callback: (tx: ReturnType<typeof client>) => Promise<unknown>) => {
    const pending = structuredClone(state); const result = await callback(client(pending)); state.rows = pending.rows; state.audits = pending.audits; return result;
  } };
  const output = await build({ entryPoints: ["src/app/api/v1/configuration/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-configuration", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const requirePermission=async()=>{if(!__state.allowed)throw Error('FORBIDDEN');return {organisationId:'org',user:{id:'actor'}}}; export const authErrorResponse=e=>Response.json({error:e.message},{status:e.message==='FORBIDDEN'?403:500});" }));
  } }] });
  const loaded = { exports: {} as { PUT: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database, state);
  return { state, send: (body: unknown) => loaded.exports.PUT(new Request("https://example.invalid/api/v1/configuration", { method: "PUT", body: JSON.stringify(body) })) };
}

test("configuration saves roll back when their audit fails, then recover with one audit", async () => {
  for (const body of payloads) for (const existing of [false, true]) {
    const f = await fixture(existing); const before = structuredClone(f.state.rows);
    assert.equal((await f.send(body)).status, 500);
    assert.deepEqual(f.state.rows, before, `${body.kind} must roll back ${existing ? "update" : "create"}`);
    assert.equal(f.state.audits.length, 0);
    f.state.failAudit = false;
    const response = await f.send(body); assert.equal(response.status, 200);
    assert.equal(f.state.rows.length, 1); assert.equal(f.state.audits.length, 1);
    assert.deepEqual((await response.json()).data, JSON.parse(JSON.stringify(f.state.rows[0])));
    assert.equal(f.state.audits[0].actorId, "actor"); assert.equal(f.state.audits[0].organisationId, "org");
  }
});

test("denied and dedicated-provider configuration paths never write", async () => {
  const f = await fixture(false); f.state.failAudit = false; f.state.allowed = false;
  assert.equal((await f.send(payloads[0])).status, 403);
  f.state.allowed = true;
  assert.equal((await f.send({ kind: "integration", payload: { category: "ACCESS_CONTROL", provider: "HIKCENTRAL", config: {} } })).status, 400);
  assert.equal((await f.send({ kind: "unsupported" })).status, 400);
  assert.equal(f.state.rows.length, 0); assert.equal(f.state.audits.length, 0);
});
