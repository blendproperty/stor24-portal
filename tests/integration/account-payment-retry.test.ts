import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import type { Prisma } from "../../src/generated/prisma/client";

test("isolated PostgreSQL account receipt retry and notification recovery", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  let notifications = 0, failNotification = false;
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Receipt CI", slug: key } });
  const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Synthetic" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Finance fixture", permissions: ["payments.manage"] } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Synthetic", email: `${key}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: facility.id } } } });
  const state = { db, session: { userId: user.id, sessionVersion: user.sessionVersion }, notify: async () => { notifications++; if (failNotification) throw new Error("SYNTHETIC_NOTIFICATION_FAILURE"); return { ok: true }; } };
  const output = await build({ entryPoints: ["src/app/api/v1/accounts/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "real-db-fake-notification", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|session|whatsapp)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__state.db;" : a.path.endsWith("/session") ? "export const getSession=async()=>__state.session;" : "export const sendWhatsAppTemplate=__state.notify;" }));
  } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  async function fixture() {
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", phone: "+27000000000" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: randomUUID(), balance: 1000 } });
    await db.tenancy.create({ data: { customerId: customer.id, accountId: account.id, facilityId: facility.id, status: "ACTIVE", startDate: new Date("2026-01-01") } });
    const input = { accountId: account.id, requestId: randomUUID(), amount: 100, method: "EFT", reference: "SYNTHETIC", receivedAt: "2026-01-02T10:00:00Z" };
    const post = (changes: Record<string, unknown> = {}) => loaded.exports.POST(new Request("https://example.invalid/api/v1/accounts", { method: "POST", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify({ ...input, ...changes }) }));
    return { account, input, post };
  }
  try {
    await t.test("three simultaneous retries commit one payment, ledger and audit", async () => {
      const f = await fixture(), before = notifications;
      const responses = await Promise.all([f.post(), f.post(), f.post()]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 201]);
      const bodies = await Promise.all(responses.map(r => r.json()));
      assert.equal(new Set(bodies.map(b => b.data.payment.id)).size, 1);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 1);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { entityId: bodies[0].data.payment.id, action: "payment.posted" } }), 1);
      assert.equal(Number((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance), 900);
      assert.equal(notifications - before, 1);
      assert.equal((await f.post({ amount: 101 })).status, 409);
      const other = await fixture();
      assert.equal((await other.post({ requestId: f.input.requestId })).status, 409);
      assert.equal(await db.payment.count({ where: { accountId: other.account.id } }), 0);
    });
    await t.test("notification exception preserves successful receipt and never repeats it", async () => {
      const f = await fixture(), before = notifications; failNotification = true;
      const response = await f.post(); assert.equal(response.status, 201);
      const body = await response.json(); assert.equal(body.data.notificationReviewRequired, true);
      assert.equal((await f.post()).status, 200);
      assert.equal(notifications - before, 1);
      assert.equal(await db.auditEvent.count({ where: { entityId: body.data.payment.id, action: "payment.notification_review_required" } }), 1);
      assert.equal(Number((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance), 900);
      failNotification = false;
    });
    await t.test("audit failure rolls back receipt and balance; same request can then recover", async () => {
      const f = await fixture(), before = notifications;
      const original = db.$transaction, transaction = db.$transaction.bind(db);
      db.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => callback(new Proxy(tx, { get(target, property) {
        if (property === "auditEvent") return { create: async () => { throw new Error("SYNTHETIC_AUDIT_FAILURE"); } };
        return Reflect.get(target, property);
      } })))) as typeof db.$transaction;
      try { assert.equal((await f.post()).status, 500); }
      finally { db.$transaction = original; }
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 0);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 0);
      assert.equal(Number((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance), 1000);
      assert.equal(notifications, before);
      assert.equal((await f.post()).status, 201);
      assert.equal(Number((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance), 900);
    });
    await t.test("current permission is required even for an existing receipt retry", async () => {
      const f = await fixture(); assert.equal((await f.post()).status, 201);
      await db.roleAssignment.deleteMany({ where: { userId: user.id } });
      assert.equal((await f.post()).status, 403);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 1);
    });
  } finally { await db.$disconnect(); }
});
