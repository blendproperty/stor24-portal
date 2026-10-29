/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated delegates model only the exercised authorization boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { newIdentityAccess } from "../src/lib/booking-access";

type Bag = Record<string, any>;
const own = "caaaaaaaaaaaaaaaaaaaaaaaa", foreign = "cbbbbbbbbbbbbbbbbbbbbbbbb";
const restricted = { organisationId: "org", userId: "actor", facilityIds: [own], unrestrictedFacilities: false };
const globalScope = { ...restricted, facilityIds: [], unrestrictedFacilities: true };
async function load(entry: string, db: Bag, scope: Bag = restricted, overrides: Record<string, string> = {}) {
  const auth = { ...scope, user: { id: scope.userId, organisationId: scope.organisationId }, allowedFacilityIds: scope.unrestrictedFacilities ? null : scope.facilityIds };
  const mocks: Record<string, string> = {
    db: "export const db=__db;",
    "auth-guards": "export const requirePermission=async(p)=>{__db.permissionNames?.push(p);return __auth};export const requireSession=async()=>__auth;export const authErrorResponse=e=>Response.json({error:{code:e.message}},{status:['FORBIDDEN','FACILITY_FORBIDDEN'].includes(e.message)?403:500});",
    "public-payment-follow-up": "export const runSimulatedPaymentFollowUp=async()=>{__db.followUps++;return {status:'COMPLETED'}};",
    ...overrides,
  };
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, plugins: [{ name: "isolated-security", setup(b) {
    b.onResolve({ filter: /^@\/(lib|components|app\/actions)\// }, a => { const key = a.path.split('/').at(-1)!; return Object.hasOwn(mocks, key) ? { path: key, namespace: "fixture" } : undefined; });
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: mocks[a.path] }));
  } }] });
  const loaded = { exports: {} as Bag };
  new Function("require", "module", "exports", "__db", "__auth", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, auth);
  return loaded.exports;
}

test("facility grants cannot enter any shared provider credential or processing mutation", async () => {
  const db = new Proxy({}, { get() { throw Error("Unexpected database access"); } });
  const hik = await load("src/lib/integrations/hikcentral-configuration.ts", db);
  const netcash = await load("src/lib/integrations/netcash-configuration.ts", db);
  for (const operation of [hik.saveHikCentralCredentials, netcash.validateAndSaveNetcashConfiguration, netcash.setNetcashTransactionProcessing]) {
    await assert.rejects(operation(restricted, undefined), /^Error: FORBIDDEN$/);
  }
});

test("reporting and move-in pages use their own permission scope despite unrelated facility/global roles", async () => {
  for (const unrelated of [foreign, null]) {
    const db: Bag = { scopes: [], permissionNames: [], user: { findUnique: async () => ({ id: "actor", organisationId: "org", active: true, roleAssignments: [{ facilityId: own, role: { name: "Scoped", permissions: ["reports.view", "move_in.create"] } }, { facilityId: unrelated, role: { name: "Phone", permissions: ["phone.view"] } }] }) } };
    const dashboard = "export const getDashboardKpis=async(s)=>{__db.scopes.push(s);return {newLeadsThisWeek:0,leadsThisMonth:0,conversionRatePct:0,occupancyPct:0,occupiedUnits:0,totalUnits:0,activeTenancies:0,monthToDateBilled:0,collectionsRatePct:0,monthToDateCollected:0}};" + ["getLeadsLast7Days", "getOccupancyTrend", "getPipelineByStage", "getRevenueTrend", "getUnitStatsByFacility"].map(name => `export const ${name}=async(s)=>{__db.scopes.push(s);return []};`).join("");
    const graphs = await load("src/app/graphs/page.tsx", db, restricted, { "dashboard-service": dashboard });
    await graphs.default();
    const page = await load("src/app/operations/move-in/page.tsx", db, restricted, {
      "leasing-service": "export const listLeasing=async(s)=>{__db.scopes.push(s);return {facilities:[],customers:[],reservations:[]}};",
      "leasing": "export const moveInAction=async()=>{};",
      "move-in-workspace": "export const MoveInWorkspace=()=>null;", "move-in-training": "export const TrainingEntry=()=>null;",
    });
    await page.default({ searchParams: Promise.resolve({}) });
    assert.ok(db.scopes.length > 0);
    assert.ok(db.scopes.every((scope: Bag) => !scope.unrestrictedFacilities && JSON.stringify(scope.facilityIds) === JSON.stringify([own])));
    assert.deepEqual(db.permissionNames, ["reports.view", "move_in.create"]);
  }
});

