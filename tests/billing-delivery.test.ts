import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { escapeEmailHtml } from "../src/lib/email";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function fixture() {
  const documents: Row[] = [], logs: Row[] = [], messages: Row[] = [], audits: Row[] = [];
  let provider: (message: Row) => Promise<void> = async () => {};
  const db = {
    account: { findFirst: async () => ({ id: "account", accountNumber: "TEST", balance: "115", currency: "ZAR", customer: { id: "customer", email: "test@example.invalid", firstName: "Synthetic" }, tenancy: { id: "tenancy", facilityId: "facility", facility: { name: "Synthetic" }, occupancies: [] } }) },
    ledgerEntry: { findMany: async () => [{ id: "charge", type: "CHARGE", amount: "115", taxAmount: "15", description: "Synthetic rent", effectiveAt: new Date("2026-01-02"), reversalOfId: null }] },
    payment: { findMany: async () => [] },
    configurationProfile: { findFirst: async () => null },
    document: {
      count: async () => documents.length,
      create: async ({ data }: Row) => {
        if (documents.some(d => d.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const row = { id: "document", ...data }; documents.push(row); return { ...row };
      },
      findFirst: async ({ where }: Row) => { const row = documents.find(d => d.idempotencyKey === where.idempotencyKey); return row ? { ...row } : null; },
      update: async ({ data }: Row) => Object.assign(documents[0], data),
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
  const send = (kind: string) => kind === "invoice"
    ? loaded.exports.sendInvoiceEmail({ accountId: "account", organisationId: "org", actorId: "staff", ledgerEntryIds: ["charge"] })
    : loaded.exports.sendStatementEmail({ accountId: "account", organisationId: "org", actorId: "staff", from: new Date("2026-01-01"), to: new Date("2026-01-31") });
  return { send, documents, logs, messages, audits, setProvider: (fn: typeof provider) => { provider = fn; }, failFinalisation: () => { db.document.update = async () => { throw new Error("SYNTHETIC_FINALISATION_FAILURE"); }; } };
}

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
