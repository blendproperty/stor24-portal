import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function fixture() {
  let balance = 1000, notifications = 0, notificationFailure = false, auditFailure = false;
  const payments: Row[] = [], ledger: Row[] = [], audits: Row[] = [];
  const account = { id: "account-1", accountNumber: "TEST", customer: { id: "customer", phone: "synthetic", firstName: "Test" }, tenancy: { facilityId: "facility" } };
  const db: Row = {
    account: { findFirst: async () => account, findUniqueOrThrow: async () => ({ ...account, balance }), update: async ({ data }: Row) => ({ balance: balance -= data.balance.decrement }) },
    payment: { findUnique: async ({ where }: Row) => payments.find(p => p.idempotencyKey === where.idempotencyKey) ?? null, create: async ({ data }: Row) => { const p = { id: `payment-${payments.length}`, ...data }; payments.push(p); return p; } },
    ledgerEntry: { create: async ({ data }: Row) => { const row = { id: `ledger-${ledger.length}`, ...data }; ledger.push(row); return row; } },
    auditEvent: { create: async ({ data }: Row) => { if (auditFailure) throw new Error("SYNTHETIC_AUDIT_FAILURE"); audits.push(data); return data; } },
    $queryRaw: async () => [{ id: account.id }],
  };
  db.$transaction = async (fn: (tx: Row) => unknown) => {
    const snapshot = [balance, payments.length, ledger.length, audits.length];
    try { return await fn(db); } catch (error) { balance = snapshot[0]; payments.length = snapshot[1]; ledger.length = snapshot[2]; audits.length = snapshot[3]; throw error; }
  };
  const state = { db, auth: { organisationId: "org", user: { id: "staff" } }, notify: async () => { notifications++; if (notificationFailure) throw new Error("SYNTHETIC_NOTIFICATION_FAILURE"); return { ok: true }; } };
  const result = await build({ entryPoints: ["src/app/api/v1/accounts/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-payment", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|auth-guards|whatsapp)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__state.db;" : a.path.endsWith("/whatsapp") ? "export const sendWhatsAppTemplate=__state.notify;" : "export const requirePermission=async()=>__state.auth; export const authErrorResponse=()=>Response.json({error:{message:'Failure'}},{status:500});" }));
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__state", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const input = { accountId: "account-1", amount: 100, method: "EFT", reference: "SYNTHETIC", receivedAt: "2026-01-02T10:00:00Z", requestId: "11111111-1111-4111-8111-111111111111" };
  const post = (change: Row = {}) => loaded.exports.POST(new Request("https://example.invalid/api/v1/accounts", { method: "POST", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify({ ...input, ...change }) }));
  return { post, payments, ledger, audits, balance: () => balance, notifications: () => notifications, failNotification: () => { notificationFailure = true; }, failAudit: () => { auditFailure = true; } };
}

test("retrying an account receipt changes the balance once and does not repeat notifications", async () => {
  const f = await fixture();
  assert.equal((await f.post()).status, 201);
  assert.equal((await f.post()).status, 200);
  assert.equal(f.payments.length, 1); assert.equal(f.ledger.length, 1); assert.equal(f.balance(), 900); assert.equal(f.notifications(), 1);
  assert.equal(f.audits.filter(a => a.action === "payment.posted").length, 1);
  for (const change of [{ amount: 101 }, { method: "CASH" }, { reference: "OTHER" }, { receivedAt: "2026-01-03T10:00:00Z" }]) assert.equal((await f.post(change)).status, 409);
  assert.equal(f.payments.length, 1); assert.equal(f.balance(), 900);
});

test("a failed notification does not turn a committed payment into a failed payment response", async () => {
  const f = await fixture(); f.failNotification();
  const response = await f.post(); assert.equal(response.status, 201);
  assert.equal((await response.json()).data.notificationReviewRequired, true);
  assert.equal((await f.post()).status, 200);
  assert.equal(f.payments.length, 1); assert.equal(f.balance(), 900); assert.equal(f.notifications(), 1);
});

test("missing retry IDs, sub-cent amounts and audit failures cannot record receipts", async () => {
  const f = await fixture();
  for (const change of [{ requestId: undefined }, { requestId: "not-a-uuid" }, { amount: 1.001 }]) assert.equal((await f.post(change)).status, 422);
  assert.equal(f.payments.length, 0);
  f.failAudit(); assert.equal((await f.post()).status, 500);
  assert.equal(f.payments.length, 0); assert.equal(f.ledger.length, 0); assert.equal(f.balance(), 1000); assert.equal(f.notifications(), 0);
});
