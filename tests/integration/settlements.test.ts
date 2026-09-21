import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { settlementWorkspace, previewStatement, settlementAction, settlementDetail, settlementCsv } from "../../src/lib/settlement-service";
import { encryptIntegrationSecret } from "../../src/lib/integrations/integration-secret-vault";
import { merchantIdentity } from "../../src/lib/payments/netcash-statement";
const date = "2026-01-01";
const raw = (code = "PNC", value = 100, id = "1234", day = date) => [
  `${day}\tOBL\t0\tOpening\t0\t+\t0`,
  `${day}\t${code}\t${id}\t=CI source\t${Math.abs(value)}\t${value < 0 ? "-" : "+"}\t0`,
  `${day}\tCBL\t0\tClosing\t${value}\t+\t0`,
].join("\n");
test("isolated PostgreSQL settlement reconciliation", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "isolated-settlement-fixture-encryption-key-only";
  async function fixture(environment = "live") {
    const key = randomUUID(), org = await db.organisation.create({ data: { name: "Settlement CI", slug: key } });
    const importer = await db.user.create({ data: { organisationId: org.id, name: "CI preparer", email: key + "@example.invalid" } });
    const reviewer = await db.user.create({ data: { organisationId: org.id, name: "CI reviewer", email: "review-" + key + "@example.invalid" } });
    const scope = { organisationId: org.id, userId: importer.id, facilityIds: [], unrestrictedFacilities: true };
    const config = { environment: environment === "sandbox" ? "test" : "live", merchantAccountEncrypted: encryptIntegrationSecret("50000000000"), accountServiceKeyEncrypted: encryptIntegrationSecret("11111111-2222-3333-4444-555555555555") };
    const connection = await db.integrationConnection.create({ data: { organisationId: org.id, provider: "NETCASH", category: "PAYMENTS", config } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "CI fixture" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key, balance: -100 } });
    const payment = await db.payment.create({ data: { accountId: account.id, amount: 100, currency: "ZAR", method: "PAY_NOW", provider: "NETCASH", status: "SUCCEEDED", environment, providerMerchantKey: merchantIdentity(org.id, environment, "50000000000"), idempotencyKey: key } });
    const ledger = await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: 100, description: "CI receipt", metadata: { paymentId: payment.id, environment: "live", verifiedStatus: true }, effectiveAt: new Date(date) } });
    return { scope, reviewer: { ...scope, userId: reviewer.id }, config, connection, account, payment, ledger };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function imported(f: F, body = raw(), day = date, connectionId = f.connection.id) {
    const input = { connectionId, date: day, raw: body, sourceReference: "CI original provider statement" };
    const p = await previewStatement(f.scope, input);
    return await settlementAction(f.scope, { action: "import", ...input, fingerprint: p.fingerprint, confirm: true }) as { id: string };
  }
  const detail = (f: F, id: string) => settlementDetail(f.scope, id);
  async function resolve(f: F, id: string, targetId: string | null = f.payment.id, extra = {}) {
    const s = await detail(f, id);
    return settlementAction(f.scope, { action: "resolve", id, revision: s.revision, lineId: s.lines[0].id, targetId, reference: "CI original transaction reference", merchantConfirmed: true, requestKey: randomUUID(), ...extra });
  }
  async function state(f: F, id: string, action = "approve", scope = f.reviewer) {
    return settlementAction(scope, { action, id, revision: (await detail(f, id)).revision, reference: "CI independently checked source", confirm: true });
  }
  try {
    await t.test("scope isolation, encrypted source, import retry, duplicate day and merchant aliases", async () => {
      const f = await fixture(), other = await fixture(), s = await imported(f);
      assert.equal((await imported(f)).id, s.id);
      await assert.rejects(settlementWorkspace({ ...f.scope, unrestrictedFacilities: false }), /ORG_PERMISSION/);
      await assert.rejects(settlementDetail(other.scope, s.id), /NOT_FOUND/);
      const saved = await db.settlementStatement.findUniqueOrThrow({ where: { id: s.id } }); assert.ok(!saved.rawEncrypted.includes("CI source"));
      await assert.rejects(imported(f, raw("PNC", 101)), /DUPLICATE/);
      const alias = await db.integrationConnection.create({ data: { organisationId: f.scope.organisationId, provider: "NETCASH", category: "PAYMENTS", config: f.config } });
      assert.equal((await imported(f, raw(), date, alias.id)).id, s.id);
      await assert.rejects(imported(f, raw("PNC", 100, "1234", "2026-01-02"), "2026-01-02"), /Unique constraint/);
    });
    await t.test("exact verified receipt, independent review, idempotency, stale sources and no financial writes", async () => {
      const f = await fixture(), s = await imported(f), before = await detail(f, s.id);
      const action = { action: "resolve", id: s.id, revision: 0, lineId: before.lines[0].id, targetId: f.payment.id, reference: "CI receipt source", merchantConfirmed: false, requestKey: randomUUID() };
      await settlementAction(f.scope, action); await settlementAction(f.scope, action);
      await assert.rejects(settlementAction(f.scope, { ...action, reference: "Different intent" }), /CHANGED/);
      await assert.rejects(state(f, s.id, "approve", f.scope), /INDEPENDENT/);
      await state(f, s.id); assert.equal((await detail(f, s.id)).status, "REVIEWED");
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 1);
      assert.equal(await db.financialAdjustment.count({ where: { organisationId: f.scope.organisationId } }), 0);
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.scope.organisationId } }), 0);
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: f.scope.organisationId } }), 0);
      await db.account.update({ where: { id: f.account.id }, data: { balance: -99 } });
      assert.match((await detail(f, s.id)).lines[0].issue!, /inconsistent/);
      await state(f, s.id, "reopen"); await assert.rejects(state(f, s.id, "approve", { ...f.scope, userId: "different-reviewer" }), /UNRESOLVED/);
      assert.match(await settlementCsv(f.scope, s.id), /Current exception/);
    });
    await t.test("legacy merchant confirmation, wrong merchant, test payment and missing evidence are blocked", async () => {
      const f = await fixture(), s = await imported(f);
      await db.payment.update({ where: { id: f.payment.id }, data: { providerMerchantKey: null } });
      await assert.rejects(resolve(f, s.id, f.payment.id, { merchantConfirmed: false }), /MERCHANT/);
      await resolve(f, s.id);
      await db.payment.update({ where: { id: f.payment.id }, data: { providerMerchantKey: "other-merchant" } });
      await assert.rejects(resolve(f, s.id), /MERCHANT/);
      await db.payment.update({ where: { id: f.payment.id }, data: { providerMerchantKey: null, environment: "sandbox" } });
      await assert.rejects(resolve(f, s.id), /RECEIPT/);
      await db.payment.update({ where: { id: f.payment.id }, data: { environment: "live", status: "REFUNDED" } });
      await assert.rejects(resolve(f, s.id), /RECEIPT/);
      await db.payment.update({ where: { id: f.payment.id }, data: { status: "SUCCEEDED" } });
      await db.ledgerEntry.update({ where: { id: f.ledger.id }, data: { metadata: { paymentId: f.payment.id } } });
      await assert.rejects(resolve(f, s.id), /RECEIPT/);
    });
    await t.test("replacing a preparer's match does not make that preparer an independent reviewer", async () => {
      const f = await fixture(), s = await imported(f);
      await resolve({ ...f, scope: f.reviewer }, s.id);
      await resolve(f, s.id);
      await assert.rejects(state(f, s.id), /INDEPENDENT/);
    });
    await t.test("receipt reservation, stale revisions and audited void release", async () => {
      const f = await fixture(), s = await imported(f), next = await imported(f, raw("PNC", 100, "1235", "2026-01-02"), "2026-01-02");
      const loaded = await detail(f, s.id);
      const attempt = { action: "resolve", id: s.id, revision: loaded.revision, lineId: loaded.lines[0].id, targetId: f.payment.id, reference: "CI same reviewed revision", merchantConfirmed: true };
      const results = await Promise.allSettled([settlementAction(f.scope, { ...attempt, requestKey: randomUUID() }), settlementAction(f.scope, { ...attempt, requestKey: randomUUID() })]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      await assert.rejects(resolve(f, next.id), /Unique constraint/);
      await assert.rejects(resolve(f, s.id, f.payment.id, { revision: 0 }), /CHANGED/);
      await state(f, s.id, "void", f.scope); await resolve(f, next.id);
      assert.equal((await detail(f, s.id)).status, "VOID");
    });
    await t.test("bank payout matches require exact opposite sign, environment, date and independent importer", async () => {
      const f = await fixture(), s = await imported(f, raw("BTR", -100));
      const body = { action: "bank-import", alias: "CI operating bank", environment: "live", raw: "transaction_id,date,amount,reference\nBANK-1,2026-01-02,100,Netcash payout", sourceReference: "CI bank original", confirm: true };
      const importedBank = await settlementAction(f.scope, body) as { id: string };
      assert.equal((await settlementAction(f.scope, body) as { id: string }).id, importedBank.id);
      const bank = await db.settlementBankEntry.findFirstOrThrow({ where: { importId: importedBank.id } });
      await assert.rejects(resolve(f, s.id, f.payment.id), /BANK/);
      for (const amount of [-100, 99]) {
        await db.settlementBankEntry.update({ where: { id: bank.id }, data: { amount } });
        await assert.rejects(resolve(f, s.id, bank.id), /BANK/);
      }
      await db.settlementBankEntry.update({ where: { id: bank.id }, data: { amount: 100, date: "2025-12-31" } });
      await assert.rejects(resolve(f, s.id, bank.id), /BANK/);
      await db.settlementBankEntry.update({ where: { id: bank.id }, data: { date: "2026-01-02" } });
      await db.settlementBankImport.update({ where: { id: importedBank.id }, data: { environment: "sandbox" } });
      await assert.rejects(resolve(f, s.id, bank.id), /BANK/);
      await db.settlementBankImport.update({ where: { id: importedBank.id }, data: { environment: "live" } });
      await resolve(f, s.id, bank.id);
      const duplicate = await imported(f, raw("BTR", -100, "9876", "2026-01-02"), "2026-01-02");
      await assert.rejects(resolve(f, duplicate.id, bank.id), /Unique constraint/);
      await assert.rejects(settlementAction(f.scope, { action: "void-bank", id: importedBank.id, reference: "CI cannot void used", confirm: true }), /BANK/);
      await db.settlementBankImport.update({ where: { id: importedBank.id }, data: { importedById: f.reviewer.userId } });
      await resolve(f, s.id, bank.id);
      await assert.rejects(state(f, s.id), /INDEPENDENT/);
      await db.settlementBankImport.update({ where: { id: importedBank.id }, data: { importedById: f.scope.userId } });
      await resolve(f, s.id, bank.id); await state(f, s.id);
      const other = await fixture(); await assert.rejects(resolve(other, (await imported(other, raw("BTR", -100))).id, bank.id), /BANK/);
    });
    await t.test("fees require accounting evidence; unknown codes and corrupted sources cannot be approved", async () => {
      const f = await fixture(), s = await imported(f, raw("NSF", -100));
      await assert.rejects(state(f, s.id), /UNRESOLVED/); await resolve(f, s.id, null);
      await db.settlementStatement.update({ where: { id: s.id }, data: { rawEncrypted: encryptIntegrationSecret("changed") } });
      await assert.rejects(state(f, s.id), /INTEGRITY/);
      const other = await fixture(), unknown = await imported(other, raw("XYZ", 100));
      await assert.rejects(resolve(other, unknown.id, null), /UNSUPPORTED/);
    });
    await t.test("retained funds observation is separate and does not post income or expense", async () => {
      const f = await fixture();
      const body = { action: "balance", connectionId: f.connection.id, observedDate: date, current: "100", available: "0", reference: "CI provider portal balance", confirm: true };
      await settlementAction(f.scope, body);
      assert.equal((await settlementWorkspace(f.scope)).observations[0].held, "100.0000");
      await assert.rejects(settlementAction(f.scope, { ...body, available: "101" }), /AMOUNT/);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
    });
    await t.test("returns require the matching posted correction and preserve the original receipt", async () => {
      const f = await fixture(), s = await imported(f, raw("PNR", -100));
      const a = await db.financialAdjustment.create({ data: { organisationId: f.scope.organisationId, facilityId: "ci-store", accountId: f.account.id, requestKey: randomUUID(), kind: "REFUND", status: "POSTED", amount: 100, taxAmount: 0, sourceEntryId: f.ledger.id, paymentId: f.payment.id, reason: "CI actual external refund", evidenceReference: "CI refund evidence", snapshot: {}, fingerprint: "ci-source", requestedById: f.scope.userId, reviewedById: f.reviewer.userId, postedAt: new Date("2026-01-02") } });
      const correction = await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "REFUND", amount: 100, description: "CI refund", metadata: { adjustmentId: a.id, paymentId: f.payment.id, sourceEntryId: f.ledger.id }, effectiveAt: new Date("2026-01-02") } });
      await db.financialAdjustment.update({ where: { id: a.id }, data: { ledgerEntryId: correction.id } });
      await db.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED" } });
      await db.account.update({ where: { id: f.account.id }, data: { balance: 0 } });
      await resolve(f, s.id, a.id); await state(f, s.id);
      assert.equal((await db.ledgerEntry.findUniqueOrThrow({ where: { id: f.ledger.id } })).amount.toString(), "100");
      const wrong = await imported(f, raw("DRU", -100, "1255", "2026-01-02"), "2026-01-02");
      await assert.rejects(resolve(f, wrong.id, a.id), /RETURN/);
    });
    await t.test("retrieval ticket cannot switch organisation or merchant during provider retrieval", async () => {
      const f = await fixture(), other = await fixture(), original = globalThis.fetch;
      try {
        globalThis.fetch = async () => new Response("<RequestMerchantStatementResult>636682464000000000</RequestMerchantStatementResult>");
        const response = await settlementAction(f.scope, { action: "request", connectionId: f.connection.id, date }) as { ticket: string };
        await assert.rejects(settlementAction(other.scope, { action: "retrieve", ticket: response.ticket }), /CHANGED/);
        globalThis.fetch = async () => {
          await db.integrationConnection.update({ where: { id: f.connection.id }, data: { config: { ...f.config, merchantAccountEncrypted: encryptIntegrationSecret("50000000001") } } });
          return new Response("<RetrieveMerchantStatementResult><![CDATA[" + raw() + "]]></RetrieveMerchantStatementResult>");
        };
        await assert.rejects(settlementAction(f.scope, { action: "retrieve", ticket: response.ticket }), /CHANGED/);
        assert.equal(await db.settlementStatement.count({ where: { organisationId: f.scope.organisationId } }), 0);
      } finally { globalThis.fetch = original; }
    });
  } finally { await db.$disconnect(); }
});
