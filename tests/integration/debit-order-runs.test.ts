import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { cancelDebitRun, debitWorkspace, getDebitPlan, prepareDebitRun, previewDebitRun, refreshDebitRun, saveDebitPlan, submitDebitRun } from "../../src/lib/debit-order-service";
import { debitConnectionFingerprint } from "../../src/lib/payments/netcash-debit-batch";
import { encryptIntegrationSecret } from "../../src/lib/integrations/integration-secret-vault";
import { refreshHostedMandate } from "../../src/lib/public-hosted-mandate";
const period = "2099-02", actionDate = "2099-02-14", serviceKey = "11111111-2222-3333-4444-555555555555";
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
test("isolated PostgreSQL debit order runs", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "debit-ci-only-32-character-encryption-key";
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Debit CI", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "Debit CI store" } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "CI", email: `${key}@example.invalid` } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "CI" } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI", features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "1", monthlyRate: 1150 } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `DEBIT-CI-${key}`, balance: 1150 } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2099-01-01T00:00:00Z") } });
    const reservation = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 1150, convertedTenancyId: tenancy.id } });
    const lease = await db.publicReservationLease.create({ data: { reservationId: reservation.id, version: "CI", paymentMethod: "DEBIT_ORDER", content: "CI", clauses: [], sha256: sha("CI"), signingToken: key, expiresAt: new Date("2099-01-01"), status: "SIGNED", debitOrderPreferences: { firstCollectionDate: actionDate, collectionDay: 14 } } });
    const config = { environment: "test", merchantAccountEncrypted: encryptIntegrationSecret("51111111111"), debitOrderServiceKeyEncrypted: encryptIntegrationSecret(serviceKey), transactionProcessingEnabled: true };
    const connection = await db.integrationConnection.create({ data: { organisationId: org.id, facilityId: facility.id, category: "PAYMENTS", provider: "NETCASH", config } });
    const mandate = await db.publicDebitMandate.create({ data: { leaseId: lease.id, reference: `CI${key.replaceAll("-", "").slice(0, 18)}`, correlation: key, terms: { amount: "1150.00", debitDay: 14 }, environment: "sandbox", connectionId: connection.id, connectionFingerprint: debitConnectionFingerprint({ environment: "sandbox", merchantAccount: "51111111111", debitOrderServiceKey: serviceKey }), status: "SIGNED", verifiedAt: new Date(), signedPdf: Buffer.from("%PDF-CI"), signedPdfSha256: sha("%PDF-CI") } });
    const invoiceNumber = `INV-CI-${key}`;
    await db.ledgerEntry.create({ data: { accountId: account.id, amount: 1150, type: "CHARGE", description: "CI rent", effectiveAt: new Date("2099-02-01"), externalRef: "RENT-2099-02", metadata: { invoiceNumber } } });
    const invoice = await db.document.create({ data: { tenancyId: tenancy.id, type: "INVOICE", status: "GENERATED", storageKey: "CI", content: "CI invoice", sha256: sha("CI invoice"), externalId: invoiceNumber, idempotencyKey: `monthly-invoice:${account.id}:${period}` } });
    const scope = { organisationId: org.id, userId: user.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    const plan = { active: true, firstPeriod: period, masterfileConfirmed: true, approvalReference: "CI-only verified masterfile" };
    await saveDebitPlan(scope, account.id, plan);
    return { org, facility, account, tenancy, mandate, invoice, scope, connection, plan, lease };
  }
  const prepare = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const p = await previewDebitRun(f.scope, f.facility.id, period, actionDate);
    assert.equal(p.rows[0].blocker, undefined);
    return prepareDebitRun(f.scope, f.facility.id, period, actionDate, p.fingerprint);
  };
  const enable = (f: Awaited<ReturnType<typeof fixture>>) => {
    process.env.NETCASH_DEBIT_TEST_SUBMISSION_ENABLED = "true"; process.env.NETCASH_DEBIT_TEST_ACCOUNT_IDS = f.account.id; process.env.NETCASH_DEBIT_TEST_ACTION_DATES = actionDate;
  };
  try {
    await t.test("concurrent preparation reserves each invoice once; unsent cancellation keeps audit and frees reservation", async () => {
      const f = await fixture(); const p = await previewDebitRun(f.scope, f.facility.id, period, actionDate);
      const results = await Promise.allSettled([prepareDebitRun(f.scope, f.facility.id, period, actionDate, p.fingerprint), prepareDebitRun(f.scope, f.facility.id, period, actionDate, p.fingerprint)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const run = await db.debitOrderRun.findFirstOrThrow({ where: { organisationId: f.org.id } });
      assert.equal(await db.debitOrderInstruction.count({ where: { accountId: f.account.id } }), 1);
      await cancelDebitRun(f.scope, run.id);
      assert.equal((await db.debitOrderRun.findUniqueOrThrow({ where: { id: run.id } })).status, "CANCELLED");
      assert.ok((await prepare(f)).id);
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 0);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: f.account.id } }), 1);
    });
    await t.test("other stores/organisations cannot read, prepare, cancel or submit", async () => {
      const f = await fixture(); const run = await prepare(f);
      for (const scope of [{ ...f.scope, facilityIds: [] }, { ...f.scope, organisationId: "other" }]) {
        assert.equal((await debitWorkspace(scope)).runs.length, 0);
        await assert.rejects(getDebitPlan(scope, f.account.id), /NOT_FOUND/);
        await assert.rejects(previewDebitRun(scope, f.facility.id, period, actionDate), /FORBIDDEN/);
        await assert.rejects(cancelDebitRun(scope, run.id), /NOT_FOUND/);
        await assert.rejects(submitDebitRun(scope, run.id, run.batchName), /NOT_FOUND/);
      }
    });
    await t.test("stale previews and paused plans cannot be submitted; default processing stays disabled", async () => {
      const f = await fixture(); const run = await prepare(f);
      delete process.env.NETCASH_DEBIT_TEST_SUBMISSION_ENABLED;
      await assert.rejects(submitDebitRun(f.scope, run.id, run.batchName), /DISABLED/);
      enable(f); await saveDebitPlan(f.scope, f.account.id, { ...f.plan, active: false });
      let calls = 0;
      await assert.rejects(submitDebitRun(f.scope, run.id, run.batchName, async () => { calls++; return new Response(""); }), /PREVIEW_CHANGED/);
      assert.equal(calls, 0);
      assert.equal((await db.debitOrderRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PREPARED");
    });
    await t.test("concurrent submit uploads once; accepted load report posts no payment or receipt", async () => {
      const f = await fixture(); const run = await prepare(f); enable(f); let calls = 0;
      const request = async () => { calls++; return new Response("<BatchFileUploadResult>20000000.123.1.1</BatchFileUploadResult>"); };
      const attempts = await Promise.allSettled([submitDebitRun(f.scope, run.id, run.batchName, request), submitDebitRun(f.scope, run.id, run.batchName, request)]);
      assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1); assert.equal(calls, 1);
      const report = `###BEGIN\t${run.batchName}\tSUCCESSFUL\t01:00 PM\t1150.00\t20990214\n###END\t01:01 PM`;
      await refreshDebitRun(f.scope, run.id, async () => new Response(`<RequestFileUploadReportResult>${report}</RequestFileUploadReportResult>`));
      assert.equal((await db.debitOrderRun.findUniqueOrThrow({ where: { id: run.id } })).status, "ACCEPTED");
      assert.equal(await db.payment.count({ where: { accountId: f.account.id } }), 0);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toString(), "1150");
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0);
      await assert.rejects(cancelDebitRun(f.scope, run.id), /NOT_CANCELLABLE/);
    });
    await t.test("unknown transport outcome stays reserved and cannot automatically replay", async () => {
      const f = await fixture(); const run = await prepare(f); enable(f); let calls = 0;
      const timeout = async () => { calls++; throw new Error("simulated timeout with sensitive content"); };
      await assert.rejects(submitDebitRun(f.scope, run.id, run.batchName, timeout), /^Error: DEBIT_PROVIDER_OUTCOME_UNKNOWN$/);
      await assert.rejects(submitDebitRun(f.scope, run.id, run.batchName, timeout), /ALREADY_SUBMITTED/); assert.equal(calls, 1);
      assert.equal((await db.debitOrderRun.findUniqueOrThrow({ where: { id: run.id } })).status, "REVIEW_REQUIRED");
      assert.equal((await previewDebitRun(f.scope, f.facility.id, period, actionDate)).rows[0].blocker, "DEBIT_ALREADY_RESERVED");
    });
    await t.test("changed merchant, unsigned mandate, amount mismatch and receipts are blocked", async () => {
      const f = await fixture();
      await db.publicDebitMandate.update({ where: { id: f.mandate.id }, data: { status: "DECLINED" } });
      assert.equal((await previewDebitRun(f.scope, f.facility.id, period, actionDate)).rows[0].blocker, "DEBIT_SIGNED_MANDATE_REQUIRED");
      await db.publicDebitMandate.update({ where: { id: f.mandate.id }, data: { status: "SIGNED", terms: { amount: "1000", debitDay: 14 } } });
      assert.equal((await previewDebitRun(f.scope, f.facility.id, period, actionDate)).rows[0].blocker, "DEBIT_FIXED_MANDATE_AMOUNT_MISMATCH");
      await db.account.update({ where: { id: f.account.id }, data: { balance: 1050 } });
      assert.equal((await previewDebitRun(f.scope, f.facility.id, period, actionDate)).rows[0].blocker, "DEBIT_BALANCE_REVIEW_REQUIRED");
      await db.publicDebitMandate.update({ where: { id: f.mandate.id }, data: { environment: "live" } });
      assert.equal((await previewDebitRun(f.scope, f.facility.id, period, actionDate)).rows[0].blocker, "DEBIT_MANDATE_ENVIRONMENT_REVIEW");
    });
    await t.test("settled older payments do not block the next cycle, while new pending payments do", async () => {
      const f = await fixture();
      const payment = await db.payment.create({ data: { accountId: f.account.id, status: "SUCCEEDED", environment: "live", method: "EFT", amount: 1150, idempotencyKey: randomUUID(), processedAt: new Date(f.invoice.createdAt.getTime() - 86400000) } });
      assert.equal((await previewDebitRun(f.scope, f.facility.id, period, actionDate)).rows[0].blocker, undefined);
      await db.payment.update({ where: { id: payment.id }, data: { status: "PENDING" } });
      assert.equal((await previewDebitRun(f.scope, f.facility.id, period, actionDate)).rows[0].blocker, "DEBIT_BALANCE_REVIEW_REQUIRED");
    });
    await t.test("legacy pending mandate gains provenance only from a freshly matched signed provider report", async () => {
      for (const matches of [false, true]) {
        const f = await fixture();
        await db.integrationConnection.update({ where: { id: f.connection.id }, data: { facilityId: null } });
        await db.publicDebitMandate.update({ where: { id: f.mandate.id }, data: { status: "AWAITING_SIGNATURE", environment: null, connectionId: null, connectionFingerprint: null, verifiedAt: null, reportToken: "20000.123.1.1", reportRequestedAt: new Date(), terms: { reference: f.mandate.reference, amount: "1150.00", debitDay: 14, commencementMonth: 2, agreementDate: "20990101", agreementReference: "CI", noticeDays: 30, holiday: "VeryNextOrdinaryBusinessDay", correlation: f.mandate.correlation } } });
        const row = Array(41).fill("");
        Object.assign(row, { 0:"6",1:f.mandate.reference,3:"1150.00",11:"1",12:"2",13:"14",14:"20990101",15:"CI",16:"30",17:"1",21:"1",30:matches ? f.mandate.correlation : "unmatched",40:"0" });
        const report = `###BEGIN\t20990214\n${row.join("\t")}\n###END`;
        const network = mock.method(globalThis, "fetch", async () => new Response(`<RetrieveMandateDataResult>${report}</RetrieveMandateDataResult>`));
        try { await refreshHostedMandate(f.lease.signingToken); } finally { network.mock.restore(); }
        const mandate = await db.publicDebitMandate.findUniqueOrThrow({ where: { id: f.mandate.id } });
        assert.equal(mandate.status, matches ? "SIGNED" : "REVIEW_REQUIRED");
        assert.equal(mandate.environment, matches ? "sandbox" : null);
        assert.equal(mandate.connectionId, matches ? f.connection.id : null);
      }
    });
  } finally {
    delete process.env.NETCASH_DEBIT_TEST_SUBMISSION_ENABLED; delete process.env.NETCASH_DEBIT_TEST_ACCOUNT_IDS; delete process.env.NETCASH_DEBIT_TEST_ACTION_DATES;
    await db.$disconnect();
  }
});
