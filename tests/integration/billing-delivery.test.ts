import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { escapeEmailHtml } from "../../src/lib/email";

test("isolated PostgreSQL billing delivery claim", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  let sends = 0;
  let provider: () => Promise<void> = async () => {};
  const state = { db, escapeEmailHtml, send: async () => { sends++; await provider(); } };
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
    return { org, tenancy, send };
  }
  try {
    for (const kind of ["invoice", "statement"]) {
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
  } finally { await db.$disconnect(); }
});
