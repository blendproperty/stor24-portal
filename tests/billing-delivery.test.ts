import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { escapeEmailHtml } from "../src/lib/email";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function fixture() {
  const documents: Row[] = [], logs: Row[] = [], messages: Row[] = [], audits: Row[] = [];
  let provider: (message: Row) => Promise<void> = async () => {};
  let entries = [{ id: "charge", type: "CHARGE", amount: "115", taxAmount: "15", description: "Synthetic rent", effectiveAt: new Date("2026-01-02"), reversalOfId: null }];
  let transactionTail = Promise.resolve();
  const db: Row = {
    $queryRaw: async () => [],
    $transaction: async (fn: (client: Row) => Promise<unknown>) => {
      const previous = transactionTail; let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await fn(db); } finally { release(); }
    },
    account: { findFirst: async () => ({ id: "account", accountNumber: "TEST", balance: "115", currency: "ZAR", customer: { id: "customer", email: "test@example.invalid", firstName: "Synthetic" }, tenancy: { id: "tenancy", facilityId: "facility", facility: { name: "Synthetic" }, occupancies: [] } }) },
    ledgerEntry: { findMany: async () => entries },
    payment: { findMany: async () => [] },
    configurationProfile: { findFirst: async () => null },
    document: {
      count: async () => documents.length,
      create: async ({ data }: Row) => {
        if (documents.some(d => d.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const row = { id: `document-${documents.length}`, ...data }; documents.push(row); return { ...row };
      },
      findFirst: async ({ where }: Row) => { const row = documents.find(d => d.idempotencyKey === where.idempotencyKey); return row ? { ...row } : null; },
      update: async ({ where, data }: Row) => Object.assign(documents.find(row => row.id === where.id)!, data),
    },
    communicationLog: {
      findUnique: async ({ where }: Row) => logs.find(l => l.idempotencyKey === where.idempotencyKey) ?? null,
      upsert: async ({ where, create, update }: Row) => {
        const existing = logs.find(l => l.idempotencyKey === where.idempotencyKey);
        if (existing) return Object.assign(existing, update);
        const row = { id: "log", ...create }; logs.push(row); return row;
      },
    },
    auditEvent: { create: async ({ data }: Row) => { audits.push(data); return data; } },
  };
  const state = { db, escapeEmailHtml, send: async (message: Row) => { messages.push(message); await provider(message); } };
  const output = await build({
    entryPoints: ["src/lib/finance/billing-documents-service.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "synthetic-only", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(db|email)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__fixture.db;" : "export const escapeEmailHtml=__fixture.escapeEmailHtml; export const emailProvider=()=>({send:__fixture.send});" }));
    } }],
  });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__fixture", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  const send = (kind: string, dates: { from?: Date; to?: Date } = {}) => kind === "invoice"
    ? loaded.exports.sendInvoiceEmail({ accountId: "account", organisationId: "org", actorId: "staff", ledgerEntryIds: ["charge"] })
    : loaded.exports.sendStatementEmail({ accountId: "account", organisationId: "org", actorId: "staff", from: new Date("2026-01-01"), to: new Date("2026-01-31"), ...dates });
  return { send, documents, logs, messages, audits, setEntries: (rows: typeof entries) => { entries = rows; }, setProvider: (fn: typeof provider) => { provider = fn; }, failFinalisation: () => { db.document.update = async () => { throw new Error("SYNTHETIC_FINALISATION_FAILURE"); }; } };
}

test("different financial documents generated together receive distinct sequence numbers", async () => {
  const f = await fixture();
  const results = await Promise.all([10, 20, 30].map(day => f.send("statement", { to: new Date(`2026-01-${day}`) })));
  assert.ok(results.every(result => result.ok));
  assert.equal(f.documents.length, 3);
  const numbers = f.messages.map(message => message.subject.match(/STMT-\d{4}-\d+/)?.[0]);
  assert.equal(new Set(numbers).size, 3);
  assert.ok(numbers.every(Boolean));
});

