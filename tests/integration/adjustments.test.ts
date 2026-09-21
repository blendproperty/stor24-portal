import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { adjustmentAccount, adjustmentDocument, adjustmentWorkspace, decideAdjustment, previewAdjustment, recordRefundPayout, requestAdjustment } from "../../src/lib/adjustment-service";
import { settleVerifiedBookingPayment } from "../../src/lib/payments/booking-payment-settlement";
import { buildAccountStatement } from "../../src/lib/finance/account-statement";
import { southAfricaDateKey } from "../../src/lib/south-africa-time";
import { netCollectionTotal } from "../../src/lib/finance/collection-total";

test("isolated PostgreSQL controlled adjustments", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture(paid = 0) {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Adjustment CI", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, code: key, name: "CI store" } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "Requester", email: `${key}@example.invalid` } });
    const approver = await db.user.create({ data: { organisationId: org.id, name: "Reviewer", email: `review-${key}@example.invalid` } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "CI" } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `ADJ-CI-${key}`, balance: 115 - paid } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, status: "ACTIVE", startDate: new Date("2026-01-01") } });
    const charge = await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 115, taxAmount: 15, description: "CI original rent", effectiveAt: new Date("2026-01-01"), externalRef: key } });
    const scope = { organisationId: org.id, userId: user.id, facilityIds: [facility.id], unrestrictedFacilities: false };
    const reviewer = { ...scope, userId: approver.id };
    let receipt = null, payment = null;
    if (paid) {
      payment = await db.payment.create({ data: { accountId: account.id, amount: paid, method: "EFT", status: "SUCCEEDED", idempotencyKey: key, provider: "NETCASH", providerRef: key, environment: "live", processedAt: new Date("2026-01-02") } });
      receipt = await db.ledgerEntry.create({ data: { accountId: account.id, type: "PAYMENT", amount: paid, description: "CI receipt", effectiveAt: new Date("2026-01-02"), externalRef: `netcash-payment:${payment.id}`, metadata: { paymentId: payment.id, verifiedStatus: true, environment: "live" } } });
    }
    const input = { accountId: account.id, kind: "CREDIT" as const, amount: "57.50", taxAmount: "0", sourceEntryId: charge.id, reason: "CI approved rent correction", evidenceReference: "CI-source-document" };
    return { org, facility, account, tenancy, charge, receipt, payment, scope, reviewer, input };
  }
  const request = async (f: Awaited<ReturnType<typeof fixture>>, input: unknown = f.input) => { const p = await previewAdjustment(f.scope, input); return requestAdjustment(f.scope, input, p.fingerprint, randomUUID()); };
  const balance = async (id: string) => (await db.account.findUniqueOrThrow({ where: { id } })).balance.toString();
  try {
    await t.test("concurrent approval posts one credit, proportional tax, document and audit", async () => {
      const f = await fixture(), r = await request(f);
      await assert.rejects(decideAdjustment(f.scope, r.id, "approve", "CI approval"), /SELF_APPROVAL/);
      const outcomes = await Promise.allSettled([decideAdjustment(f.reviewer, r.id, "approve", "CI approval"), decideAdjustment(f.reviewer, r.id, "approve", "CI approval")]);
      assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1); assert.equal(await balance(f.account.id), "57.5");
      const entries = await db.ledgerEntry.findMany({ where: { externalRef: `adjustment:${r.id}` } }); assert.equal(entries.length, 1); assert.equal(entries[0].taxAmount.toString(), "7.5");
      assert.match(await adjustmentDocument(f.scope, r.id), /CI original rent|Original entry/);
      assert.equal(await db.auditEvent.count({ where: { entityId: r.id, action: "adjustment.posted" } }), 1);
      await assert.rejects(request(f, { ...f.input, amount: "58" }), /EXCEEDS_SOURCE/);
    });
    await t.test("request retries and competing requests reserve one account", async () => {
      const f = await fixture(), p = await previewAdjustment(f.scope, f.input), key = randomUUID();
      const r = await requestAdjustment(f.scope, f.input, p.fingerprint, key);
      assert.equal((await requestAdjustment(f.scope, f.input, p.fingerprint, key)).id, r.id);
      await assert.rejects(requestAdjustment(f.scope, { ...f.input, amount: "1" }, p.fingerprint, key), /DUPLICATE/);
      await assert.rejects(request(f), /OPEN_REQUEST/);
      await decideAdjustment(f.scope, r.id, "cancel", "CI not proceeding");
      assert.equal(await balance(f.account.id), "115"); await request(f);
    });
    await t.test("organisation, store and source isolation", async () => {
      const f = await fixture(), other = await fixture(), r = await request(f);
      await assert.rejects(adjustmentAccount(other.scope, f.account.id), /NOT_FOUND/);
      await assert.rejects(decideAdjustment(other.reviewer, r.id, "approve", "CI approval"), /NOT_FOUND/);
      await assert.rejects(adjustmentAccount({ ...f.scope, facilityIds: [] }, f.account.id), /NOT_FOUND/);
      assert.equal((await adjustmentWorkspace(other.scope)).requests.length, 0);
      await assert.rejects(previewAdjustment(other.scope, { ...other.input, sourceEntryId: f.charge.id }), /SOURCE/);
    });
    await t.test("stale preview and stale approval cannot post", async () => {
      const f = await fixture(), p = await previewAdjustment(f.scope, f.input);
      await db.configurationProfile.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY", config: { defaults: { Refunds: { maximumRefund: 50 } } } } });
      await assert.rejects(requestAdjustment(f.scope, f.input, p.fingerprint, randomUUID()), /CHANGED/);
      const r = await request(f);
      await db.ledgerEntry.update({ where: { id: f.charge.id }, data: { description: "Corrected source description" } });
      await assert.rejects(decideAdjustment(f.reviewer, r.id, "approve", "CI approval"), /CHANGED/);
      assert.equal(await balance(f.account.id), "115");
    });
    await t.test("refund approval does not move balance; external recording is once and bounded", async () => {
      const f = await fixture(200), input = { ...f.input, kind: "REFUND", amount: "60", sourceEntryId: f.receipt!.id }, r = await request(f, input);
      await decideAdjustment(f.reviewer, r.id, "approve", "CI payout approval"); assert.equal(await balance(f.account.id), "-85");
      await assert.rejects(recordRefundPayout(f.scope, r.id, "CI-paid", southAfricaDateKey(new Date())), /SELF_APPROVAL/);
      await assert.rejects(recordRefundPayout(f.reviewer, r.id, "CI-paid", "2026-02-30"), /PAYOUT_DATE/);
      const result = await recordRefundPayout(f.reviewer, r.id, "CI-paid", southAfricaDateKey(new Date()));
      assert.equal(result.status, "POSTED"); assert.equal(await balance(f.account.id), "-25");
      assert.equal((await db.payment.findUniqueOrThrow({ where: { id: f.payment!.id } })).status, "PARTIALLY_REFUNDED");
      assert.equal(await netCollectionTotal(f.scope, new Date("2026-01-01")), 140);
      assert.equal(await netCollectionTotal(f.scope, new Date("2026-01-01"), new Date("2026-02-01")), 200);
      assert.equal(await netCollectionTotal(f.scope, new Date("2026-02-01")), -60);
      await settleVerifiedBookingPayment(f.payment!.id, { reference: f.payment!.providerRef!, amount: 200, accepted: true, requestTrace: "CI old success after refund" });
      assert.equal(await balance(f.account.id), "-25");
      await assert.rejects(recordRefundPayout(f.reviewer, r.id, "CI-paid", southAfricaDateKey(new Date())), /STATE/);
      await assert.rejects(request(f, { ...input, amount: "25.01" }), /EXCEEDS_SOURCE/);
      const next = await request(f, { ...input, amount: "25" }); await decideAdjustment(f.reviewer, next.id, "approve", "CI next approval");
      await assert.rejects(recordRefundPayout(f.reviewer, next.id, "ci-paid", southAfricaDateKey(new Date())), /Unique constraint/);
      assert.equal(await balance(f.account.id), "-25");
      const ledger = await db.ledgerEntry.findMany({ where: { accountId: f.account.id }, orderBy: { effectiveAt: "asc" } });
      assert.equal(buildAccountStatement(ledger.map(e => ({ ...e, amount: e.amount.toString() })), new Date(0), new Date("2099-01-01")).closingBalance, "-25.00");
      assert.equal(await db.communicationLog.count({ where: { organisationId: f.org.id } }), 0); assert.equal(await db.webhookOutbox.count({ where: { organisationId: f.org.id } }), 0);
    });
    await t.test("full receipt reversal is permanent against provider callback replay", async () => {
      const f = await fixture(200), input = { ...f.input, kind: "REVERSAL", amount: "200", sourceEntryId: f.receipt!.id };
      await assert.rejects(request(f, { ...input, amount: "199" }), /EXCEEDS_SOURCE/);
      const r = await request(f, input); await decideAdjustment(f.reviewer, r.id, "approve", "CI bank unpaid notice");
      assert.equal(await balance(f.account.id), "115");
      await settleVerifiedBookingPayment(f.payment!.id, { reference: f.payment!.providerRef!, amount: 200, accepted: true, requestTrace: "CI old success" });
      assert.equal(await balance(f.account.id), "115"); assert.equal((await db.payment.findUniqueOrThrow({ where: { id: f.payment!.id } })).status, "REVERSED");
      await assert.rejects(request(f, input), /EXCEEDS_SOURCE|SOURCE/);
    });
    await t.test("test ledger, unverified provider and unreconciled balance are blocked", async () => {
      const f = await fixture(200);
      await db.payment.update({ where: { id: f.payment!.id }, data: { environment: "sandbox" } }); await assert.rejects(request(f), /TEST_REVIEW/);
      await db.payment.update({ where: { id: f.payment!.id }, data: { environment: null } });
      await assert.rejects(request(f, { ...f.input, kind: "REFUND", amount: "1", sourceEntryId: f.receipt!.id }), /SOURCE/);
      await db.account.update({ where: { id: f.account.id }, data: { balance: 1 } }); await assert.rejects(request(f), /RECONCILIATION/);
    });
    await t.test("refund policy minimum and maximum are enforced without guessed role overrides", async () => {
      const f = await fixture(200), input = { ...f.input, kind: "REFUND", amount: "10", sourceEntryId: f.receipt!.id };
      await db.configurationProfile.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY", config: { defaults: { Refunds: { minimumRefund: 20, maximumRefund: 50 } } } } });
      await assert.rejects(request(f, input), /POLICY_REVIEW/); await assert.rejects(request(f, { ...input, amount: "51" }), /POLICY_REVIEW/);
      await request(f, { ...input, amount: "25" });
    });
    await t.test("approved refund cancellation requires unpaid attestation; current account changes block recording", async () => {
      const f = await fixture(200), r = await request(f, { ...f.input, kind: "REFUND", amount: "20", sourceEntryId: f.receipt!.id });
      await decideAdjustment(f.reviewer, r.id, "approve", "CI refund approved");
      await assert.rejects(decideAdjustment(f.reviewer, r.id, "cancel", "CI not paid"), /UNPAID_CONFIRMATION/);
      await db.ledgerEntry.update({ where: { id: f.charge.id }, data: { description: "Changed account evidence" } });
      await assert.rejects(recordRefundPayout(f.reviewer, r.id, "CI-new-payout", southAfricaDateKey(new Date())), /CHANGED/);
      await decideAdjustment(f.reviewer, r.id, "cancel", "CI confirmed not paid", true); assert.equal(await balance(f.account.id), "-85");
    });
    await t.test("concurrent different requests reserve only one review", async () => {
      const f = await fixture(), p = await previewAdjustment(f.scope, f.input);
      const outcomes = await Promise.allSettled([requestAdjustment(f.scope, f.input, p.fingerprint, randomUUID()), requestAdjustment(f.scope, f.input, p.fingerprint, randomUUID())]);
      assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
      assert.equal(await db.financialAdjustment.count({ where: { accountId: f.account.id } }), 1);
    });
    await t.test("write-offs cannot exceed positive debt; charges retain explicit tax", async () => {
      const f = await fixture(100);
      await assert.rejects(request(f, { ...f.input, kind: "WRITE_OFF", amount: "16" }), /EXCEEDS_SOURCE/);
      const r = await request(f, { ...f.input, kind: "WRITE_OFF", amount: "15" }); await decideAdjustment(f.reviewer, r.id, "approve", "CI write-off approval"); assert.equal(await balance(f.account.id), "0");
      const charge = await request(f, { ...f.input, kind: "CHARGE", sourceEntryId: null, amount: "11.50", taxAmount: "1.50" }); await decideAdjustment(f.reviewer, charge.id, "approve", "CI extra service"); assert.equal(await balance(f.account.id), "11.5");
    });
    await t.test("rejection releases reservation and failed posting rolls approval back", async () => {
      const f = await fixture(), r = await request(f); await decideAdjustment(f.reviewer, r.id, "reject", "CI missing evidence");
      const next = await request(f); await assert.rejects(decideAdjustment({ ...f.reviewer, userId: "missing-user" }, next.id, "approve", "CI invalid actor"));
      assert.equal((await db.financialAdjustment.findUniqueOrThrow({ where: { id: next.id } })).status, "PENDING_APPROVAL"); assert.equal(await balance(f.account.id), "115");
    });
  } finally { await db.$disconnect(); }
});