test("facility audit readers exclude foreign and organisation-wide events while global readers retain them", async () => {
  for (const scope of [restricted, globalScope]) {
    let query: Bag = {};
    const page = await load("src/app/audit/page.tsx", { auditEvent: { findMany: async ({ where }: Bag) => { query = where; return []; } } }, scope);
    await page.default();
    assert.equal(query.organisationId, "org");
    assert.deepEqual(query.facilityId, scope.unrestrictedFacilities ? undefined : { in: [own] });
  }
});

test("anonymous enquiries create separate unverified prospects without enriching a matching customer", async () => {
  const victim = { id: "existing", organisationId: "org", email: "existing@example.invalid", firstName: null, lastName: null, phone: null, emailVerifiedAt: new Date(), billingAddress: { city: "Protected" } };
  const before = structuredClone(victim), created: Bag[] = [], leads: Bag[] = [];
  const db: Bag = {
    facility: { findFirst: async () => ({ id: own, organisationId: "org", name: "Synthetic", publicSlug: "synthetic" }) },
    customer: { findFirst: async () => victim, update: async ({ data }: Bag) => Object.assign(victim, data), create: async ({ data }: Bag) => { const row = { id: `prospect-${created.length}`, ...data }; created.push(row); return row; } },
    lead: { create: async ({ data }: Bag) => { const row = { id: `lead-${leads.length}`, ...data }; leads.push(row); return row; } }, auditEvent: { create: async () => ({}) },
  };
  db.$transaction = async (fn: any) => fn(db);
  const service = await load("src/lib/public-lead-service.ts", db);
  for (let i = 0; i < 2; i++) await service.createPublicLead({ email: victim.email, firstName: "Unverified", lastName: "Enquiry", phone: "+27000000000", facilitySlug: "synthetic" }, "synthetic-ip");
  assert.deepEqual(victim, before);
  assert.equal(created.length, 2); assert.equal(new Set(leads.map(row => row.customerId)).size, 2);
  assert.ok(leads.every(row => row.customerId !== victim.id));
  assert.ok(created.every(row => !row.emailVerifiedAt && !row.phoneVerifiedAt));
});

function simulatorFixture() {
  const grant = newIdentityAccess(), checkoutToken = "synthetic-checkout-token";
  const booking: Bag = { id: "booking", publicReference: "ST24-SYNTHETIC", status: "ACTIVE", journey: "RENTAL", contactVerifiedAt: new Date(), ...grant, publicLease: null, customer: { organisationId: "org", firstName: "Synthetic", emailVerifiedAt: new Date() }, facilityId: own, facility: { name: "Synthetic" }, unitId: "unit", unit: { number: "1" }, quotedRate: 100, packageSelection: null, publicPaymentSessions: [], leadId: null };
  const session: Bag = { id: "synthetic-session", reservationId: booking.id, reservation: booking, checkoutTokenHash: createHash("sha256").update(checkoutToken).digest("hex"), status: "PENDING", expiresAt: new Date(Date.now() + 60000), idempotencyKey: "synthetic", providerReference: "SIM-SYNTHETIC", paymentMethod: "CARD", amount: 100, currency: "ZAR" };
  const db: Bag = { writes: 0, followUps: 0, onLock: () => {},
    $queryRaw: async () => { db.onLock(); return []; },
    reservation: { findUnique: async () => booking, update: async ({ data }: Bag) => { db.writes++; return Object.assign(booking, data); }, updateMany: async ({ data }: Bag) => { db.writes++; Object.assign(booking, data); return { count: 1 }; } },
    publicPaymentSession: { findUnique: async () => session, create: async ({ data }: Bag) => { db.writes++; return { ...session, ...data }; }, update: async ({ data }: Bag) => { db.writes++; return Object.assign(session, data); } },
    unit: { updateMany: async () => { db.writes++; return { count: 1 }; } }, auditEvent: { create: async () => { db.writes++; return {}; } },
  };
  db.$transaction = async (fn: any) => fn(db);
  return { db, booking, session, grant, checkoutToken };
}

