import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

type Row = Record<string, unknown>;
const facilityId="cfacility00000000000000001", unitId="cunit000000000000000000001", productId="cproduct000000000000000001";
const payloads=[
 {kind:"task",payload:{title:"Synthetic task"}},
 {kind:"unitNote",payload:{facilityId,unitId,note:"Synthetic note"}},
 {kind:"product",payload:{facilityId,sku:"SYN",name:"Synthetic box",category:"BOX",costPrice:1,sellingPrice:2}},
 {kind:"storagePackage",payload:{facilityId,code:"SYN",name:"Synthetic pack",description:"Synthetic package description",sellingPrice:2,items:[{productId,quantity:1}]}},
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
    return { task: delegate, unitNote: delegate, product: { ...delegate, count: async () => 1 }, storagePackage: delegate, facility: { count: async () => 1 }, unit: { findFirst: async () => ({id: unitId}) }, auditEvent: { create: async ({ data: input }: { data: Row }) => { if (state.failAudit) throw Error("SYNTHETIC_AUDIT_FAILURE"); data.audits.push(input); return input; } } };
  };
  const database = { ...client(state), $transaction: async (callback: (tx: ReturnType<typeof client>) => Promise<unknown>) => {
    const pending = structuredClone(state); const result = await callback(client(pending)); state.rows = pending.rows; state.audits = pending.audits; return result;
  } };
  const output = await build({ entryPoints: ["src/app/api/v1/operations/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-configuration", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : "export const requirePermission=async()=>{if(!__state.allowed)throw Error('FORBIDDEN');return {organisationId:'org',user:{id:'actor'}}}; export const authErrorResponse=e=>Response.json({error:e.message},{status:e.message==='FORBIDDEN'?403:500});" }));
  } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__db", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database, state);
  return { state, send: (body: unknown) => loaded.exports.POST(new Request("https://example.invalid/api/v1/configuration", { method: "POST", body: JSON.stringify(body) })) };
}

test("operations creation rolls back on audit failure and recovers without orphan rows",async()=>{
 for(const body of payloads){
  const f=await fixture(false);
  assert.equal((await f.send(body)).status,500);
  assert.deepEqual(f.state.rows,[],`${body.kind}: failed audit must not retain record`);assert.equal(f.state.audits.length,0);
  f.state.failAudit=false;const response=await f.send(body);assert.equal(response.status,201);
  assert.equal(f.state.rows.length,1);assert.equal(f.state.audits.length,1);
  assert.equal(f.state.audits[0].action,`${body.kind}.create`);assert.equal(f.state.audits[0].actorId,"actor");
  assert.deepEqual((await response.json()).data,JSON.parse(JSON.stringify(f.state.rows[0])));
 }
});
test("denied operations creation never writes",async()=>{
 for(const body of payloads){const f=await fixture(false);f.state.failAudit=false;f.state.allowed=false;assert.equal((await f.send(body)).status,403);assert.equal(f.state.rows.length,0);assert.equal(f.state.audits.length,0);}
});
