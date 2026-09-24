import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { escapeEmailHtml } from "../../src/lib/email";
import type { Prisma } from "../../src/generated/prisma/client";

test("isolated PostgreSQL billing delivery claim", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  let sends = 0;
  const messages: { html: string; text: string }[] = [];
  let provider: () => Promise<void> = async () => {};
  const state = { db, escapeEmailHtml, send: async (message: { html: string; text: string }) => { sends++; messages.push(message); await provider(); } };
  const output = await build({
    entryPoints: ["src/lib/finance/billing-documents-service.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "real-db-fake-delivery", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(db|email)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__fixture.db;" : "export const escapeEmailHtml=__fixture.escapeEmailHtml; export const emailProvider=()=>({send:__fixture.send});" }));
    } }],
  });
  type Result = { ok: boolean; code?: string; documentId?: string };
  const loaded = { exports: {} as Record<string, (input: Record<string, unknown>) => Promise<Result>> };
  new Function("require", "module", "exports", "__fixture", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  async function fixture(kind: string) {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Delivery CI", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Synthetic" } });
    const user = await db.user.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, name: "Synthetic" } });
    const customer = await db.customer.create({ data: { organisationId: org.id, email: `${key}@example.invalid`, firstName: "Synthetic" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key, balance: 115 } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2026-01-01") } });
    const charge = await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 115, taxAmount: 15, description: "Synthetic", effectiveAt: new Date("2026-01-02") } });
    const input = { organisationId: org.id, accountId: account.id, actorId: user.id };
    const send = () => kind === "invoice"
      ? loaded.exports.sendInvoiceEmail({ ...input, ledgerEntryIds: [charge.id] })
      : loaded.exports.sendStatementEmail({ ...input, from: new Date("2026-01-01"), to: new Date("2026-01-31") });
    return { org, tenancy, account, charge, input, send };
  }
  try {
    for (const kind of ["invoice", "statement"]) {
      await t.test(`${kind} concurrent distinct documents have distinct numbers and rollback cannot send`, async () => {
        const f = await fixture(kind), before = sends;
        provider = async () => {};
        const original = db.$transaction, transaction = db.$transaction.bind(db);
        db.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => callback(new Proxy(tx, { get(target, property) {
          if (property === "document") return { ...target.document, create: async () => { throw new Error("SYNTHETIC_DOCUMENT_FAILURE"); } };
          return Reflect.get(target, property);
        } })))) as typeof db.$transaction;
        try { await assert.rejects(f.send(), /SYNTHETIC_DOCUMENT_FAILURE/); }
        finally { db.$transaction = original; }
        assert.equal(sends, before);
        assert.equal(await db.document.count({ where: { tenancyId: f.tenancy.id } }), 0);
        let results;
        if (kind === "invoice") {
          const charges = [f.charge];
          for (let index = 0; index < 2; index++) charges.push(await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "CHARGE", amount: 115, taxAmount: 15, description: `Synthetic ${index}`, effectiveAt: new Date("2026-01-02") } }));
          await db.account.update({ where: { id: f.account.id }, data: { balance: 345 } });
          results = await Promise.all(charges.map(charge => loaded.exports.sendInvoiceEmail({ ...f.input, ledgerEntryIds: [charge.id] })));
        } else {
          results = await Promise.all([10, 20, 30].map(day => loaded.exports.sendStatementEmail({ ...f.input, from: new Date("2026-01-01"), to: new Date(`2026-01-${day}`) })));
        }
        assert.ok(results.every(result => result.ok));
        const documents = await db.document.findMany({ where: { tenancyId: f.tenancy.id }, orderBy: { createdAt: "asc" } });
        const numbers = documents.map(document => document.content?.match(/(?:INV|STMT)-\d{4}-\d+/)?.[0]);
        assert.equal(documents.length, 3); assert.equal(new Set(numbers).size, 3); assert.ok(numbers.every(Boolean));
        assert.deepEqual(numbers.map(number => Number(number!.split("-").at(-1))).sort(), [1, 2, 3]);
        assert.equal(sends - before, 3);
        assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, entityType: "Document" } }), 3);
      });
      await t.test(`${kind} unique document prevents overlapping and completed resends`, async () => {
        const f = await fixture(kind), before = sends;
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { entered = resolve; });
        provider = async () => { entered(); await waiting; };
        const first = f.send(); await started;
        try { assert.equal((await f.send()).code, "DOCUMENT_DELIVERY_REVIEW_REQUIRED"); }
        finally { release(); await first; }
        const result = await f.send(); assert.equal(result.ok, true);
        assert.equal(sends - before, 1);
        assert.equal(await db.document.count({ where: { tenancyId: f.tenancy.id } }), 1);
        assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id, status: "SUCCEEDED" } }), 1);
        assert.equal(await db.auditEvent.count({ where: { entityId: result.documentId } }), 1);
      });
      await t.test(`${kind} provider uncertainty cannot trigger a second attempt`, async () => {
        const f = await fixture(kind), before = sends;
        provider = async () => { throw new Error("Synthetic uncertainty"); };
        assert.equal((await f.send()).code, "EMAIL_FAILED");
        assert.equal((await f.send()).code, "DOCUMENT_DELIVERY_REVIEW_REQUIRED");
        assert.equal(sends - before, 1);
        assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id, status: "FAILED" } }), 1);
      });
    }
    await t.test("emailed statement includes exact South African day boundaries", async () => {
      const f = await fixture("statement"); provider = async () => {};
      await db.ledgerEntry.deleteMany({ where: { accountId: f.account.id } });
      await db.ledgerEntry.createMany({ data: [
        { description: "opening", amount: 1, effectiveAt: new Date("2025-12-31T21:59:59Z") },
        { description: "first-minute", amount: 2, effectiveAt: new Date("2025-12-31T22:00:00Z") },
        { description: "last-minute", amount: 3, effectiveAt: new Date("2026-01-31T21:59:59Z") },
        { description: "next-day", amount: 100, effectiveAt: new Date("2026-01-31T22:00:00Z") },
      ].map(row => ({ ...row, accountId: f.account.id, type: "CHARGE" as const })) });
      assert.equal((await f.send()).ok, true);
      const message = messages.at(-1)!;
      assert.match(message.html, /first-minute/); assert.match(message.html, /last-minute/);
      assert.doesNotMatch(message.html, /next-day/); assert.match(message.text, /6\.00/);
      const audit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: f.org.id } });
      assert.equal((audit.after as { from: string }).from, "2025-12-31T22:00:00.000Z");
      assert.equal((audit.after as { to: string }).to, "2026-01-31T21:59:59.999Z");
    });
  } finally { await db.$disconnect(); }
});