test("simulator start and all completion/retry states require current booking ownership", async () => {
  const previous = process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED; process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED = "true";
  try {
    const f = simulatorFixture(), service = await load("src/lib/public-payment-simulator.ts", f.db);
    for (const token of [undefined, "wrong", newIdentityAccess().token]) {
      assert.equal((await service.startSimulatedPayment(f.booking.publicReference, "synthetic-request", token)).code, "ID_SESSION_REQUIRED");
      for (const status of ["PENDING", "SUCCEEDED", "DECLINED"]) {
        f.session.status = status;
        assert.equal((await service.completeSimulatedPayment(f.session.id, f.checkoutToken, "SUCCESS", "CARD", token)).code, "ID_SESSION_REQUIRED");
      }
    }
    assert.equal(f.db.writes, 0); assert.equal(f.db.followUps, 0);
    f.session.status = "PENDING";
    assert.equal((await service.startSimulatedPayment(f.booking.publicReference, "synthetic-request", f.grant.token)).ok, true);
    const before = f.db.writes;
    f.db.onLock = () => { f.booking.identityAccessHash = newIdentityAccess().identityAccessHash; };
    assert.equal((await service.completeSimulatedPayment(f.session.id, f.checkoutToken, "DECLINED", "CARD", f.grant.token)).code, "ID_SESSION_REQUIRED");
    assert.equal(f.db.writes, before); assert.equal(f.db.followUps, 0);
    const valid = simulatorFixture(), allowed = await load("src/lib/public-payment-simulator.ts", valid.db);
    assert.equal((await allowed.completeSimulatedPayment(valid.session.id, valid.checkoutToken, "DECLINED", "CARD", valid.grant.token)).status, "DECLINED");
    assert.equal(valid.booking.status, "CANCELLED"); assert.equal(valid.db.followUps, 0);
    const success = simulatorFixture(), paid = await load("src/lib/public-payment-simulator.ts", success.db);
    assert.equal((await paid.completeSimulatedPayment(success.session.id, success.checkoutToken, "SUCCESS", "CARD", success.grant.token)).status, "SUCCEEDED");
    assert.equal(success.db.followUps, 1);
    success.booking.status = "CANCELLED";
    assert.equal((await paid.completeSimulatedPayment(success.session.id, success.checkoutToken, "SUCCESS", "CARD", success.grant.token)).code, "RESERVATION_UNAVAILABLE");
    assert.equal(success.db.followUps, 1);
  } finally { if (previous === undefined) delete process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED; else process.env.PUBLIC_PAYMENT_SIMULATOR_ENABLED = previous; }
});

