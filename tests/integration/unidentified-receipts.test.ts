import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { encryptIntegrationSecret } from "../../src/lib/integrations/integration-secret-vault";
import { captureUnidentifiedReceipt, actOnUnidentifiedReceipt, unidentifiedReceiptWorkspace, unidentifiedReceiptAccounts, unidentifiedReceiptSources } from "../../src/lib/unidentified-receipt-service";

test("isolated unidentified evidence and matching review preserve money, provenance, independent review and rollback", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const previousKey = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const org = await db.organisation.create({ data: { name: "Synthetic unidentified review", slug: randomUUID() } });
  const foreign = await db.organisation.create({ data: { name: "Excluded synthetic organisation", slug: randomUUID() } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Fixture store", code: "RECEIPT-A" } });
  const other = await db.facility.create({ data: { organisationId: org.id, name: "Excluded store", code: "RECEIPT-B" } });
  const foreignFacility = await db.facility.create({ data: { organisationId: foreign.id, name: "Excluded foreign store", code: "RECEIPT-C" } });
  const operator = await db.user.create({ data: { organisationId: org.id, name: "Synthetic capturer", email: `${randomUUID()}@example.invalid` } });
  const reviewer = await db.user.create({ data: { organisationId: org.id, name: "Synthetic reviewer", email: `${randomUUID()}@example.invalid` } });
  const scope = { organisationId: org.id, userId: operator.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  const independent = { ...scope, userId: reviewer.id };
  const orgScope = { ...scope, unrestrictedFacilities: true, facilityIds: [] };
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic account" } });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: `REVIEW-${randomUUID()}` } });
  await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, startDate: new Date("2026-10-01") } });
  const hiddenCustomer = await db.customer.create({ data: { organisationId: foreign.id, firstName: "Synthetic excluded account" } });
  const hiddenAccount = await db.account.create({ data: { customerId: hiddenCustomer.id, accountNumber: `EXCLUDED-${randomUUID()}` } });
  await db.tenancy.create({ data: { facilityId: foreignFacility.id, customerId: hiddenCustomer.id, accountId: hiddenAccount.id, startDate: new Date("2026-10-01") } });
  const input = (reference: string = randomUUID()) => ({ facilityId: facility.id, requestKey: randomUUID(), source: { sourceType: "MANUAL_REPORTED" as const, evidenceReference: reference, receiptDate: "2026-10-14", amount: "100.20", currency: "ZAR" as const, note: "Synthetic original evidence only" } });
  async function financial() { return JSON.stringify(await Promise.all([db.account.findMany({ where: { customer: { organisationId: org.id } }, orderBy: { id: "asc" } }), db.payment.findMany({ where: { account: { customer: { organisationId: org.id } } }, orderBy: { id: "asc" } }), db.ledgerEntry.findMany({ where: { account: { customer: { organisationId: org.id } } }, orderBy: { id: "asc" } }), db.tenancy.findMany({ where: { customer: { organisationId: org.id } }, orderBy: { id: "asc" } })])); }
  const propose = (id: string, revision: number, accountId = account.id) => ({ action: "propose" as const, id, facilityId: facility.id, revision, accountId, reason: "Original reference suggests this exact synthetic account", confirmed: true as const });
  const review = (id: string, proposalId: string, revision: number) => ({ action: "review" as const, id, facilityId: facility.id, revision, proposalId, decision: "REVIEWED" as const, reference: "Synthetic independent review", confirmed: true as const });
  async function failAudit(action: string, run: () => Promise<void>) {
    const name = `receipt_audit_${randomUUID().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${name}" CHECK ("organisationId" <> '${org.id}' OR "action" <> 'receipt_review.${action}') NOT VALID`);
    try { await run(); } finally { await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${name}"`); }
  }
  try {
    await t.test("concurrent capture is idempotent, source identity is unique and private evidence stays encrypted", async () => {
      const baseline = await financial(), capture = input("Synthetic-original-0001");
      const results = await Promise.all([captureUnidentifiedReceipt(scope, capture), captureUnidentifiedReceipt(scope, capture)]);
      assert.equal(results[0].id, results[1].id);
      await assert.rejects(captureUnidentifiedReceipt(scope, { ...capture, source: { ...capture.source, amount: "200.20" } }), /CONFLICT/);
      await assert.rejects(captureUnidentifiedReceipt(scope, { ...capture, requestKey: randomUUID() }), /DUPLICATE/);
      const row = await db.unidentifiedReceiptIntake.findUniqueOrThrow({ where: { id: results[0].id } });
      assert.equal(row.sourceEnvironment, "REPORTED_UNVERIFIED"); assert.equal(row.amount.toFixed(2), "100.20");
      assert.ok(!row.evidenceEncrypted.includes(capture.source.evidenceReference));
      assert.equal(await db.auditEvent.count({ where: { entityId: row.id, action: "receipt_review.captured" } }), 1);
      assert.equal(await financial(), baseline);
    });
    await t.test("scoped exact account suggestions and independent review never post or allocate money", async () => {
      const baseline = await financial(), saved = await captureUnidentifiedReceipt(scope, input());
      await assert.rejects(actOnUnidentifiedReceipt({ ...scope, facilityIds: [other.id] }, propose(saved.id, 0)), /FORBIDDEN/);
      await assert.rejects(actOnUnidentifiedReceipt(scope, propose(saved.id, 0, hiddenAccount.id)), /ACCOUNT/);
      assert.equal((await unidentifiedReceiptAccounts(scope, facility.id, hiddenAccount.accountNumber)).rows.length, 0);
      await actOnUnidentifiedReceipt(scope, propose(saved.id, 0));
      const proposal = await db.unidentifiedReceiptMatchProposal.findFirstOrThrow({ where: { intakeId: saved.id } });
      await assert.rejects(actOnUnidentifiedReceipt(scope, review(saved.id, proposal.id, 1)), /INDEPENDENT/);
      await actOnUnidentifiedReceipt(independent, review(saved.id, proposal.id, 1));
      const row = await db.unidentifiedReceiptIntake.findUniqueOrThrow({ where: { id: saved.id } });
      assert.equal(row.status, "REVIEWED"); assert.equal(row.revision, 2);
      const accepted = await db.unidentifiedReceiptMatchProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      assert.equal(accepted.reviewedById, reviewer.id); assert.ok(!accepted.detailsEncrypted.includes("Original reference"));
      await assert.rejects(actOnUnidentifiedReceipt(scope, propose(saved.id, 0)), /CONFLICT/);
      await actOnUnidentifiedReceipt(scope, { action: "withdraw", id: saved.id, facilityId: facility.id, revision: 2, reference: "Synthetic retained withdrawal", confirmed: true });
      assert.equal((await db.unidentifiedReceiptMatchProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, "WITHDRAWN");
      assert.equal(await financial(), baseline);
    });
    await t.test("actual imported source bindings reject changed, test, duplicate and unsupported authorisation evidence", async () => {
      const bank = await db.settlementBankImport.create({ data: { organisationId: org.id, bankKey: "synthetic-bank", alias: "Synthetic import", environment: "live", sourceReference: "Synthetic source", rawEncrypted: encryptIntegrationSecret("synthetic file"), sha256: "a".repeat(64), importedById: operator.id, entries: { create: { bankKey: "synthetic-bank", transactionId: randomUUID(), date: "2026-10-14", amount: "123.45", reference: "Synthetic original bank reference" } } }, include: { entries: true } });
      await assert.rejects(unidentifiedReceiptSources(scope), /PERMISSION/);
      const candidate = (await unidentifiedReceiptSources(orgScope)).rows.find(row => row.sourceId === bank.entries[0].id)!; assert.ok(candidate);
      await assert.rejects(captureUnidentifiedReceipt(orgScope, { facilityId: facility.id, requestKey: randomUUID(), source: { sourceType: candidate.sourceType, sourceId: candidate.sourceId, sourceFingerprint: "b".repeat(64) } }), /CHANGED/);
      const source = { sourceType: candidate.sourceType, sourceId: candidate.sourceId, sourceFingerprint: candidate.sourceFingerprint };
      const saved = await captureUnidentifiedReceipt(orgScope, { facilityId: facility.id, requestKey: randomUUID(), source });
      await actOnUnidentifiedReceipt(scope, propose(saved.id, 0));
      await db.settlementBankImport.update({ where: { id: bank.id }, data: { status: "VOID" } });
      const proposal = await db.unidentifiedReceiptMatchProposal.findFirstOrThrow({ where: { intakeId: saved.id } });
      await assert.rejects(actOnUnidentifiedReceipt(independent, review(saved.id, proposal.id, 1)), /SOURCE|CHANGED/);
      assert.ok((await unidentifiedReceiptWorkspace(scope)).rows.find(row => row.id === saved.id)?.issue);
      const statement = await db.settlementStatement.create({ data: { organisationId: org.id, connectionId: "synthetic-only", merchantKey: "synthetic-merchant", merchantLabel: "Synthetic test merchant", environment: "test", date: "2026-10-14", source: "FIXTURE", sourceReference: "Synthetic statement", rawEncrypted: encryptIntegrationSecret("synthetic statement"), sha256: "c".repeat(64), opening: "0", closing: "10", importedById: operator.id, editedById: operator.id } });
      const line = await db.settlementLine.create({ data: { statementId: statement.id, merchantKey: statement.merchantKey, transactionId: randomUUID(), date: statement.date, code: "PNA", description: "Synthetic authorisation", amount: "0", vat: "0", extras: [], kind: "RECEIPT" } });
      assert.ok(!(await unidentifiedReceiptSources(orgScope)).rows.some(row => row.sourceId === line.id));
      await db.settlementLine.update({ where: { id: line.id }, data: { code: "PNC", amount: "10", description: "Synthetic settled test line" } });
      const testCandidate = (await unidentifiedReceiptSources(orgScope)).rows.find(row => row.sourceId === line.id)!; assert.ok(testCandidate);
      const testIntake = await captureUnidentifiedReceipt(orgScope, { facilityId: facility.id, requestKey: randomUUID(), source: { sourceType: testCandidate.sourceType, sourceId: testCandidate.sourceId, sourceFingerprint: testCandidate.sourceFingerprint } });
      await assert.rejects(actOnUnidentifiedReceipt(scope, propose(testIntake.id, 0)), /TEST_SOURCE/);
    });
    await t.test("account changes and concurrent revisions hold review without changing financial rows", async () => {
      const saved = await captureUnidentifiedReceipt(scope, input());
      const results = await Promise.allSettled([actOnUnidentifiedReceipt(scope, propose(saved.id, 0)), actOnUnidentifiedReceipt(scope, propose(saved.id, 0))]);
      assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
      await db.account.update({ where: { id: account.id }, data: { balance: "1.00" } });
      const baseline = await financial(), proposal = await db.unidentifiedReceiptMatchProposal.findFirstOrThrow({ where: { intakeId: saved.id } });
      await assert.rejects(actOnUnidentifiedReceipt(independent, review(saved.id, proposal.id, 1)), /CHANGED/);
      assert.equal(await financial(), baseline);
    });
    await t.test("capture, proposal and independent review roll back if their audit fails", async () => {
      const before = await db.unidentifiedReceiptIntake.count({ where: { organisationId: org.id } });
      await failAudit("captured", async () => { await assert.rejects(captureUnidentifiedReceipt(scope, input())); });
      assert.equal(await db.unidentifiedReceiptIntake.count({ where: { organisationId: org.id } }), before);
      const saved = await captureUnidentifiedReceipt(scope, input()), baseline = await financial();
      await failAudit("proposed", async () => { await assert.rejects(actOnUnidentifiedReceipt(scope, propose(saved.id, 0))); });
      assert.equal(await db.unidentifiedReceiptMatchProposal.count({ where: { intakeId: saved.id } }), 0);
      assert.equal((await db.unidentifiedReceiptIntake.findUniqueOrThrow({ where: { id: saved.id } })).revision, 0);
      await actOnUnidentifiedReceipt(scope, propose(saved.id, 0));
      const proposal = await db.unidentifiedReceiptMatchProposal.findFirstOrThrow({ where: { intakeId: saved.id } });
      await failAudit("reviewed", async () => { await assert.rejects(actOnUnidentifiedReceipt(independent, review(saved.id, proposal.id, 1))); });
      assert.equal((await db.unidentifiedReceiptMatchProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, "PROPOSED");
      assert.equal((await db.unidentifiedReceiptIntake.findUniqueOrThrow({ where: { id: saved.id } })).revision, 1);
      assert.equal(await financial(), baseline);
    });
    await t.test("pagination, corrupt evidence and organisation/store visibility remain explicit", async () => {
      await db.unidentifiedReceiptIntake.createMany({ data: Array.from({ length: 105 }, () => ({ organisationId: org.id, facilityId: facility.id, sourceType: "MANUAL_REPORTED", sourceIdentity: randomUUID(), sourceFingerprint: "a".repeat(64), evidenceEncrypted: "invalid-synthetic-envelope", sourceEnvironment: "REPORTED_UNVERIFIED", receiptDate: "2026-10-14", amount: "1.00", requestKey: randomUUID(), requestHash: "b".repeat(64), capturedById: operator.id })) });
      const first = await unidentifiedReceiptWorkspace(scope); assert.equal(first.rows.length, 50); assert.ok(first.nextCursor);
      const second = await unidentifiedReceiptWorkspace(scope, undefined, first.nextCursor!); assert.equal(second.rows.length, 50); assert.ok(second.rows.every(row => !first.rows.some(previous => previous.id === row.id)));
      assert.ok(first.rows.some(row => row.issue)); assert.ok(!JSON.stringify(first).includes("invalid-synthetic-envelope"));
      assert.equal((await unidentifiedReceiptWorkspace({ ...scope, facilityIds: [other.id] })).rows.length, 0);
      assert.equal((await unidentifiedReceiptWorkspace({ ...scope, organisationId: foreign.id, facilityIds: [foreignFacility.id] })).rows.length, 0);
    });
  } finally {
    await db.unidentifiedReceiptMatchProposal.deleteMany({ where: { intake: { organisationId: { in: [org.id, foreign.id] } } } });
    await db.unidentifiedReceiptIntake.deleteMany({ where: { organisationId: { in: [org.id, foreign.id] } } });
    await db.settlementLine.deleteMany({ where: { statement: { organisationId: org.id } } }); await db.settlementStatement.deleteMany({ where: { organisationId: org.id } });
    await db.settlementBankEntry.deleteMany({ where: { import: { organisationId: org.id } } }); await db.settlementBankImport.deleteMany({ where: { organisationId: org.id } });
    await db.auditEvent.deleteMany({ where: { organisationId: { in: [org.id, foreign.id] } } });
    await db.tenancy.deleteMany({ where: { customer: { organisationId: { in: [org.id, foreign.id] } } } });
    await db.account.deleteMany({ where: { customer: { organisationId: { in: [org.id, foreign.id] } } } });
    await db.user.deleteMany({ where: { organisationId: { in: [org.id, foreign.id] } } });
    await db.organisation.deleteMany({ where: { id: { in: [org.id, foreign.id] } } });
    if (previousKey === undefined) delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY; else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = previousKey;
    await db.$disconnect();
  }
});
