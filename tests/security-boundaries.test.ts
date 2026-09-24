import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

// Execute the real routes, validators, guards and services against synthetic
// records. Only persistence and the signed-session reader are substituted.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (key === "OR") return value.some((v: Row) => matches(row, v));
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("some" in value) return (row[key] ?? []).some((v: Row) => matches(v, value.some));
      if ("none" in value) return !(row[key] ?? []).some((v: Row) => matches(v, value.none));
      return matches(row[key] ?? {}, value);
    }
    return row[key] === value;
  });
}
function fixture() {
  const tables: Record<string, Row[]> = {
    facility: [{ id: "a", organisationId: "org" }, { id: "b", organisationId: "org" }, { id: "foreign", organisationId: "other" }],
    user: [{ id: "staff", organisationId: "org", active: true, sessionVersion: 1, roleAssignments: [] }],
    unitType: [{ id: "type-a", facilityId: "a", name: "Small" }, { id: "type-b", facilityId: "b", name: "Other" }],
    customer: [
      { id: "customer-a", organisationId: "org", leads: [{ facilityId: "a" }], reservations: [], tenancies: [] },
      { id: "customer-b", organisationId: "org", leads: [{ facilityId: "b" }], reservations: [], tenancies: [] },
      { id: "new-own", organisationId: "org", leads: [], reservations: [], tenancies: [] },
      { id: "new-other", organisationId: "org", leads: [], reservations: [], tenancies: [] },
    ],
    auditEvent: [{ id: "audit", organisationId: "org", actorId: "staff", entityType: "Customer", entityId: "new-own", action: "customer.created" }],
    lead: [{ id: "lead-a", facilityId: "a" }], reservation: [], unit: [], integrationIdentityLink: [], accessDecision: [],
  };
  const writes: Row[] = [], queries: Row[] = [];
  const db: Row = {};
  for (const [model, rows] of Object.entries(tables)) db[model] = {
    findFirst: async (args: Row) => { queries.push({ model, ...args }); return rows.find(row => matches(row, args.where)) ?? null; },
    findUnique: async (args: Row) => rows.find(row => matches(row, args.where)) ?? null,
    findMany: async (args: Row) => { queries.push({ model, ...args }); return rows.filter(row => matches(row, args.where)); },
    create: async ({ data }: Row) => { writes.push({ model, data }); return { id: "created", ...data }; },
    update: async ({ where, data }: Row) => { writes.push({ model, where, data }); return { ...rows.find(row => matches(row, where)), ...data }; },
    delete: async (args: Row) => { writes.push({ model, ...args }); return {}; },
  };
  db.$transaction = async (fn: (client: Row) => unknown) => fn(db);
  const session = { userId: "staff", role: "Facility manager", sessionVersion: 1 };
  const grant = (permission: string, facilityId: string | null = "a", name = "Facility manager") => {
    tables.user[0].roleAssignments.push({ facilityId, role: { name, permissions: [permission] } });
  };
  return { db, session, grant, tables, writes, queries };
}

