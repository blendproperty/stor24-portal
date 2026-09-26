import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../src/generated/prisma/client";
import { db } from "../../src/lib/db";
import { buildReportRows } from "../../src/lib/report-data-service";
import { requireFacility } from "../../src/lib/scope";
import { createCustomer, createLead, requireLeasingCustomer } from "../../src/lib/leasing-service";
import { listIdentityLinks } from "../../src/lib/mel-integration-status-service";
import { listCommunicationLogs } from "../../src/lib/communication-log-service";

test("isolated PostgreSQL security boundaries and safe staff projections", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Security CI", slug: key } });
  const other = await db.organisation.create({ data: { name: "Other security CI", slug: `${key}-other` } });
  const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "Synthetic reviewer", passwordHash: "synthetic-not-a-real-password-hash" } });
  const a = await db.facility.create({ data: { organisationId: org.id, code: "a", name: "A" } });
  const b = await db.facility.create({ data: { organisationId: org.id, code: "b", name: "B" } });
  const foreign = await db.facility.create({ data: { organisationId: other.id, code: "foreign", name: "Foreign" } });
  const scope = { userId: user.id, organisationId: org.id, facilityIds: [a.id], unrestrictedFacilities: false };
  try {
    await t.test("message listings retain customer scope when a facility is unassigned", async () => {
      const own = await db.customer.create({ data: { organisationId: org.id, firstName: "Log own", leads: { create: { facilityId: a.id, source: "CI" } } } });
      const unrelated = await db.customer.create({ data: { organisationId: org.id, firstName: "Log other", leads: { create: { facilityId: b.id, source: "CI" } } } });
      const unlinked = await db.customer.create({ data: { organisationId: org.id, firstName: "Log unlinked" } });
      const foreignCustomer = await db.customer.create({ data: { organisationId: other.id, firstName: "Log foreign" } });
      const fixtures = [
        { customerId: own.id, facilityId: a.id, channel: "EMAIL" as const },
        { customerId: own.id, facilityId: null, channel: "SMS" as const },
        { customerId: own.id, facilityId: b.id, channel: "WHATSAPP" as const },
        { customerId: unrelated.id, facilityId: null, channel: "EMAIL" as const },
        { customerId: unlinked.id, facilityId: null, channel: "EMAIL" as const },
        { customerId: foreignCustomer.id, facilityId: null, channel: "EMAIL" as const },
        { customerId: null, facilityId: null, channel: "EMAIL" as const },
      ];
      const logs = [];
      for (const row of fixtures) logs.push(await db.communicationLog.create({ data: { ...row, organisationId: org.id, messageType: "CI", recipientHash: "synthetic", idempotencyKey: randomUUID() } }));
      const foreignLog = await db.communicationLog.create({ data: { organisationId: other.id, facilityId: foreign.id, customerId: foreignCustomer.id, channel: "EMAIL", messageType: "CI", recipientHash: "synthetic", idempotencyKey: randomUUID() } });
      assert.deepEqual(new Set((await listCommunicationLogs(scope)).map(row => row.id)), new Set(logs.slice(0, 2).map(row => row.id)));
      assert.equal((await listCommunicationLogs({ ...scope, facilityIds: [] })).length, 0);
      const unrestricted = await listCommunicationLogs({ ...scope, unrestrictedFacilities: true });
      assert.equal(unrestricted.length, logs.length);
      assert.ok(!unrestricted.some(row => row.id === foreignLog.id));
    });
    await t.test("manual messaging checks customer and facility relationships before any provider attempt", async () => {
      const role = await db.role.create({ data: { organisationId: org.id, name: "Messaging scope", permissions: ["operations.manage"] } });
      await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: a.id } });
      const customers = [];
      for (const facility of [a, b, foreign]) customers.push(await db.customer.create({ data: { organisationId: facility.organisationId, firstName: "Synthetic message", phone: "+27820000000", communicationConsent: { whatsapp: true }, leads: { create: { facilityId: facility.id, source: "CI" } } } }));
      let sends = 0;
      const provider = async () => { sends++; return { ok: true, providerReference: `synthetic-${sends}` }; };
      const load = async (entry: string) => {
        const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-messaging", setup(builder) {
          builder.onResolve({ filter: /^@\/lib\/(db|session|integrations\/twilio-provider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : args.path.endsWith("/session") ? "export const getSession=async()=>__session;" : "export class TwilioWhatsAppProvider { sendTemplate(...args) { return __provider(...args); } }" }));
        } }] });
        const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
        new Function("require", "module", "exports", "__db", "__session", "__provider", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: user.id, sessionVersion: user.sessionVersion }, provider);
        return loaded.exports;
      };
      const sendApi = await load("src/app/api/v1/communications/send-whatsapp/route.ts");
      const retryApi = await load("src/app/api/v1/communications/retry-whatsapp/route.ts");
      const request = (body: unknown) => new Request("https://example.invalid/api/v1/communications", { method: "POST", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify(body) });
      const send = (customerId: string, facilityId = a.id) => sendApi.POST(request({ customerId, facilityId, messageType: "PAYMENT_REMINDER", variables: {}, idempotencyKey: randomUUID() }));
      const retry = async (customerId: string, facilityId: string | null = null) => {
        const log = await db.communicationLog.create({ data: { organisationId: org.id, facilityId, customerId, channel: "WHATSAPP", status: "FAILED", messageType: "PAYMENT_REMINDER", recipientHash: "synthetic", metadata: { variables: {} }, idempotencyKey: randomUUID(), providerRef: "SMsynthetic", failedAt: new Date(), failureCode: "DELIVERY_FAILED" } });
        const response = await retryApi.POST(request({ logId: log.id }));
        if (response.status === 403) assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { id: log.id } })).attempts, 1);
        return response;
      };
      const envKey = "TWILIO_WHATSAPP_PAYMENT_REMINDER_SID", previous = process.env[envKey]; process.env[envKey] = "HXsynthetic";
      try {
        assert.equal((await send(customers[1].id)).status, 403);
        assert.equal((await retry(customers[1].id)).status, 403);
        assert.equal((await retry(customers[2].id, a.id)).status, 403);
        assert.equal(sends, 0);
        assert.equal(await db.auditEvent.count({ where: { organisationId: org.id, action: "communication.whatsapp.sent" } }), 0);
        assert.equal((await send(customers[0].id)).status, 202);
        assert.equal((await retry(customers[0].id)).status, 202);
        assert.equal((await send(customers[0].id, b.id)).status, 403);
        await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: null } });
        assert.equal((await send(customers[1].id, b.id)).status, 202);
        assert.equal((await send(customers[1].id, foreign.id)).status, 403);
        assert.equal((await retry(customers[0].id, foreign.id)).status, 403);
        assert.equal((await send(customers[2].id)).status, 403);
        assert.equal(sends, 3);
      } finally {
        if (previous === undefined) delete process.env[envKey]; else process.env[envKey] = previous;
        await db.roleAssignment.deleteMany({ where: { userId: user.id } });
      }
    });
    await t.test("account documents enforce organisation ownership with current global and facility roles", async () => {
      const reader = await db.role.create({ data: { organisationId: org.id, name: "Ledger test", permissions: ["ledger.view"] } });
      const owner = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
      const accounts = [];
      for (const facility of [a, b, foreign]) {
        const customer = await db.customer.create({ data: { organisationId: facility.organisationId, firstName: "Synthetic" } });
        const account = await db.account.create({ data: { customerId: customer.id, accountNumber: randomUUID() } });
        const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, startDate: new Date("2026-01-01") } });
        await db.document.create({ data: { tenancyId: tenancy.id, type: "INVOICE", status: "SENT", provider: "CI", storageKey: "inline:synthetic-ci", content: "Synthetic private invoice" } });
        accounts.push(account);
      }
      const output = await build({ entryPoints: ["src/app/api/v1/accounts/[id]/documents/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-session", setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
      } }] });
      const loaded = { exports: {} as { GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: user.id, sessionVersion: user.sessionVersion });
      const read = (id: string) => loaded.exports.GET(new Request("https://example.invalid/api/v1/accounts/test/documents"), { params: Promise.resolve({ id }) });
      for (const roleId of [reader.id, owner.id]) {
        await db.roleAssignment.deleteMany({ where: { userId: user.id } });
        await db.roleAssignment.create({ data: { userId: user.id, roleId, facilityId: null } });
        assert.equal((await read(accounts[2].id)).status, 404);
        const own = await read(accounts[1].id); assert.equal(own.status, 200);
        const body = await own.json(); assert.equal(body.data.documents.length, 1);
        assert.equal(JSON.stringify(body).includes("Synthetic private invoice"), false);
      }
      await db.roleAssignment.deleteMany({ where: { userId: user.id } });
      await db.roleAssignment.create({ data: { userId: user.id, roleId: reader.id, facilityId: a.id } });
      assert.equal((await read(accounts[0].id)).status, 200);
      assert.equal((await read(accounts[1].id)).status, 403);
      assert.equal((await read(accounts[2].id)).status, 404);
      await db.roleAssignment.deleteMany({ where: { userId: user.id } });
      assert.equal((await read(accounts[0].id)).status, 403);
    });
    await t.test("SQL intersects requested ID with assigned facility and organisation", async () => {
      assert.equal((await requireFacility(scope, a.id)).id, a.id);
      for (const id of [b.id, foreign.id]) await assert.rejects(requireFacility(scope, id), /FORBIDDEN/);
      await assert.rejects(requireFacility({ ...scope, facilityIds: [] }, a.id), /FORBIDDEN/);
      assert.equal((await requireFacility({ ...scope, unrestrictedFacilities: true }, b.id)).id, b.id);
      await assert.rejects(requireFacility({ ...scope, unrestrictedFacilities: true }, foreign.id), /FORBIDDEN/);
    });
    const own = await createCustomer(scope, { firstName: "Own", lastName: "Fixture" });
    const unrelated = await db.customer.create({ data: { organisationId: org.id, firstName: "Other", lastName: "Fixture", leads: { create: { facilityId: b.id, source: "CI" } } } });
    await t.test("creator can link a new customer but cannot adopt another facility's customer", async () => {
      assert.equal((await requireLeasingCustomer(scope, own.id)).id, own.id);
      await createLead(scope, { facilityId: a.id, customerId: own.id, source: "CI" });
      assert.equal((await requireLeasingCustomer(scope, own.id)).id, own.id);
      await assert.rejects(requireLeasingCustomer(scope, unrelated.id), /FORBIDDEN/);
      await assert.rejects(createLead(scope, { facilityId: a.id, customerId: unrelated.id, source: "CI" }), /FORBIDDEN/);
    });
    await t.test("operations serializes only display fields from populated staff relations", async () => {
      const type = await db.unitType.create({ data: { facilityId: a.id, name: "Projection test", features: [] } });
      const unit = await db.unit.create({ data: { facilityId: a.id, unitTypeId: type.id, number: "TEST", monthlyRate: 1 } });
      for (const assigneeId of [user.id, null]) await db.task.create({ data: { organisationId: org.id, facilityId: a.id, title: "Synthetic task", assigneeId } });
      await db.task.create({ data: { organisationId: org.id, facilityId: b.id, title: "Excluded facility", assigneeId: user.id } });
      await db.unitNote.create({ data: { organisationId: org.id, facilityId: a.id, unitId: unit.id, authorId: user.id, note: "Synthetic note" } });
      for (const assignedToId of [user.id, null]) await db.maintenanceRequest.create({ data: { organisationId: org.id, facilityId: a.id, title: "Synthetic maintenance", assignedToId } });
      for (const [index, closedById] of [user.id, null].entries()) await db.dailyClose.create({ data: { organisationId: org.id, facilityId: a.id, businessDate: new Date(`2026-01-0${index + 1}`), checks: [], closedById } });
      // Exercise the real route and Prisma projections; substitute only authentication.
      const output = await build({ stdin: { contents: 'export { GET } from "./src/app/api/v1/operations/route.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-route", setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(db|auth-guards)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const requirePermission=async()=>__auth; export const authErrorResponse=(error)=>{throw error};" }));
      } }] });
      const loaded = { exports: {} as { GET: () => Promise<Response> } };
      const authUser = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { roleAssignments: { include: { role: true } } } });
      new Function("require", "module", "exports", "__db", "__auth", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { organisationId: org.id, allowedFacilityIds: [a.id], user: authUser });
      const response = await loaded.exports.GET(); assert.equal(response.status, 200);
      const { data } = await response.json();
      for (const [collection, relation] of [["tasks", "assignee"], ["notes", "author"], ["maintenance", "assignedTo"], ["dailyCloses", "closedBy"]]) {
        assert.equal(data[collection].length, collection === "notes" ? 1 : 2);
        const assigned = data[collection].filter((row: Record<string, unknown>) => row[relation] !== null);
        assert.equal(assigned.length, 1);
        assert.deepEqual(assigned[0][relation], { id: user.id, name: user.name });
      }
      assert.equal(JSON.stringify(data).includes("passwordHash"), false);
      assert.equal(JSON.stringify(data).includes("synthetic-not-a-real-password-hash"), false);
      assert.equal(JSON.stringify(data).includes("sessionVersion"), false);
    });
    await t.test("stock POST cannot write outside current inventory facility grants", async () => {
      const manage = await db.role.create({ data: { organisationId: org.id, name: "Inventory fixture", permissions: ["inventory.manage"] } });
      const view = await db.role.create({ data: { organisationId: org.id, name: "Reports fixture", permissions: ["reports.view"] } });
      await db.roleAssignment.create({ data: { userId: user.id, roleId: manage.id, facilityId: a.id } });
      await db.roleAssignment.create({ data: { userId: user.id, roleId: view.id, facilityId: b.id } });
      const products = [];
      for (const facilityId of [a.id, b.id]) products.push(await db.product.create({ data: { organisationId: org.id, facilityId, sku: "SCOPE", name: "Synthetic product", category: "Test", sellingPrice: 1, quantityOnHand: 10 } }));
      const output = await build({ stdin: { contents: 'export { POST } from "./src/app/api/v1/operations/route.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-session", setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
      } }] });
      const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: user.id, sessionVersion: user.sessionVersion });
      const send = (productId: string) => loaded.exports.POST(new Request("https://example.invalid/api/v1/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "stockMovement", payload: { productId, type: "RECEIPT", quantity: 1 } }) }));
      assert.equal((await send(products[1].id)).status, 403);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: products[1].id } })).quantityOnHand, 10);
      assert.equal(await db.stockMovement.count({ where: { productId: products[1].id } }), 0);
      assert.equal(await db.auditEvent.count({ where: { organisationId: org.id, action: "stockMovement.create" } }), 0);
      assert.equal((await send(products[0].id)).status, 201);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).quantityOnHand, 11);
      assert.equal(await db.stockMovement.count({ where: { productId: products[0].id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: org.id, action: "stockMovement.create" } }), 1);
      await db.roleAssignment.create({ data: { userId: user.id, roleId: manage.id, facilityId: null } });
      assert.equal((await send(products[1].id)).status, 201);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: products[1].id } })).quantityOnHand, 11);
    });
    await t.test("populated status rows omit password hashes and other-facility customers", async () => {
      for (const customerId of [own.id, unrelated.id]) await db.integrationIdentityLink.create({ data: { organisationId: org.id, customerId, resolvedById: user.id } });
      const rows = await listIdentityLinks(scope);
      assert.equal(rows.length, 1); assert.equal(rows[0].customerId, own.id);
      assert.deepEqual(rows[0].resolvedBy, { id: user.id, name: user.name });
      assert.equal(JSON.stringify(rows).includes("passwordHash"), false);
      assert.equal(JSON.stringify(rows).includes("synthetic-not-a-real-password-hash"), false);
    });
    await t.test("report exports intersect export and report grants with populated PostgreSQL rows", async () => {
      const actor = await db.user.create({ data: { organisationId: org.id, email: `${key}-reports@example.invalid`, name: "Synthetic exporter", passwordHash: "synthetic" } });
      const exportRole = await db.role.create({ data: { organisationId: org.id, name: "Export fixture", permissions: ["reports.export"] } });
      const reportRole = await db.role.create({ data: { organisationId: org.id, name: "View fixture", permissions: ["reports.view"] } });
      for (const [facility, number] of [[a, "SYN-A"], [b, "SYN-B"], [foreign, "SYN-FOREIGN"]] as const) {
        const type = await db.unitType.create({ data: { facilityId: facility.id, name: "Report fixture", features: [] } });
        await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number, monthlyRate: 1 } });
      }
      const grants = async (exportId: string | null, viewId: string | null) => {
        await db.roleAssignment.deleteMany({ where: { userId: actor.id } });
        await db.roleAssignment.createMany({ data: [{ userId: actor.id, roleId: exportRole.id, facilityId: exportId }, { userId: actor.id, roleId: reportRole.id, facilityId: viewId }] });
      };
      const output = await build({ entryPoints: ["src/app/api/v1/reports/export/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "report-session", setup(builder) {
        builder.onResolve({ filter: /^@\/generated\/prisma\/client$/ }, () => ({ path: "prisma", namespace: "prisma-runtime" }));
        builder.onLoad({ filter: /.*/, namespace: "prisma-runtime" }, () => ({ contents: "export const Prisma=__prisma;" }));
        builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
      } }] });
      const loaded = { exports: {} as { GET: (request: Request) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", "__prisma", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: actor.id, sessionVersion: actor.sessionVersion }, Prisma);
      const read = (facilityId = "", format = "JSON") => loaded.exports.GET(new Request(`https://example.invalid/api/v1/reports/export?reportKey=unit-availability&from=2026-09-01&to=2026-09-26&format=${format}${facilityId ? `&facilityId=${facilityId}` : ""}`));
      await grants(a.id, b.id);
      assert.equal((await read(b.id)).status, 403); assert.equal((await read()).status, 403);
      for (const [exportId, viewId] of [[a.id, a.id], [null, a.id], [a.id, null]] as const) {
        await grants(exportId, viewId);
        assert.equal((await read(b.id)).status, 403);
        const response = await read(); assert.equal(response.status, 200);
        const { data } = await response.json(); assert.ok(data.some((row: { unit: string }) => row.unit === "SYN-A"));
        assert.ok(data.every((row: { facility: string }) => row.facility === "A"));
        assert.ok(data.every((row: { snapshotTakenAt: string }) => Number.isFinite(Date.parse(row.snapshotTakenAt)) && Math.abs(Date.now() - Date.parse(row.snapshotTakenAt)) < 60000));
        const csv = await read("", "CSV"); assert.equal(csv.status, 200); assert.match(csv.headers.get("content-disposition")!, /unit-availability-current\.csv/); const body = await csv.text(); assert.match(body, /SYN-A/); assert.doesNotMatch(body, /SYN-B|SYN-FOREIGN/);
      }
      await grants(null, null); const all = await read(); assert.equal(all.status, 200); const body = await all.text(); assert.match(body, /SYN-A/); assert.match(body, /SYN-B/); assert.doesNotMatch(body, /SYN-FOREIGN/);
      assert.equal((await read(foreign.id)).status, 403);
    });
    await t.test("report date filters respect both SAST midnight boundaries in PostgreSQL", async () => {
      const stamps = ["2026-09-24T21:59:59.999Z", "2026-09-24T22:00:00.000Z", "2026-09-25T21:59:59.999Z", "2026-09-25T22:00:00.000Z"];
      for (const [i, stamp] of stamps.entries()) await db.lead.create({ data: { facilityId: a.id, source: `SAST-${i}`, createdAt: new Date(stamp) } });
      await db.lead.create({ data: { facilityId: b.id, source: "SAST-other", createdAt: new Date(stamps[1]) } });
      const rows = await buildReportRows({ userId: user.id, organisationId: org.id, facilityIds: [a.id], unrestrictedFacilities: false }, { reportKey: "lead-conversion", from: "2026-09-25", to: "2026-09-25", format: "JSON", groupBy: "day" });
      assert.deepEqual(rows.map(row => row.source), ["SAST-1", "SAST-2"]);
    });
    await t.test("customer PATCH retains contact and consent on audit failure then retries once", async () => {
      const role = await db.role.create({ data: { organisationId: org.id, name: "Customer atomicity", permissions: ["operations.manage"] } });
      await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: a.id } });
      const own = await db.customer.create({ data: { organisationId: org.id, firstName: "Before", lastName: "Synthetic", communicationConsent: { email: false }, leads: { create: { facilityId: a.id, source: "CI" } } } });
      const otherCustomer = await db.customer.create({ data: { organisationId: org.id, firstName: "Other", lastName: "Synthetic", leads: { create: { facilityId: b.id, source: "CI" } } } });
      const output = await build({ entryPoints: ["src/app/api/v1/leasing/[resource]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "customer-session", setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
      } }] });
      const loaded = { exports: {} as { PATCH: (request: Request, context: { params: Promise<{ resource: string }> }) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: user.id, sessionVersion: user.sessionVersion });
      const patch = (id = own.id, data: Record<string, unknown> = { firstName: "After", communicationConsent: { email: true } }) => loaded.exports.PATCH(new Request("https://example.invalid/api/v1/leasing/customers", { method: "PATCH", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify({ id, data }) }), { params: Promise.resolve({ resource: "customers" }) });
      assert.equal((await patch(otherCustomer.id)).status, 403);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_customer_patch_failure CHECK (false) NOT VALID');
      try {
        assert.equal((await patch()).status, 500);
        const unchanged = await db.customer.findUniqueOrThrow({ where: { id: own.id } });
        assert.equal(unchanged.firstName, "Before"); assert.deepEqual(unchanged.communicationConsent, { email: false });
        assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "customers.updated" } }), 0);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_customer_patch_failure'); }
      assert.equal((await patch()).status, 200);
      const saved = await db.customer.findUniqueOrThrow({ where: { id: own.id } }); assert.equal(saved.firstName, "After"); assert.equal((saved.communicationConsent as { email: boolean }).email, true);
      assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "customers.updated", actorId: user.id } }), 1);
      assert.equal((await patch(own.id, { firstName: "", lastName: "", companyName: "" })).status, 422);
      assert.equal((await db.customer.findUniqueOrThrow({ where: { id: own.id } })).firstName, "After");
    });
    await t.test("lead PATCH retains stage and notes on audit failure then retries once", async () => {
      const role = await db.role.create({ data: { organisationId: org.id, name: "Lead atomicity", permissions: ["operations.manage"] } });
      await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, facilityId: a.id } });
      const own = await db.lead.create({ data: { facilityId: a.id, source: "CI", stage: "NEW", notes: "Before" } });
      const otherCustomer = await db.lead.create({ data: { facilityId: b.id, source: "CI" } });
      const output = await build({ entryPoints: ["src/app/api/v1/leasing/[resource]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "customer-session", setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
      } }] });
      const loaded = { exports: {} as { PATCH: (request: Request, context: { params: Promise<{ resource: string }> }) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: user.id, sessionVersion: user.sessionVersion });
      const patch = (id = own.id, data: Record<string, unknown> = { stage: "CONTACTED", notes: "After" }) => loaded.exports.PATCH(new Request("https://example.invalid/api/v1/leasing/leads", { method: "PATCH", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify({ id, data }) }), { params: Promise.resolve({ resource: "leads" }) });
      assert.equal((await patch(otherCustomer.id)).status, 403);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_lead_patch_failure CHECK (false) NOT VALID');
      try {
        assert.equal((await patch()).status, 500);
        const unchanged = await db.lead.findUniqueOrThrow({ where: { id: own.id } });
        assert.equal(unchanged.stage, "NEW"); assert.equal(unchanged.notes, "Before");
        assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "leads.updated" } }), 0);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_lead_patch_failure'); }
      assert.equal((await patch()).status, 200);
      const saved = await db.lead.findUniqueOrThrow({ where: { id: own.id } }); assert.equal(saved.stage, "CONTACTED"); assert.equal(saved.notes, "After");
      assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "leads.updated", actorId: user.id } }), 1);
      assert.equal((await patch(own.id, { facilityId: b.id })).status, 403);
      assert.equal((await patch(own.id, { stage: "INVALID" })).status, 422);
      assert.equal((await db.lead.findUniqueOrThrow({ where: { id: own.id } })).stage, "CONTACTED");
      assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "leads.updated" } }), 1);
    });
    await t.test("unit type PATCH retains dimensions on audit failure then retries once", async () => {
      const typeActor = await db.user.create({ data: { organisationId: org.id, email: `${key}-type@example.invalid`, name: "Synthetic type reviewer", passwordHash: "synthetic-not-a-real-password-hash" } });
      const role = await db.role.create({ data: { organisationId: org.id, name: "Unit type atomicity", permissions: ["inventory.manage"] } });
      await db.roleAssignment.create({ data: { userId: typeActor.id, roleId: role.id, facilityId: a.id } });
      const own = await db.unitType.create({ data: { facilityId: a.id, name: "Atomic type", areaSqMetres: 100 } });
      const otherType = await db.unitType.create({ data: { facilityId: b.id, name: "Other atomic type" } });
      const output = await build({ entryPoints: ["src/app/api/v1/leasing/[resource]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "unit-type-session", setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__session;" }));
      } }] });
      const loaded = { exports: {} as { PATCH: (request: Request, context: { params: Promise<{ resource: string }> }) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, { userId: typeActor.id, sessionVersion: typeActor.sessionVersion });
      const patch = (id = own.id, data: Record<string, unknown> = { areaSqMetres: 200 }) => loaded.exports.PATCH(new Request("https://example.invalid/api/v1/leasing/unit-types", { method: "PATCH", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify({ id, data }) }), { params: Promise.resolve({ resource: "unit-types" }) });
      assert.equal((await patch(otherType.id)).status, 403);
      await db.unitType.create({ data: { facilityId: a.id, name: "Existing atomic type" } });
      assert.equal((await patch(own.id, { name: "Existing atomic type" })).status, 409);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_type_patch_failure CHECK (false) NOT VALID');
      try {
        assert.equal((await patch()).status, 500);
        const unchanged = await db.unitType.findUniqueOrThrow({ where: { id: own.id } });
        assert.equal(Number(unchanged.areaSqMetres), 100);
        assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "unit-types.updated" } }), 0);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_type_patch_failure'); }
      assert.equal((await patch()).status, 200);
      const saved = await db.unitType.findUniqueOrThrow({ where: { id: own.id } }); assert.equal(Number(saved.areaSqMetres), 200);
      assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "unit-types.updated", actorId: typeActor.id } }), 1);
      assert.equal((await patch(own.id, { facilityId: b.id })).status, 403);
      assert.equal((await patch(own.id, { areaSqMetres: -1 })).status, 422);
      assert.equal(Number((await db.unitType.findUniqueOrThrow({ where: { id: own.id } })).areaSqMetres), 200);
      assert.equal(await db.auditEvent.count({ where: { entityId: own.id, action: "unit-types.updated" } }), 1);
    });
  } finally { await db.$disconnect(); }
});