test("emailed statement includes the full South African end date and matches portal boundaries", async () => {
  const f = await fixture();
  const row = (id: string, amount: string, date: string) => ({ id, type: "CHARGE", amount, taxAmount: "0", description: id, effectiveAt: new Date(date), reversalOfId: null });
  f.setEntries([
    row("opening-before-period", "1", "2025-12-31T21:59:59Z"),
    row("first-minute-in-period", "2", "2025-12-31T22:00:00Z"),
    row("last-minute-in-period", "3", "2026-01-31T21:59:59Z"),
    row("next-day-excluded", "100", "2026-01-31T22:00:00Z"),
  ]);
  assert.equal((await f.send("statement")).ok, true);
  const html = f.messages[0].html;
  assert.match(html, /first-minute-in-period/);
  assert.match(html, /last-minute-in-period/);
  assert.doesNotMatch(html, /next-day-excluded|opening-before-period/);
  assert.match(f.messages[0].text, /6\.00/);
  assert.match(html, /1 January 2026/);
  assert.match(html, /31 January 2026/);
});

test("invalid or reversed statement periods fail before saving or sending", async () => {
  for (const dates of [{ from: new Date("2026-02-01") }, { to: new Date("invalid") }]) {
    const f = await fixture();
    assert.deepEqual(await f.send("statement", dates), { ok: false, code: "INVALID_STATEMENT_PERIOD" });
    assert.equal(f.documents.length, 0); assert.equal(f.messages.length, 0);
  }
});

for (const kind of ["invoice", "statement"]) {
  test(`${kind}: confirmed repeat returns original result without sending or changing saved content`, async () => {
    const f = await fixture();
    const first = await f.send(kind), content = f.documents[0].content;
    assert.equal(first.ok, true);
    assert.deepEqual(await f.send(kind), first);
    assert.equal(f.messages.length, 1);
    assert.equal(f.audits.length, 1);
    assert.equal(f.messages[0].html, content);
    assert.equal(f.documents[0].content, content);
  });
  test(`${kind}: overlapping request cannot send while the first provider call is pending`, async () => {
    const f = await fixture();
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    f.setProvider(async () => { started(); await waiting; });
    const first = f.send(kind); await entered;
    try {
      assert.deepEqual(await f.send(kind), { ok: false, code: "DOCUMENT_DELIVERY_REVIEW_REQUIRED" });
      assert.equal(f.messages.length, 1);
    } finally { release(); await first; }
    assert.equal((await f.send(kind)).ok, true);
    assert.equal(f.messages.length, 1);
  });
  test(`${kind}: uncertain and legacy delivery records require review without another email`, async () => {
    const f = await fixture();
    f.setProvider(async () => { throw new Error("Synthetic uncertain provider response"); });
    assert.equal((await f.send(kind)).code, "EMAIL_FAILED");
    for (const status of ["FAILED", "PROCESSING", "PENDING", "DEAD_LETTER", "SUCCEEDED"]) {
      f.logs[0].status = status;
      assert.deepEqual(await f.send(kind), { ok: false, code: "DOCUMENT_DELIVERY_REVIEW_REQUIRED" });
    }
    f.logs.length = 0;
    assert.deepEqual(await f.send(kind), { ok: false, code: "DOCUMENT_DELIVERY_REVIEW_REQUIRED" });
    assert.equal(f.messages.length, 1);
  });
  test(`${kind}: persistence failure after provider success still prevents another send`, async () => {
    const f = await fixture(); f.failFinalisation();
    assert.equal((await f.send(kind)).code, "EMAIL_FAILED");
    assert.deepEqual(await f.send(kind), { ok: false, code: "DOCUMENT_DELIVERY_REVIEW_REQUIRED" });
    assert.equal(f.messages.length, 1);
  });
}