async function load(entry: string, state: ReturnType<typeof fixture>) {
  const output = await build({
    stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "synthetic-persistence", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__fixture.db;" : "export const getSession=async()=>__fixture.session;" }));
    } }],
  });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__fixture", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  return loaded.exports;
}
const scope = { userId: "staff", organisationId: "org", facilityIds: ["a"], unrestrictedFacilities: false };
const context = (resource: string) => ({ params: Promise.resolve({ resource }) });
function request(method: string, body?: unknown) {
  return new Request("https://example.test/api/v1/leasing/leads?id=lead-a", { method, headers: { origin: "https://example.test", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("exact facility intersection denies other and foreign facilities, preserving owner and allowed access", async () => {
  const state = fixture(), api = await load("./src/lib/scope.ts", state);
  assert.equal((await api.requireFacility(scope, "a")).id, "a");
  for (const id of ["b", "foreign", "missing"]) await assert.rejects(api.requireFacility(scope, id), /FORBIDDEN/);
  await assert.rejects(api.requireFacility({ ...scope, facilityIds: [] }, "a"), /FORBIDDEN/);
  assert.equal((await api.requireFacility({ ...scope, unrestrictedFacilities: true }, "b")).id, "b");
  await assert.rejects(api.requireFacility({ ...scope, unrestrictedFacilities: true }, "foreign"), /FORBIDDEN/);
});

test("mixed and organisation-wide unrelated roles cannot widen write scope", async () => {
  const state = fixture(); state.grant("inventory.manage"); state.grant("inventory.view", "b"); state.grant("reports.view", null);
  const api = await load("./src/lib/scope.ts", state);
  assert.deepEqual((await api.requirePermissionScope("inventory.manage")).facilityIds, ["a"]);
  assert.equal((await api.requirePermissionScope("inventory.manage")).unrestrictedFacilities, false);
  await assert.rejects(api.requirePermissionScope("inventory.manage", "b"), /FORBIDDEN/);
});

test("read-only staff cannot mutate leads or create/cancel reservations through real routes", async () => {
  const state = fixture(); state.grant("*.view");
  const api = await load("./src/app/api/v1/leasing/[resource]/route.ts", state);
  for (const resource of ["leads", "reservations"]) for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await api[method](request(method, method === "DELETE" ? undefined : {}), context(resource));
    assert.equal(response.status, 403, `${method} ${resource}`);
  }
  assert.equal(state.writes.length, 0);
});

test("manager can update own unit type but cannot reparent or change another facility", async () => {
  const state = fixture(); state.grant("inventory.manage"); state.grant("inventory.view", "b");
  const api = await load("./src/app/api/v1/leasing/[resource]/route.ts", state);
  for (const body of [{ id: "type-a", data: { facilityId: "b" } }, { id: "type-a", data: { facilityId: "foreign" } }, { id: "type-b", data: { name: "Changed" } }]) {
    assert.equal((await api.PATCH(request("PATCH", body), context("unit-types"))).status, 403);
  }
  assert.equal(state.writes.length, 0);
  assert.equal((await api.PATCH(request("PATCH", { id: "type-a", data: { name: "Updated" } }), context("unit-types"))).status, 200);
  assert.equal(state.writes[0].data.name, "Updated");
});

test("customer boundary preserves own newly created record and rejects unrelated or newly linked records", async () => {
  const state = fixture(), api = await load("./src/lib/leasing-service.ts", state);
  for (const id of ["customer-a", "new-own"]) assert.equal((await api.requireLeasingCustomer(scope, id)).id, id);
  for (const id of ["customer-b", "new-other"]) await assert.rejects(api.requireLeasingCustomer(scope, id), /FORBIDDEN/);
  state.tables.customer.find(c => c.id === "new-own")!.leads.push({ facilityId: "b" });
  await assert.rejects(api.requireLeasingCustomer(scope, "new-own"), /FORBIDDEN/);
  assert.equal((await api.requireLeasingCustomer({ ...scope, unrestrictedFacilities: true }, "customer-b")).id, "customer-b");
});

test("operational staff relations request only safe display fields", async () => {
  const state = fixture(), api = await load("./src/lib/mel-integration-status-service.ts", state);
  await api.listIdentityLinks(scope); await api.listAccessDecisions(scope);
  assert.deepEqual(state.queries[0].include.resolvedBy, { select: { id: true, name: true } });
  assert.deepEqual(state.queries[1].include.requestedBy, { select: { id: true, name: true } });
});

test("existing sessions lose access after revocation, deactivation or removal of current grants", async () => {
  const state = fixture();
  state.grant("billing.view");
  const guards = await load("./src/lib/auth-guards.ts", state);
  assert.equal((await guards.requirePermission("billing.view", "a")).userId, "staff");
  state.tables.user[0].sessionVersion = 2;
  await assert.rejects(guards.requireSession(), /UNAUTHENTICATED/);
  state.tables.user[0].sessionVersion = 1;
  state.tables.user[0].active = false;
  await assert.rejects(guards.requireSession(), /UNAUTHENTICATED/);
  state.tables.user[0].active = true;
  state.tables.user[0].roleAssignments = [];
  await assert.rejects(guards.requirePermission("billing.view", "a"), /FORBIDDEN/);
  state.tables.user.length = 0;
  await assert.rejects(guards.requireSession(), /UNAUTHENTICATED/);
});

test("an old owner role in the session cannot retain owner authority", async () => {
  const state = fixture();
  state.session.role = "Organisation owner";
  state.grant("operations.view");
  const guards = await load("./src/lib/auth-guards.ts", state);
  await assert.rejects(guards.requireOwner(), /FORBIDDEN/);
  assert.equal((await guards.requireSession()).role, "Facility manager");
  state.tables.user[0].roleAssignments = [];
  state.grant("*", null, "Organisation owner");
  assert.equal((await guards.requireOwner()).userId, "staff");
  state.tables.user[0].roleAssignments = [];
  await assert.rejects(guards.requireOwner(), /FORBIDDEN/);
});