test("global credential save and facility mapping retain their distinct legitimate authority", async () => {
  const previous = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "ab".repeat(32);
  const writes: Bag[] = [];
  const db = {
    facility: { findFirst: async ({ where }: Bag) => where.AND[0].id === own && where.AND[1].organisationId === "org" ? { id: own } : null },
    integrationConnection: { findFirst: async () => null, create: async ({ data }: Bag) => { writes.push(data); return { id: "connection", ...data }; } },
    auditEvent: { create: async () => ({}) },
  };
  try {
    const service = await load("src/lib/integrations/hikcentral-configuration.ts", db);
    await service.saveHikCentralCredentials(globalScope, { endpoint: "https://synthetic.invalid", appKey: "synthetic-key", appSecret: "synthetic-secret" });
    assert.equal(writes.length, 1); assert.equal(writes[0].facilityId, undefined);
    assert.notEqual(writes[0].config.appSecretEncrypted, "synthetic-secret");
    await service.saveHikCentralMapping(restricted, { facilityId: own, organisationIndexCode: "synthetic", doorIndexCodes: ["door"] });
    assert.equal(writes.length, 2); assert.equal(writes[1].facilityId, own);
    await assert.rejects(service.saveHikCentralMapping(restricted, { facilityId: foreign, organisationIndexCode: "synthetic", doorIndexCodes: ["door"] }), /FACILITY_FORBIDDEN/);
    assert.equal(writes.length, 2);
  } finally { if (previous === undefined) delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY; else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = previous; }
});

test("global configuration authority cannot attach profiles or integrations to another organisation", async () => {
  const writes: Bag[] = [];
  const delegate = { findFirst: async () => null, create: async ({ data }: Bag) => { writes.push(data); return { id: "setting", ...data }; } };
  const db: Bag = {
    facility: { findFirst: async ({ where }: Bag) => where.AND[0].id === own && where.AND[1].organisationId === "org" ? { id: own } : null },
    configurationProfile: delegate, integrationConnection: delegate, auditEvent: { create: async () => ({}) },
  };
  db.$transaction = async (fn: any) => fn(db);
  const route = await load("src/app/api/v1/configuration/route.ts", db, globalScope);
  const request = (body: unknown) => new Request("https://fixture.invalid/api", { method: "PUT", body: JSON.stringify(body) });
  for (const body of [
    { kind: "profile", payload: { facilityId: foreign, domain: "STORE_INFORMATION", name: "Default", status: "READY", config: { phone: "synthetic" } } },
    { kind: "integration", payload: { facilityId: foreign, category: "PHONE", provider: "Synthetic", status: "CONFIGURED", config: {} } },
  ]) assert.equal((await route.PUT(request(body))).status, 403);
  assert.equal(writes.length, 0);
  for (const facilityId of [own, null]) assert.equal((await route.PUT(request({ kind: "profile", payload: { facilityId, domain: "STORE_INFORMATION", name: "Default", status: "READY", config: {} } }))).status, 200);
  assert.equal(writes.length, 2);
});

test("generic settings cannot overwrite or shadow dedicated Netcash connections", async () => {
  for (const scope of [globalScope, restricted]) {
    const writes: Bag[] = [];
    const existing = { id: "protected", config: { payNowServiceKeyEncrypted: "synthetic-existing-ciphertext" } };
    const db: Bag = {
      facility: { findFirst: async () => ({ id: own }) },
      integrationConnection: { findFirst: async () => existing, update: async ({ data }: Bag) => { writes.push(data); return { ...existing, ...data }; } },
      auditEvent: { create: async () => ({}) },
    };
    db.$transaction = async (fn: any) => fn(db);
    const route = await load("src/app/api/v1/configuration/route.ts", db, scope);
    for (const facilityId of scope.unrestrictedFacilities ? [null, own] : [own]) for (const provider of ["NETCASH", " NETCASH "]) {
      const response = await route.PUT(new Request("https://fixture.invalid/api", { method: "PUT", body: JSON.stringify({ kind: "integration", payload: { facilityId, category: "PAYMENTS", provider, status: "DISABLED", config: {} } }) }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "DEDICATED_CONFIGURATION_REQUIRED");
    }
    assert.equal(writes.length, 0);
    assert.equal(existing.config.payNowServiceKeyEncrypted, "synthetic-existing-ciphertext");
    const ordinary = await route.PUT(new Request("https://fixture.invalid/api", { method: "PUT", body: JSON.stringify({ kind: "integration", payload: { facilityId: own, category: "PHONE", provider: "Synthetic", status: "CONFIGURED", config: { notes: "Synthetic connection" } } }) }));
    assert.equal(ordinary.status, 200); assert.equal(writes.length, 1);
  }
});
