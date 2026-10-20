import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { db } from "../../src/lib/db";
import { communicationLogPage } from "../../src/lib/communication-log-service";
import { communicationFiltersSchema, communicationLogReadSchema } from "../../src/lib/communication-log-query";

test("isolated actual communication lookup, scope, dates, keyset and current-role API boundaries", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const url = new URL(process.env.DATABASE_URL!); assert.equal(url.hostname, "localhost"); assert.match(url.pathname, /^\/(?:faeez_operations|merchandise_ci|global_communications_[a-z0-9_]+)$/);
  const org = await db.organisation.create({ data: { name: "Synthetic global communications", slug: randomUUID() } });
  const foreignOrg = await db.organisation.create({ data: { name: "Other synthetic communications", slug: randomUUID() } });
  const a = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic Midpoint", code: randomUUID() } });
  const b = await db.facility.create({ data: { organisationId: org.id, name: "Other synthetic store", code: randomUUID() } });
  const foreignStore = await db.facility.create({ data: { organisationId: foreignOrg.id, name: "PRIVATE-FOREIGN-STORE", code: randomUUID() } });
  const staff = await db.user.create({ data: { organisationId: org.id, name: "Synthetic log reader", email: randomUUID() + "@example.invalid" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Scoped logs only", permissions: ["operations.view"] } });
  await db.roleAssignment.create({ data: { userId: staff.id, roleId: role.id, facilityId: a.id } });
  const makeCustomer = (name: string, organisationId = org.id, facilityId = a.id) => db.customer.create({ data: { organisationId, firstName: name, email: randomUUID() + "@example.invalid", phone: "+27820000000", leads: { create: { facilityId, source: "SYNTHETIC" } } } });
  const customer = await makeCustomer("Search Customer"), oldestCustomer = await makeCustomer("Older than first100"), boundaryCustomer = await makeCustomer("DayBoundary"), otherCustomer = await makeCustomer("PRIVATE-OTHER-CUSTOMER", org.id, b.id), foreignCustomer = await makeCustomer("PRIVATE-FOREIGN-CUSTOMER", foreignOrg.id, foreignStore.id);
  const scope = { userId: staff.id, organisationId: org.id, facilityIds: [a.id], unrestrictedFacilities: false };
  const syntheticId = () => "c" + randomUUID().replaceAll("-", "").slice(0, 24);
  const ids = Array.from({ length: 135 }, syntheticId);
  const createLog = (customerId: string | null, facilityId: string | null, queuedAt: Date, extra: Record<string, unknown> = {}) => db.communicationLog.create({ data: { organisationId: org.id, customerId, facilityId, queuedAt, channel: "EMAIL", status: "SUCCEEDED", recipientHash: "PRIVATE-RECIPIENT-HASH", providerRef: "PRIVATE-PROVIDER-REFERENCE", idempotencyKey: randomUUID(), metadata: { private: "PRIVATE-PAYLOAD", historyEvidence: { version: 1, text: "PRIVATE-MESSAGE-BODY" } }, ...extra } });
  let session: { userId: string; sessionVersion: number; mfaVerified?: boolean } | null = { userId: staff.id, sessionVersion: staff.sessionVersion, mfaVerified: true }, outage = false;
  try {
    await db.communicationLog.createMany({ data: ids.map((id, index) => ({ id, organisationId: org.id, customerId: customer.id, facilityId: a.id, channel: ["EMAIL", "SMS", "WHATSAPP"][index % 3], direction: index === 0 ? "LEGACY_UNKNOWN" : "OUTBOUND", status: (["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "DEAD_LETTER"] as const)[index % 5], queuedAt: new Date(index < 60 ? "2026-10-14T08:00:00Z" : new Date("2026-10-14T09:00:00Z").getTime() + index * 1000), recipientHash: "PRIVATE-RECIPIENT-HASH", providerRef: "PRIVATE-PROVIDER-REFERENCE", idempotencyKey: randomUUID(), metadata: { private: "PRIVATE-PAYLOAD", historyEvidence: { version: 1, text: "PRIVATE-MESSAGE-BODY" } } })) });
    const old = await createLog(oldestCustomer.id, a.id, new Date("2026-09-01T08:00:00Z"));
    const unassigned = await createLog(customer.id, null, new Date("2026-10-14T08:00:00Z"));
    await createLog(otherCustomer.id, b.id, new Date("2026-10-14T08:00:00Z"));
    await createLog(otherCustomer.id, null, new Date("2026-10-14T08:00:00Z"));
    await createLog(foreignCustomer.id, a.id, new Date("2026-10-14T08:00:00Z"));
    await createLog(customer.id, foreignStore.id, new Date("2026-10-14T08:00:00Z"));
    const dayRows: Awaited<ReturnType<typeof createLog>>[] = [];
    for (const at of ["2026-10-13T21:59:59.999Z", "2026-10-13T22:00:00.000Z", "2026-10-14T21:59:59.999Z", "2026-10-14T22:00:00.000Z"]) dayRows.push(await createLog(boundaryCustomer.id, a.id, new Date(at)));
    const defaults = communicationFiltersSchema.parse({});
    await t.test("more than100 records and timestamp ties page completely without duplicates or newly queued records", async () => {
      let result = await communicationLogPage(scope, defaults); const snapshot = result.snapshotAt; const found = [...result.rows];
      const fresh = await createLog(customer.id, a.id, new Date(Date.now() + 1000), { messageType: "NEW_AFTER_SNAPSHOT" });
      while (result.nextCursor) { result = await communicationLogPage(scope, defaults, result.nextCursor); assert.equal(result.snapshotAt, snapshot); found.push(...result.rows); }
      assert.deepEqual(new Set(found.map(row => row.id)), new Set([...ids, old.id, unassigned.id, ...dayRows.map(row => row.id)]));
      assert.equal(found.length, new Set(found.map(row => row.id)).size); assert.ok(!found.some(row => row.id === fresh.id));
      for (let i = 1; i < found.length; i++) assert.ok(found[i - 1].queuedAt > found[i].queuedAt || found[i - 1].queuedAt === found[i].queuedAt && found[i - 1].id > found[i].id);
      assert.equal(found.find(row => row.id === ids[0])?.direction, "UNKNOWN");
      assert.ok(found.every(row => !JSON.stringify(row).includes("PRIVATE-")));
      assert.ok(found.every(row => row.canOpenCustomer));
    });
    await t.test("customer lookup finds an older record independently of the latest100 view and exact SAST boundary days", async () => {
      const older = await communicationLogPage(scope, communicationFiltersSchema.parse({ search: "older FIRST100" })); assert.deepEqual(older.rows.map(row => row.id), [old.id]);
      const day = await communicationLogPage(scope, communicationFiltersSchema.parse({ search: "DayBoundary", from: "2026-10-14", to: "2026-10-14", channel: "EMAIL", status: "SUCCEEDED" }));
      assert.deepEqual(new Set(day.rows.map(row => row.id)), new Set([dayRows[1].id, dayRows[2].id]));
      const filtered = await communicationLogPage(scope, communicationFiltersSchema.parse({ search: "Search Customer", channel: "WHATSAPP", status: "SUCCEEDED" }));
      assert.ok(filtered.rows.length); assert.ok(filtered.rows.every(row => row.channel === "WHATSAPP" && row.status === "SUCCEEDED"));
      const scoped = await communicationLogPage(scope, communicationFiltersSchema.parse({ facilityId: a.id })); assert.ok(scoped.rows.every(row => row.facilityName === a.name));
    });
    await t.test("foreign customer/store and filter/scope cursor reuse are rejected, not silently broadened", async () => {
      for (const customerId of [otherCustomer.id, foreignCustomer.id]) await assert.rejects(communicationLogPage(scope, communicationFiltersSchema.parse({ customerId })), /FORBIDDEN/);
      for (const facilityId of [b.id, foreignStore.id]) await assert.rejects(communicationLogPage(scope, communicationFiltersSchema.parse({ facilityId })), /FORBIDDEN/);
      const page = await communicationLogPage(scope, defaults); assert.ok(page.nextCursor);
      await assert.rejects(communicationLogPage(scope, { ...defaults, channel: "SMS" }, page.nextCursor!), /COMMUNICATION_CURSOR_INVALID/);
      await assert.rejects(communicationLogPage({ ...scope, facilityIds: [b.id] }, defaults, page.nextCursor!), /COMMUNICATION_CURSOR_INVALID/);
      const owner = await communicationLogPage({ ...scope, unrestrictedFacilities: true }, communicationFiltersSchema.parse({ search: "PRIVATE-FOREIGN" })); assert.equal(owner.rows.length, 0);
    });
    await t.test("real GET route uses current DB role, denies before query reads and releases only private safe JSON", async () => {
      const bridge = new Proxy(db, { get(target, key, receiver) { if (key === "communicationLog") return new Proxy(target.communicationLog, { get(delegate, method, delegateReceiver) { if (method === "findMany" && outage) return async () => { throw Error("SIMULATED_READ_OUTAGE"); }; return Reflect.get(delegate, method, delegateReceiver); } }); return Reflect.get(target, key, receiver); } });
      const compiled = await build({ entryPoints: ["src/app/api/v1/communications/logs/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "actual-communication-auth-db", setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__getSession();" }));
      } }] });
      const loaded = { exports: {} as { GET: (request: Request) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__getSession", compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, bridge, () => session);
      const get = (query = "") => loaded.exports.GET(new Request("https://example.invalid/api/v1/communications/logs?" + query));
      session = null; assert.equal((await loaded.exports.GET(Object.defineProperty({}, "url", { get() { throw Error("QUERY_READ_BEFORE_AUTH"); } }) as Request)).status, 401);
      session = { userId: staff.id, sessionVersion: staff.sessionVersion, mfaVerified: true };
      const before = await db.communicationLog.count({ where: { organisationId: org.id } });
      const result = await get("search=Search&channel=SMS"); assert.equal(result.status, 200); assert.match(result.headers.get("cache-control")!, /private, no-store/);
      const json = await result.json(); assert.equal(communicationLogReadSchema.safeParse(json).success, true);
      for (const forbidden of ["PRIVATE-PAYLOAD", "PRIVATE-RECIPIENT-HASH", "PRIVATE-PROVIDER-REFERENCE", "PRIVATE-MESSAGE-BODY", "providerRef", "recipientHash", "metadata"]) assert.ok(!JSON.stringify(json).includes(forbidden));
      assert.equal((await get("facilityId=" + b.id)).status, 403); assert.equal((await get("customerId=" + foreignCustomer.id)).status, 403);
      for (const query of ["from=2026-10-15&to=2026-10-14", "channel=EMAIL&channel=SMS", "export=CSV", "cursor=bad", "__proto__=x", "constructor=x", "toString=x"]) assert.equal((await get(query)).status, 422);
      await db.role.update({ where: { id: role.id }, data: { permissions: [] } }); assert.equal((await get()).status, 403);
      await db.role.update({ where: { id: role.id }, data: { permissions: ["operations.view"] } });
      outage = true; const failed = await get(); assert.equal(failed.status, 500); const failureBody = await failed.text(); assert.ok(!failureBody.includes('"rows":[]')); assert.ok(!failureBody.includes("SIMULATED_READ_OUTAGE")); assert.ok(failureBody.includes("INTERNAL_ERROR")); outage = false;
      assert.equal(await db.communicationLog.count({ where: { organisationId: org.id } }), before);
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: org.id } }), 0); assert.equal(await db.payment.count({ where: { account: { customer: { organisationId: org.id } } } }), 0);
    });
  } finally {
    await db.auditEvent.deleteMany({ where: { organisationId: { in: [org.id, foreignOrg.id] } } });
    await db.communicationLog.deleteMany({ where: { organisationId: { in: [org.id, foreignOrg.id] } } });
    await db.organisation.delete({ where: { id: org.id } }); await db.organisation.delete({ where: { id: foreignOrg.id } }); await db.$disconnect();
  }
});
