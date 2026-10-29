import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { databaseLimits } from "../../src/lib/database-limits";

type Session = { userId: string; sessionVersion: number; mfaVerified?: boolean };
type Handler = (request: Request, context?: unknown) => Promise<Response>;
type Routes = Record<string, { GET?: Handler; POST?: Handler }>;

test("representative isolated workload:180 customers,150 tenancies and25 scoped staff HTTP fixture sessions", { timeout: 120_000 }, async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const run = randomUUID();
  const org = await db.organisation.create({ data: { name: "Synthetic workload only", slug: `workload-${run}` } });
  const store = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic Midpoint workload", code: "A" } });
  const foreign = await db.facility.create({ data: { organisationId: org.id, name: "Private other store", code: "B" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Synthetic scoped staff", permissions: ["operations.view", "operations.manage", "communications.view", "reservations.manage", "reports.view", "leads.create"] } });
  const users = await Promise.all(Array.from({ length: 25 }, (_, i) => db.user.create({ data: { passwordHash: "synthetic-not-a-real-password-hash", organisationId: org.id, name: `Fixture staff ${i}`, email: `${run}-${i}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: store.id } } } })));
  const customers = await Promise.all(Array.from({ length: 180 }, (_, i) => db.customer.create({ data: { organisationId: org.id, firstName: `Synthetic ${String(i).padStart(3, "0")}`, lastName: "Workload", leads: { create: { facilityId: store.id, source: "OTHER" } } } })));
  const hidden = await db.customer.create({ data: { organisationId: org.id, firstName: "PRIVATE-OTHER-STORE", leads: { create: { facilityId: foreign.id, source: "OTHER" } } } });
  const type = await db.unitType.create({ data: { facilityId: store.id, name: "Workload storage", features: [] } });
  const units = await Promise.all(Array.from({ length: 210 }, (_, i) => db.unit.create({ data: { facilityId: store.id, unitTypeId: type.id, number: `S${i}`, monthlyRate: 100, status: i < 150 ? "OCCUPIED" : "AVAILABLE" } })));
  for (let i = 0; i < 150; i++) {
    const account = await db.account.create({ data: { customerId: customers[i].id, accountNumber: `${run}-${i}`, tenancy: { create: { customerId: customers[i].id, facilityId: store.id, startDate: new Date("2026-01-01"), status: "ACTIVE", occupancies: { create: { unitId: units[i].id, status: "ACTIVE", startDate: new Date("2026-01-01"), monthlyRate: 100 } } } } } });
    await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 100, description: "Synthetic retained charge", effectiveAt: new Date("2026-10-01") } });
  }
  await db.customerNote.createMany({ data: customers.flatMap(customer => Array.from({ length: 3 }, (_, i) => ({ organisationId: org.id, facilityId: store.id, customerId: customer.id, authorId: users[0].id, authorName: "Fixture staff 0", category: "HANDOVER", body: `Synthetic handover detail ${i}`, requestKey: randomUUID() }))) });
  await db.communicationLog.createMany({ data: customers.map(customer => ({ organisationId: org.id, facilityId: store.id, customerId: customer.id, channel: "EMAIL", recipientHash: "synthetic", idempotencyKey: randomUUID(), messageType: "RENT_NOTICE", status: "SUCCEEDED", metadata: { historyEvidence: { version: 1, text: "Synthetic retained communication", redacted: true } } })) });
  const sessions = new AsyncLocalStorage<Session | null>();
  const tokens = new Map<string, Session>(users.map(user => [randomUUID(), { userId: user.id, sessionVersion: user.sessionVersion, mfaVerified: true }]));
  const tokenList = [...tokens.keys()];
  const bundle = await build({ stdin: { contents: `export * as guide from './src/app/api/v1/operations/staff-guide/route';export * as history from './src/app/api/v1/customers/[customerId]/history/route';export * as search from './src/app/api/v1/operations/followups/route';export * as leasing from './src/app/api/v1/leasing/[resource]/route';export * as report from './src/app/api/v1/reports/preview/route';export * as offline from './src/app/api/v1/offline/snapshot/route';export * as offlineLead from './src/app/api/v1/offline/leads/route';export * as offlineReservation from './src/app/api/v1/offline/reservations/route';`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-http-session-boundary", setup(builder) {
    builder.onResolve({ filter: /generated\/prisma\/client$/ }, () => ({ path: resolve("src/generated/prisma/client.ts"), external: true }));
    builder.onResolve({ filter: /(?:^|\/)(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__db;" : "export const getSession=async()=>__sessions.getStore();" }));
  } }] });
  const loaded = { exports: {} as Routes };
  new Function("require", "module", "exports", "__db", "__sessions", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, sessions);
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk);
    const path = new URL(incoming.url!, `http://${incoming.headers.host}`);
    const target = path.pathname.includes("/staff-guide") ? "guide" : path.pathname.includes("/history") ? "history" : path.pathname.includes("/followups") ? "search" : path.pathname.includes("/reports/") ? "report" : path.pathname.includes("/offline/leads") ? "offlineLead" : path.pathname.includes("/offline/reservations") ? "offlineReservation" : path.pathname.includes("/offline/") ? "offline" : "leasing";
    const session = tokens.get(String(incoming.headers.cookie ?? "").replace("fixture=", "")) ?? null;
    await sessions.run(session, async () => {
      try {
        const request = new Request(path, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
        const response = await loaded.exports[target][incoming.method as "GET" | "POST"]!(request, { params: Promise.resolve({ customerId: path.pathname.split("/")[4], resource: "reservations" }) });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch { outgoing.writeHead(500); outgoing.end('{"fixtureFailure":true}'); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const timings: Record<string, number[]> = {};
  const evidence: Record<string, unknown> = { verifiedAt: new Date().toISOString(), environment: "isolated-ci", customers: 180, activeTenancies: 150, units: 210, initialNotes: 540, initialCommunications: 180, staff: 25, scope: "Real HTTP fixture invoking actual route handlers, permission/transaction services and PostgreSQL. Session boundary is an isolated in-memory fixture, not Next hosting, real staff login, physical-device UAT or production peak capacity.", thresholds: { readP95Ms: 5000, writeP95Ms: 8000, maximumMs: 15000 }, phases: [] };
  const request = async (token: string, path: string, body?: unknown, name?: string) => {
    const started = performance.now();
    const response = await fetch(origin + path, { method: body === undefined ? "GET" : "POST", headers: { cookie: `fixture=${token}`, origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const payload = await response.json();
    if (name) (timings[name] ??= []).push(performance.now() - started);
    return { status: response.status, payload };
  };
  let bookingIndex = 150;
  try {
    const guide = await fetch(origin + "/api/v1/operations/staff-guide", { headers: { cookie: `fixture=${tokenList[0]}` } });
    assert.equal(guide.status, 200); assert.match(guide.headers.get("content-type")!, /application\/pdf/); assert.match(guide.headers.get("cache-control")!, /no-store/);
    assert.equal(Buffer.from(await guide.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
    evidence.staffHandbookProtectedDownload = true;
    const deviceId = randomUUID();
    const snapshot = await request(tokenList[0], `/api/v1/offline/snapshot?facilityId=${store.id}&deviceId=${deviceId}&deviceLabel=Synthetic-fixture`);
    assert.equal(snapshot.status, 200); assert.equal(snapshot.payload.data.units.length, 210);
    assert.equal(new Date(snapshot.payload.data.expiresAt).getTime() - new Date(snapshot.payload.data.generatedAt).getTime(), 12 * 60 * 60 * 1000);
    assert.ok(!JSON.stringify(snapshot.payload).includes("PRIVATE-OTHER-STORE"));
    assert.equal((await request(tokenList[0], `/api/v1/offline/snapshot?facilityId=${foreign.id}&deviceId=${deviceId}`)).status, 403);
    for (const concurrent of [5, 15, 25]) {
      const before = performance.now();
      await Promise.all(Array.from({ length: concurrent }, async (_, i) => {
        const token = tokenList[i], customer = customers[i];
        const search = await request(token, "/api/v1/operations/followups?search=Synthetic", undefined, "search"); assert.equal(search.status, 200); assert.equal(search.payload.data.customers.length, 20); assert.ok(!JSON.stringify(search.payload).includes("PRIVATE-OTHER-STORE"));
        const history = await request(token, `/api/v1/customers/${customer.id}/history`, undefined, "history"); assert.equal(history.status, 200); assert.ok(history.payload.data.entries.length >= 4); assert.ok(history.payload.data.entries.every((entry: { kind: string }) => entry.kind !== "ACCOUNT"));
        const note = { facilityId: store.id, requestKey: randomUUID(), category: "HANDOVER", body: `Synthetic measured note ${concurrent}-${i}` };
        const written = await request(token, `/api/v1/customers/${customer.id}/history`, note, "note"); assert.equal(written.status, 200);
        const retried = await request(token, `/api/v1/customers/${customer.id}/history`, note, "noteRetry"); assert.equal(retried.status, 200); assert.equal(retried.payload.data.id, written.payload.data.id);
        const report = await request(token, `/api/v1/reports/preview?reportKey=unit-availability&from=2026-10-01&to=2026-10-31&facilityId=${store.id}`, undefined, "report"); assert.equal(report.status, 200); assert.equal(report.payload.data.length, 210);
        const index = bookingIndex++;
        const booking = await request(token, "/api/v1/leasing/reservations", { facilityId: store.id, customerId: customers[150 + i % 30].id, unitId: units[index].id, quotedRate: 100 }, "booking"); assert.equal(booking.status, 201);
      }));
      (evidence.phases as unknown[]).push({ concurrent, expectedRequests: concurrent * 6, elapsedMs: performance.now() - before, unexpectedErrors: 0 });
    }
    assert.equal((await request("invalid", `/api/v1/customers/${customers[0].id}/history`)).status, 401);
    assert.equal((await request(tokenList[0], `/api/v1/customers/${hidden.id}/history`)).status, 403);
    assert.equal((await request(tokenList[0], `/api/v1/customers/${customers[0].id}/history`, { facilityId: foreign.id, requestKey: randomUUID(), category: "HANDOVER", body: "Forbidden store" })).status, 403);
    assert.equal((await request(tokenList[0], "/api/v1/leasing/reservations", {})).status, 422);
    const conflicted = await request(tokenList[0], "/api/v1/leasing/reservations", { facilityId: store.id, customerId: customers[0].id, unitId: units[150].id, quotedRate: 100 }); assert.equal(conflicted.status, 409);
    const recovered = await request(tokenList[0], `/api/v1/customers/${customers[0].id}/history`); assert.equal(recovered.status, 200);
    const leadSubmissionId = randomUUID();
    const captured = { submissionId: leadSubmissionId, deviceId, capturedAt: new Date().toISOString(), firstName: "Synthetic", lastName: "Offline fixture", phone: "+27000000000", facilityId: store.id, consentToContact: true, communicationConsent: { email: false, sms: false, whatsapp: false } };
    const syncedLead = await request(tokenList[0], "/api/v1/offline/leads", captured); assert.equal(syncedLead.status, 201);
    const leadRetry = await request(tokenList[0], "/api/v1/offline/leads", captured); assert.equal(leadRetry.status, 200); assert.equal(leadRetry.payload.data.leadId, syncedLead.payload.data.leadId);
    const offlineBooking = { submissionId: randomUUID(), leadSubmissionId, deviceId, capturedAt: captured.capturedAt, facilityId: store.id, customerId: syncedLead.payload.data.customerId, leadId: syncedLead.payload.data.leadId, unitId: units[150].id, quotedRate: 100, paymentMethod: "UNDECIDED" };
    assert.equal((await request(tokenList[0], "/api/v1/offline/reservations", offlineBooking)).status, 409);
    offlineBooking.unitId = units[195].id;
    const syncedBooking = await request(tokenList[0], "/api/v1/offline/reservations", offlineBooking); assert.equal(syncedBooking.status, 201);
    const bookingRetry = await request(tokenList[0], "/api/v1/offline/reservations", offlineBooking); assert.equal(bookingRetry.status, 200); assert.equal(bookingRetry.payload.data.reservationId, syncedBooking.payload.data.reservationId);
    assert.ok(syncedBooking.payload.data.communications.every((item: { status: string }) => item.status === "NOT_CONSENTED"));
    const revision = await request(tokenList[0], `/api/v1/offline/snapshot?facilityId=${store.id}&check=1`); assert.equal(revision.status, 200); assert.notEqual(revision.payload.data.revision, snapshot.payload.data.revision);
    assert.equal(await db.customerNote.count({ where: { organisationId: org.id } }), 585);
    assert.equal(await db.reservation.count({ where: { facilityId: store.id } }), 46);
    assert.equal(await db.payment.count({ where: { account: { customer: { organisationId: org.id } } } }), 0);
    assert.equal(await db.webhookOutbox.count({ where: { organisationId: org.id } }), 0);
    const pool = await db.$queryRaw<{ connections: number }[]>`SELECT count(*)::int AS connections FROM pg_stat_activity WHERE application_name = 'stor24-crm' AND datname = current_database()`;
    assert.ok(pool[0].connections <= databaseLimits().max);
    evidence.connections = pool[0].connections;
    evidence.operations = Object.fromEntries(Object.entries(timings).map(([name, values]) => { values.sort((a, b) => a - b); const p95Ms = values[Math.ceil(values.length * .95) - 1]; assert.ok(p95Ms < (["note", "noteRetry", "booking"].includes(name) ? 8000 : 5000), `${name} p95 ${p95Ms}ms`); assert.ok(values.at(-1)! < 15000); return [name, { requests: values.length, p50Ms: values[Math.floor(values.length * .5)], p95Ms, maxMs: values.at(-1), unexpectedErrors: 0 }]; }));
    evidence.expectedNegativeChecks = { unauthenticated: 401, foreignCustomer: 403, foreignNoteStore: 403, invalidBooking: 422, bookedUnitConflict: 409, subsequentRecovery: 200, safeNoteRetries: 45 };
    evidence.offlineSourceBaseline = { authorisedSnapshot: true, expiryHours: 12, foreignStoreDenied: true, queuedLeadSafeRetry: true, staleBookedUnitConflict: true, reselectedUnitSafeRetry: true, sourceRevisionChangesOnReconnect: true, actualDeviceInstallOrOfflineBrowserUat: false, providerMessagesSent: 0 };
    evidence.result = "PASS";
  } finally {
    mkdirSync("output/readiness", { recursive: true }); writeFileSync("output/readiness/faeez-representative-workload.json", JSON.stringify(evidence, null, 2));
    await new Promise<void>(resolve => server.close(() => resolve())); await db.$disconnect();
  }
});
