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
  const writes: Row[] = [], queries: Row[] = [], sends: unknown[][] = [];
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
  return { db, session, grant, tables, writes, queries, sends };
}

async function load(entry: string, state: ReturnType<typeof fixture>) {
  const output = await build({
    stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "synthetic-persistence", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__fixture.db;" : "export const getSession=async()=>__fixture.session;" }));
      builder.onResolve({ filter: /^@\/lib\/integrations\/twilio-provider$/ }, args => ({ path: args.path, namespace: "provider" }));
      builder.onLoad({ filter: /.*/, namespace: "provider" }, () => ({ contents: "export class TwilioWhatsAppProvider { async sendTemplate(...args) { __fixture.sends.push(args); return {ok:true,providerReference:'synthetic-message'}; } }" }));
    } }],
  });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__fixture", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  return loaded.exports;
}

test("manual WhatsApp send and retry authorize the recipient independently of the supplied facility", async () => {
  const state = fixture(); state.grant("operations.manage"); state.grant("reports.view", null);
  for (const customer of state.tables.customer) Object.assign(customer, { phone: "+27820000000", communicationConsent: { whatsapp: true } });
  const log: Row = { id: "failed", organisationId: "org", channel: "WHATSAPP", status: "FAILED", facilityId: null, customerId: "customer-b", customer: state.tables.customer[1], messageType: "PAYMENT_REMINDER", metadata: { variables: {} }, idempotencyKey: "synthetic-failed-message", attempts: 0, providerRef: "SMsynthetic", failedAt: new Date(), failureCode: "DELIVERY_FAILED" };
  state.db.communicationLog = {
    findFirst: async ({ where }: Row) => matches(log, where) ? log : null,
    findUnique: async () => null,
    create: async ({ data }: Row) => { state.writes.push({ model: "communicationLog", data }); return { id: "sent", ...data }; },
    update: async ({ data }: Row) => { state.writes.push({ model: "communicationLog", data }); return log; },
    updateMany: async ({ data }: Row) => { state.writes.push({ model: "communicationLog", data }); return { count: 1 }; },
  };
  const envKey = "TWILIO_WHATSAPP_PAYMENT_REMINDER_SID", previous = process.env[envKey];
  process.env[envKey] = "HXsynthetic";
  try {
    const sendApi = await load("./src/app/api/v1/communications/send-whatsapp/route.ts", state);
    const retryApi = await load("./src/app/api/v1/communications/retry-whatsapp/route.ts", state);
    const send = (customerId = "customer-b", facilityId = "a") => sendApi.POST(request("POST", { customerId, facilityId, messageType: "PAYMENT_REMINDER", variables: {}, idempotencyKey: "synthetic-request-key" }));
    const retry = () => retryApi.POST(request("POST", { logId: "failed" }));
    assert.equal((await send()).status, 403);
    assert.equal((await retry()).status, 403);
    assert.equal(state.sends.length, 0); assert.equal(state.writes.length, 0);
    for (const id of ["customer-a", "new-own"]) assert.equal((await send(id)).status, 202);
    assert.equal((await send("new-other")).status, 403);
    log.customerId = "customer-a"; log.customer = state.tables.customer[0];
    assert.equal((await retry()).status, 202);
    for (const facilityId of ["b", "foreign", "missing"]) {
      assert.equal((await send("customer-a", facilityId)).status, 403);
      log.facilityId = facilityId; assert.equal((await retry()).status, 403);
    }
    assert.equal(state.sends.length, 3);
    for (const role of ["Operations administrator", "Organisation owner"]) {
      state.tables.user[0].roleAssignments = []; state.grant("operations.manage", null, role);
      assert.equal((await send("customer-b", "b")).status, 202);
      assert.equal((await send("customer-b", "foreign")).status, 403);
    }
    state.tables.customer[1].organisationId = "other"; log.customerId = "customer-b"; log.customer = state.tables.customer[1]; log.facilityId = "a";
    assert.equal((await send()).status, 403); assert.equal((await retry()).status, 403);
    state.tables.user[0].roleAssignments = []; state.grant("operations.manage"); state.grant("operations.manage", "b");
    state.tables.customer[1].organisationId = "org";
    assert.equal((await send()).status, 202); // Customer is within the actor's overall operations scope.
    state.tables.customer[0].communicationConsent = { whatsapp: false };
    assert.equal((await send("customer-a")).status, 409);
    state.tables.customer[0].communicationConsent = { whatsapp: true, optedOutAt: "2026-01-01" };
    assert.equal((await send("customer-a")).status, 409);
    state.tables.customer[0].phone = null;
    assert.equal((await send("customer-a")).status, 404);
    for (const mutate of [() => { state.tables.user[0].roleAssignments = []; }, () => { state.tables.user[0].sessionVersion = 2; }, () => { state.tables.user.length = 0; }]) {
      mutate(); assert.ok([401, 403].includes((await send()).status)); assert.ok([401, 403].includes((await retry()).status));
    }
    assert.equal(state.sends.length, 6);
  } finally { if (previous === undefined) delete process.env[envKey]; else process.env[envKey] = previous; }
});
test("account document metadata stays inside the actor organisation and facility grants", async () => {
  const state = fixture();
  const account = { id: "account", customer: { organisationId: "other" }, tenancy: { id: "tenancy", facilityId: "foreign" } };
  state.db.account = { findFirst: async ({ where }: Row) => matches(account, where) ? account : null };
  let documentReads = 0;
  state.db.document = { findMany: async (query: Row) => {
    documentReads++;
    assert.deepEqual(query, { where: { tenancyId: "tenancy", type: { in: ["INVOICE", "STATEMENT"] } }, select: { id: true, type: true, status: true, sentAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
    return [{ id: "document", type: "INVOICE", status: "SENT", sentAt: null, createdAt: "2026-01-01" }];
  } };
  const api = await load("./src/app/api/v1/accounts/[id]/documents/route.ts", state);
  const read = (id = "account") => api.GET(request("GET"), { params: Promise.resolve({ id }) });
  for (const role of ["Ledger reader", "Organisation owner"]) {
    state.tables.user[0].roleAssignments = [];
    state.grant("ledger.view", null, role);
    assert.equal((await read()).status, 404, role);
    assert.equal(documentReads, 0);
  }
  account.customer.organisationId = "org"; account.tenancy.facilityId = "b";
  assert.equal((await read()).status, 200);
  state.tables.user[0].roleAssignments = []; state.grant("ledger.view", null);
  assert.equal((await read()).status, 200);
  state.tables.user[0].roleAssignments = []; state.grant("ledger.view", "a"); state.grant("reports.view", null);
  assert.equal((await read()).status, 403); assert.equal(documentReads, 2);
  account.tenancy.facilityId = "a";
  assert.deepEqual((await (await read()).json()).data.documents.map((d: Row) => d.id), ["document"]);
  assert.equal((await read("missing")).status, 404);
  state.tables.user[0].roleAssignments = [];
  assert.equal((await read()).status, 403);
  state.tables.user[0].active = false;
  assert.equal((await read()).status, 401);
  state.tables.user[0].active = true; state.tables.user[0].sessionVersion = 2;
  assert.equal((await read()).status, 401);
  state.tables.user.length = 0;
  assert.equal((await read()).status, 401);
  assert.equal(documentReads, 3); assert.equal(state.writes.length, 0);
});

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

test("operations response limits every staff relation to display identity", async () => {
  const state = fixture(); state.grant("operations.view");
  const privateStaff = { id: "reviewer", name: "Synthetic reviewer", email: "private@example.invalid", passwordHash: "synthetic-private-hash", sessionVersion: 9, passwordChangedAt: new Date() };
  const relations = [["task", "assignee", "tasks"], ["unitNote", "author", "notes"], ["maintenanceRequest", "assignedTo", "maintenance"], ["dailyClose", "closedBy", "dailyCloses"]];
  for (const [model, relation] of relations) state.db[model] = { findMany: async (args: Row) => {
    assert.equal(args.where.organisationId, "org");
    assert.deepEqual(args.where.facilityId, { in: ["a"] });
    const selection = args.include[relation];
    const staff = selection === true ? privateStaff : Object.fromEntries(Object.keys(selection.select).filter(key => selection.select[key]).map(key => [key, privateStaff[key as keyof typeof privateStaff]]));
    return [{ id: model, [relation]: staff }, { id: `${model}-unassigned`, [relation]: null }];
  } };
  for (const model of ["product", "storagePackage"]) state.db[model] = { findMany: async () => [] };
  const api = await load("./src/app/api/v1/operations/route.ts", state);
  const response = await api.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  for (const [, relation, collection] of relations) {
    assert.deepEqual(body.data[collection][0][relation], { id: privateStaff.id, name: privateStaff.name });
    assert.equal(body.data[collection][1][relation], null);
  }
  assert.equal(JSON.stringify(body).includes("synthetic-private-hash"), false);
  assert.equal(JSON.stringify(body).includes("passwordHash"), false);
  assert.equal(state.writes.length, 0);
});

test("stock movements require inventory authority at the product's actual facility", async () => {
  const state = fixture(); state.grant("inventory.manage", "a"); state.grant("reports.view", "b");
  const productId = "c1234567890123456789012345";
  const product = { id: productId, organisationId: "org", facilityId: "b", quantityOnHand: 10, quantityReserved: 0 };
  state.db.product = {
    findFirst: async ({ where }: Row) => matches(product, where) ? product : null,
    updateMany: async ({ where, data }: Row) => {
      if (where.id !== product.id || where.organisationId !== product.organisationId || (where.quantityOnHand && product.quantityOnHand < where.quantityOnHand.gte)) return { count: 0 };
      state.writes.push({ model: "product", data }); product.quantityOnHand += data.quantityOnHand.increment; return { count: 1 };
    },
  };
  state.db.stockMovement = { create: async ({ data }: Row) => { state.writes.push({ model: "stockMovement", data }); return { id: "movement", ...data }; } };
  const api = await load("./src/app/api/v1/operations/route.ts", state);
  const send = (type = "RECEIPT", id = productId) => api.POST(request("POST", { kind: "stockMovement", payload: { productId: id, type, quantity: 1, facilityId: "a" } }));
  for (const type of ["RECEIPT", "SALE", "RETURN", "ADJUSTMENT", "DAMAGE", "TRANSFER"]) assert.equal((await send(type)).status, 403, type);
  assert.equal(product.quantityOnHand, 10); assert.equal(state.writes.length, 0);
  product.facilityId = "a";
  assert.equal((await send()).status, 201); assert.equal(product.quantityOnHand, 11);
  assert.equal(state.writes.filter(row => row.model === "stockMovement").length, 1);
  assert.equal(state.writes.filter(row => row.model === "auditEvent").length, 1);
  product.facilityId = "b";
  state.grant("inventory.manage", null);
  assert.equal((await send()).status, 201); assert.equal(product.quantityOnHand, 12);
  state.tables.user[0].roleAssignments = [];
  state.grant("*", null, "Organisation owner");
  assert.equal((await send()).status, 201); assert.equal(product.quantityOnHand, 13);
  const count = state.writes.length;
  product.organisationId = "other";
  assert.equal((await send()).status, 403);
  assert.equal((await send("RECEIPT", "c9999999999999999999999999")).status, 403);
  assert.equal(state.writes.length, count); assert.equal(product.quantityOnHand, 13);
});

test("daily-close API preserves closed snapshots and returns a useful conflict", async () => {
  const state = fixture();
  const facilityId = "c2222222222222222222222222";
  state.grant("daily_close.perform", facilityId);
  state.db.facility.count = async () => 1;
  let saved: Row | null = null;
  state.db.dailyClose = {
    findFirst: async () => saved,
    create: async ({ data }: Row) => { saved = { id: "close", ...data }; state.writes.push({ model: "dailyClose", data }); return saved; },
    upsert: async ({ create, update }: Row) => { saved = { id: "close", ...(saved ? { ...saved, ...update } : create) }; state.writes.push({ model: "dailyClose", data: saved }); return saved; },
  };
  const api = await load("./src/app/api/v1/operations/route.ts", state);
  const payload = { facilityId, businessDate: "2026-01-01", expectedCash: 10, countedCash: 10, checks: [{ key: "review", label: "Synthetic check", complete: true }] };
  for (const field of ["expectedCash", "countedCash"]) {
    for (const value of [0.005, 0.004, 1_000_000_000_000]) {
      assert.equal((await api.POST(request("POST", { kind: "dailyClose", payload: { ...payload, [field]: value } }))).status, 422);
      assert.equal(state.writes.length, 0);
    }
  }
  assert.equal((await api.POST(request("POST", { kind: "dailyClose", payload }))).status, 201);
  const writeCount = state.writes.length;
  const repeated = await api.POST(request("POST", { kind: "dailyClose", payload: { ...payload, countedCash: 99 } }));
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).error.code, "DAILY_CLOSE_ALREADY_CLOSED");
  assert.equal(state.writes.length, writeCount);
  assert.equal((saved as Row | null)?.countedCash, 10);
  assert.equal(state.writes.filter(row => row.model === "auditEvent").length, 1);
  assert.equal((await api.POST(request("POST", { kind: "dailyClose", payload: { ...payload, checks: [{ key: "review", label: "Synthetic check", complete: false }] } }))).status, 409);
  assert.equal(state.writes.length, writeCount);
});
