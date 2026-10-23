import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { getUatResetPreview, getTestCustomerCleanupPreview, resetUatCustomerData } from "../../src/lib/uat-reset-service";

test("isolated PostgreSQL customer reset handles restrictive workflow records atomically", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  async function fixture() {
    const key = randomUUID();
    const org = await db.organisation.create({ data: { name: "Reset CI only", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "CI store", code: key } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "CI owner", email: `${key}@example.invalid` } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic customer" } });
    await db.customerNote.create({ data: { organisationId: org.id, customerId: customer.id, facilityId: facility.id, authorId: user.id, authorName: user.name, category: "GENERAL", body: "Synthetic reset note", requestKey: key } });
    const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
    const type = await db.unitType.create({ data: { facilityId: facility.id, name: "CI type", features: [] } });
    const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "CI-1", monthlyRate: 100, status: "OCCUPIED" } });
    const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: customer.id, accountId: account.id, startDate: new Date(), occupancies: { create: { unitId: unit.id, startDate: new Date(), monthlyRate: 100, status: "ACTIVE" } } } });
    await db.reservation.create({ data: { facilityId: facility.id, unitId: unit.id, customerId: customer.id, quotedRate: 100 } });
    await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 100, description: "CI", effectiveAt: new Date() } });
    const payment = await db.payment.create({ data: { accountId: account.id, amount: 20, method: "TEST", idempotencyKey: key } });
    const product = await db.product.create({ data: { organisationId: org.id, facilityId: facility.id, sku: key, name: "Box", category: "Boxes", sellingPrice: 10, quantityOnHand: 10, quantityReserved: 5 } });
    const order = await db.merchandiseOrder.create({ data: { organisationId: org.id, facilityId: facility.id, accountId: account.id, unitId: unit.id, paymentId: payment.id, total: 20, idempotencyKey: key, expiresAt: new Date(), items: { create: { productId: product.id, name: "Box", sku: key, quantity: 2, unitPrice: 10 } } } });
    // A cancelled order must never release the same stock again.
    await db.merchandiseOrder.create({ data: { organisationId: org.id, facilityId: facility.id, accountId: account.id, unitId: unit.id, total: 10, stockHeld: false, status: "CANCELLED", idempotencyKey: randomUUID(), expiresAt: new Date(), items: { create: { productId: product.id, name: "Box", sku: key, quantity: 1, unitPrice: 10 } } } });
    const task = await db.task.create({ data: { organisationId: org.id, customerId: customer.id, title: "CI request" } });
    await db.tenantMerchandiseRequest.create({ data: { customerId: customer.id, facilityId: facility.id, unitId: unit.id, unitKey: unit.id, items: [], total: 10, idempotencyKey: key, taskId: task.id } });
    const collection = await db.collectionCase.create({ data: { accountId: account.id } });
    await db.collectionActivity.create({ data: { caseId: collection.id, requestKey: key, actorId: user.id, action: "NOTE", note: "CI", payload: {} } });
    await db.collectionPromise.create({ data: { caseId: collection.id, amount: 10, dueDate: "2099-01-01", createdById: user.id } });
    await db.financialAdjustment.create({ data: { organisationId: org.id, facilityId: facility.id, accountId: account.id, requestKey: key, kind: "CREDIT", amount: 10, taxAmount: 0, reason: "CI", evidenceReference: "CI", snapshot: {}, fingerprint: "CI", requestedById: user.id } });
    const run = await db.debitOrderRun.create({ data: { organisationId: org.id, facilityId: facility.id, period: "2099-01", actionDate: "2099-01-01", environment: "sandbox", connectionId: "ci", connectionFingerprint: "ci", batchName: key, fingerprint: "ci", snapshot: {}, total: 10, createdById: user.id, instructions: { create: { accountId: account.id, period: "2099-01", invoiceId: "ci", mandateId: "ci", reference: "ci", amount: 10 } } } });
    return { org, facility, user, customer, account, unit, type, tenancy, product, payment, order, task, run, input: { organisationId: org.id, actorId: user.id } };
  }
  async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      preview: await getUatResetPreview(f.org.id),
      product: await db.product.findUniqueOrThrow({ where: { id: f.product.id } }),
      unit: await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } }),
      task: await db.task.findUniqueOrThrow({ where: { id: f.task.id } }),
      audits: await db.auditEvent.count({ where: { organisationId: f.org.id, action: "uat.customer_data_reset" } }),
    };
  }
  try {
    await t.test("selected cleanup preserves unselected customers, rejects stale/outside selections and audits exact ids", async () => {
      const f = await fixture();
      const chosen = await db.customer.create({ data: { organisationId: f.org.id, firstName: "Selected synthetic test" } });
      const second = await db.customer.create({ data: { organisationId: f.org.id, firstName: "Second selected test" } });
      const localAccount = await db.account.create({ data: { customerId: chosen.id, accountNumber: randomUUID() } });
      const localUnit = await db.unit.create({ data: { facilityId: f.facility.id, unitTypeId: f.type.id, number: randomUUID(), monthlyRate: 100, status: "OCCUPIED" } });
      await db.tenancy.create({ data: { facilityId: f.facility.id, customerId: chosen.id, accountId: localAccount.id, startDate: new Date(), occupancies: { create: { unitId: localUnit.id, startDate: new Date(), monthlyRate: 100, status: "ACTIVE" } } } });
      await db.ledgerEntry.create({ data: { accountId: localAccount.id, type: "CHARGE", amount: 100, description: "Synthetic selected test charge", effectiveAt: new Date() } });
      await db.reservation.create({ data: { facilityId: f.facility.id, customerId: second.id, unitId: localUnit.id, quotedRate: 100 } });
      await db.lead.create({ data: { facilityId: f.facility.id, customerId: second.id, source: "Synthetic cleanup test" } });
      const ids = [chosen.id, second.id];
      await assert.rejects(getTestCustomerCleanupPreview(f.org.id, []), /CONFLICT/);
      await assert.rejects(getTestCustomerCleanupPreview(f.org.id, [chosen.id, chosen.id]), /CONFLICT/);
      await assert.rejects(getTestCustomerCleanupPreview(f.org.id, [chosen.id, "foreign"]), /NOT_FOUND/);
      assert.equal((await getTestCustomerCleanupPreview(f.org.id, [f.customer.id])).counts.payments, 1);
      let review = await getTestCustomerCleanupPreview(f.org.id, ids);
      const before = await snapshot(f);
      await db.customer.update({ where: { id: chosen.id }, data: { lastName: "Changed" } });
      await assert.rejects(resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: review.fingerprint } }), /CONFLICT/);
      assert.equal(await db.customer.count({ where: { id: { in: ids } } }), 2);
      review = await getTestCustomerCleanupPreview(f.org.id, ids);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_selected_audit_failure CHECK (action <> 'uat.customer_data_reset') NOT VALID`);
      try {
        await assert.rejects(resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: review.fingerprint } }));
        assert.equal(await db.customer.count({ where: { id: { in: ids } } }), 2);
      } finally { await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_selected_audit_failure`); }
      const result = await resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: review.fingerprint } });
      assert.equal(result.customers, 2);
      assert.equal(await db.account.count({ where: { id: localAccount.id } }), 0);
      assert.equal(await db.ledgerEntry.count({ where: { accountId: localAccount.id } }), 0);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: localUnit.id } })).status, "AVAILABLE");
      assert.equal(await db.reservation.count({ where: { customerId: second.id } }), 0);
      assert.equal(await db.lead.count({ where: { customerId: second.id } }), 0);
      assert.equal(await db.customer.count({ where: { id: { in: ids } } }), 0);
      const after = await snapshot(f);
      assert.deepEqual({ ...after, preview: null, audits: 0 }, { ...before, preview: null, audits: 0 });
      const audit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: f.org.id, action: "uat.customer_data_reset" } });
      assert.deepEqual((audit.after as { customerIds: string[] }).customerIds.sort(), ids.sort());
      await assert.rejects(resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: review.fingerprint } }), /NOT_FOUND/);
    });
    await t.test("selected cleanup includes old agreements, payments, mandates, local access, insurance and training; shared records survive", async () => {
      const f = await fixture(), other = await fixture();
      const otherBefore = await snapshot(other);
      const key = randomUUID();
      const control = await db.customer.create({ data: { organisationId: f.org.id, firstName: "Preserved customer" } });
      const controlAccount = await db.account.create({ data: { customerId: control.id, accountNumber: key, balance: 99 } });
      const controlBefore = await db.account.findUniqueOrThrow({ where: { id: controlAccount.id } });
      const controlInstruction = await db.debitOrderInstruction.create({ data: { runId: f.run.id, accountId: controlAccount.id, period: "2099-02", invoiceId: "ci", mandateId: "ci", reference: "ci", amount: 1 } });
      const reservation = await db.reservation.findFirstOrThrow({ where: { customerId: f.customer.id } });
      const occupancy = await db.occupancy.findFirstOrThrow({ where: { tenancyId: f.tenancy.id } });
      const lease = await db.publicReservationLease.create({ data: { reservationId: reservation.id, status: "SIGNED", version: "CI", paymentMethod: "TEST", content: "CI", clauses: [], sha256: "a".repeat(64), signingToken: key, expiresAt: new Date("2099-01-01") } });
      await db.publicDebitMandate.create({ data: { leaseId: lease.id, reference: key, correlation: key, terms: {}, status: "SIGNED" } });
      const document = await db.document.create({ data: { tenancyId: f.tenancy.id, type: "LEASE_AGREEMENT", storageKey: "ci", content: "CI" } });
      await db.debitMandateSession.create({ data: { tenancyId: f.tenancy.id, documentId: document.id, signingToken: key, expiresAt: new Date("2099-01-01"), monthlyRate: 100, source: {} } });
      await db.insuranceEnrollment.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, tenancyId: f.tenancy.id, status: "ACTIVE", acknowledgedAt: new Date() } });
      await db.biometricEnrollment.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, customerId: f.customer.id, occupancyId: occupancy.id, consentPolicy: "CI", consentAt: new Date(), faceImageSha256: "a".repeat(64), status: "PROVISIONED" } });
      await db.integrationIdentityLink.create({ data: { organisationId: f.org.id, customerId: f.customer.id, hikCentralPersonId: "synthetic-provider-person" } });
      await db.accessDecision.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, occupancyId: occupancy.id, action: "ACTIVATE", source: "CI", reason: "CI", correlationId: key } });
      await db.lead.create({ data: { facilityId: f.facility.id, customerId: f.customer.id, source: "Staff training only" } });
      const log = await db.communicationLog.create({ data: { organisationId: f.org.id, customerId: f.customer.id, channel: "EMAIL", recipientHash: "ci", idempotencyKey: key, status: "PENDING", nextRetryAt: new Date() } });
      const job = await db.webhookOutbox.create({ data: { organisationId: f.org.id, aggregateType: "Payment", aggregateId: f.payment.id, eventType: "booking.payment_confirmation", destination: "email://synthetic", payload: {}, idempotencyKey: key } });
      const config = await db.configurationProfile.create({ data: { organisationId: f.org.id, domain: "CARD_AUTOPAY_REQUEST", name: f.account.id, config: { accountId: f.account.id, revision: 1 } } });
      const preservedConfig = await db.configurationProfile.create({ data: { organisationId: f.org.id, domain: "CARD_AUTOPAY_REQUEST", name: controlAccount.id, config: { accountId: controlAccount.id } } });
      await db.tenantPortalSession.create({ data: { organisationId: f.org.id, email: "ci@example.invalid", tokenHash: key, customerIds: [f.customer.id, control.id], expiresAt: new Date("2099-01-01") } });
      const ids = [f.customer.id];
      const stale = await getTestCustomerCleanupPreview(f.org.id, ids);
      assert.equal(stale.counts.agreements, 1); assert.equal(stale.counts.mandates, 2);
      assert.equal(stale.counts.payments, 1); assert.equal(stale.counts.insuranceEnrollments, 1);
      assert.equal(stale.counts.biometricEnrollments, 1); assert.equal(stale.counts.identityLinks, 1);
      assert.equal(stale.counts.queuedJobsCancelled, 1); assert.equal(stale.counts.pendingCommunicationsCancelled, 1);
      await db.configurationProfile.update({ where: { id: config.id }, data: { config: { accountId: f.account.id, revision: 2 } } });
      await assert.rejects(resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: stale.fingerprint } }), /CONFLICT/);
      const review = await getTestCustomerCleanupPreview(f.org.id, ids);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_complete_cleanup_audit CHECK (action <> 'uat.customer_data_reset') NOT VALID`);
      try {
        await assert.rejects(resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: review.fingerprint } }));
        assert.equal(await db.customer.count({ where: { id: f.customer.id } }), 1);
        assert.equal(await db.configurationProfile.count({ where: { id: config.id } }), 1);
        assert.equal((await db.webhookOutbox.findUniqueOrThrow({ where: { id: job.id } })).status, "PENDING");
        assert.equal((await db.tenantPortalSession.findUniqueOrThrow({ where: { tokenHash: key } })).revokedAt, null);
      } finally { await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_complete_cleanup_audit`); }
      await resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: review.fingerprint } });
      const cleanupAudit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: f.org.id, action: "uat.customer_data_reset" } });
      assert.ok(JSON.stringify(cleanupAudit.before).includes("synthetic-provider-person"));
      assert.equal(await db.customer.count({ where: { id: f.customer.id } }), 0);
      assert.deepEqual(await Promise.all([
        db.publicReservationLease.count({ where: { id: lease.id } }), db.publicDebitMandate.count({ where: { leaseId: lease.id } }),
        db.debitMandateSession.count({ where: { tenancyId: f.tenancy.id } }), db.insuranceEnrollment.count({ where: { tenancyId: f.tenancy.id } }),
        db.biometricEnrollment.count({ where: { customerId: f.customer.id } }), db.integrationIdentityLink.count({ where: { customerId: f.customer.id } }),
        db.accessDecision.count({ where: { occupancyId: occupancy.id } }),
      ]), [0, 0, 0, 0, 0, 0, 0]);
      assert.equal(await db.configurationProfile.count({ where: { id: config.id } }), 0);
      assert.equal(await db.configurationProfile.count({ where: { id: preservedConfig.id } }), 1);
      assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { id: log.id } })).status, "DEAD_LETTER");
      assert.equal((await db.communicationLog.findUniqueOrThrow({ where: { id: log.id } })).customerId, null);
      assert.equal((await db.webhookOutbox.findUniqueOrThrow({ where: { id: job.id } })).status, "DEAD_LETTER");
      assert.ok((await db.tenantPortalSession.findUniqueOrThrow({ where: { tokenHash: key } })).revokedAt);
      assert.equal(await db.debitOrderInstruction.count({ where: { id: controlInstruction.id } }), 1);
      assert.equal(await db.debitOrderRun.count({ where: { id: f.run.id } }), 1);
      assert.deepEqual(await db.account.findUniqueOrThrow({ where: { id: controlAccount.id } }), controlBefore);
      assert.deepEqual(await snapshot(other), otherBefore);
    });
    await t.test("selected cleanup removes restrictive receipt links and undo chains without changing the preserved customer's money", async () => {
      const f = await fixture(), key = randomUUID();
      const control = await db.customer.create({ data: { organisationId: f.org.id, firstName: "Preserved receipt customer" } });
      const controlAccount = await db.account.create({ data: { customerId: control.id, accountNumber: key, balance: 44 } });
      const preserved = await db.account.findUniqueOrThrow({ where: { id: controlAccount.id } });
      const entry = await db.ledgerEntry.findFirstOrThrow({ where: { accountId: f.account.id } });
      const document = await db.document.create({ data: { tenancyId: f.tenancy.id, type: "RECEIPT", storageKey: "ci" } });
      const intake = await db.unidentifiedReceiptIntake.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, sourceType: "MANUAL", sourceIdentity: key, sourceFingerprint: key, evidenceEncrypted: "synthetic", sourceEnvironment: "sandbox", receiptDate: "2099-01-01", amount: 20, requestKey: key, requestHash: key, capturedById: f.user.id } });
      const proposal = await db.unidentifiedReceiptMatchProposal.create({ data: { intakeId: intake.id, accountId: f.account.id, accountFingerprint: key, sourceFingerprint: key, detailsEncrypted: "synthetic", proposedById: f.user.id } });
      const statement = await db.settlementStatement.create({ data: { organisationId: f.org.id, connectionId: "ci", merchantKey: key, merchantLabel: "CI", environment: "sandbox", date: "2099-01-01", source: "CI", sourceReference: key, rawEncrypted: "synthetic", sha256: "a".repeat(64), opening: 0, closing: 20, importedById: f.user.id, editedById: f.user.id } });
      const line = await db.settlementLine.create({ data: { statementId: statement.id, merchantKey: key, transactionId: key, date: "2099-01-01", code: "CI", description: "Synthetic source", amount: 20, vat: 0, extras: {}, kind: "RECEIPT" } });
      const posting = await db.receiptImportPosting.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, intakeId: intake.id, proposalId: proposal.id, accountId: f.account.id, paymentId: f.payment.id, ledgerEntryId: entry.id, documentId: document.id, sourceIdentity: key, sourceFingerprint: key, amount: 20, originalReceiptDate: "2099-01-01", snapshot: {}, snapshotHash: "a".repeat(64), netcashLineId: line.id, requestKey: key, requestHash: key, postedById: f.user.id, approvalReference: key } });
      const reviewer = await db.user.create({ data: { organisationId: f.org.id, name: "CI reviewer", email: key + "@example.invalid" } });
      const controlTenancy = await db.tenancy.create({ data: { customerId: control.id, accountId: controlAccount.id, facilityId: f.facility.id, startDate: new Date() } });
      const targetDocument = await db.document.create({ data: { tenancyId: controlTenancy.id, type: "RECEIPT", storageKey: "ci" } });
      const outgoing = await db.ledgerEntry.create({ data: { accountId: f.account.id, type: "CHARGE", amount: 1, description: "CI reallocation", effectiveAt: new Date() } });
      const incoming = await db.ledgerEntry.create({ data: { accountId: controlAccount.id, type: "CHARGE", amount: -1, description: "CI reallocation", effectiveAt: new Date() } });
      const transfer = await db.receiptReallocation.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, sourceAccountId: f.account.id, targetAccountId: controlAccount.id, sourceEntryId: entry.id, paymentId: f.payment.id, requestKey: key, requestHash: key, amount: 1, reason: "CI", evidenceReference: key, snapshot: {}, fingerprint: key, requestedById: f.user.id, status: "POSTED", reviewedById: reviewer.id, reviewReference: key, reviewedAt: new Date(), postedById: reviewer.id, postedAt: new Date(), sourceLedgerEntryId: outgoing.id, targetLedgerEntryId: incoming.id, sourceDocumentId: document.id, targetDocumentId: targetDocument.id } });
      await db.receiptReallocation.create({ data: { organisationId: f.org.id, facilityId: f.facility.id, sourceAccountId: controlAccount.id, targetAccountId: f.account.id, sourceEntryId: entry.id, paymentId: f.payment.id, reversesId: transfer.id, operation: "UNDO", requestKey: randomUUID(), requestHash: key, amount: 1, reason: "CI", evidenceReference: key, snapshot: {}, fingerprint: key, requestedById: f.user.id } });
      const ids = [f.customer.id], review = await getTestCustomerCleanupPreview(f.org.id, ids);
      assert.equal(review.counts.receiptReallocations, 2); assert.equal(review.counts.importedReceipts, 1);
      await resetUatCustomerData({ ...f.input, selection: { ids, fingerprint: review.fingerprint } });
      assert.equal(await db.receiptImportPosting.count({ where: { id: posting.id } }), 0);
      assert.equal(await db.receiptReallocation.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal(await db.customer.count({ where: { id: f.customer.id } }), 0);
      assert.deepEqual(await db.account.findUniqueOrThrow({ where: { id: controlAccount.id } }), preserved);
    });
    await t.test("payment-linked orders, collections, adjustments, requests and debit batches reset; other organisation and catalogue survive", async () => {
      const f = await fixture(), other = await fixture();
      const otherBefore = await snapshot(other);
      const preview = await getUatResetPreview(f.org.id);
      assert.equal(preview.merchandiseOrders, 2);
      assert.equal(preview.merchandiseRequests, 1);
      assert.equal(preview.collectionCases, 1);
      assert.equal(preview.financialAdjustments, 1);
      assert.equal(preview.debitInstructions, 1);
      assert.equal(preview.customerNotes, 1);
      assert.deepEqual(await resetUatCustomerData(f.input), preview);
      assert.equal(await db.customer.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal(await db.customerNote.count({ where: { organisationId: f.org.id } }), 0);
      assert.equal(await db.account.count({ where: { id: f.account.id } }), 0);
      assert.equal(await db.merchandiseOrderItem.count({ where: { productId: f.product.id } }), 0);
      assert.equal(await db.debitOrderRun.count({ where: { id: f.run.id } }), 0);
      assert.equal(await db.collectionActivity.count({ where: { actorId: f.user.id } }), 0);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } })).status, "AVAILABLE");
      const product = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
      assert.equal(product.quantityReserved, 3);
      assert.equal(product.quantityOnHand, 10);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: f.task.id } })).customerId, null);
      assert.equal(await db.facility.count({ where: { id: f.facility.id } }), 1);
      assert.equal(await db.unitType.count({ where: { id: f.type.id } }), 1);
      assert.equal(await db.user.count({ where: { id: f.user.id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: f.org.id, action: "uat.customer_data_reset" } }), 1);
      assert.deepEqual(await snapshot(other), otherBefore);
      assert.equal((await resetUatCustomerData(f.input)).customers, 0);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).quantityReserved, 3);
    });
    await t.test("insufficient reserved stock aborts without partial deletion", async () => {
      const f = await fixture();
      await db.product.update({ where: { id: f.product.id }, data: { quantityReserved: 1 } });
      const before = await snapshot(f);
      await assert.rejects(resetUatCustomerData(f.input), /UAT_RESET_STOCK_REVIEW_REQUIRED/);
      assert.deepEqual(await snapshot(f), before);
    });
    await t.test("a unit still occupied by a preserved customer is never released", async () => {
      const f = await fixture(), other = await fixture();
      await db.occupancy.updateMany({ where: { tenancyId: other.tenancy.id }, data: { unitId: f.unit.id } });
      const otherBefore = await snapshot(other);
      assert.equal((await getUatResetPreview(f.org.id)).unitsReleased, 0);
      assert.equal((await resetUatCustomerData(f.input)).unitsReleased, 0);
      assert.equal((await db.unit.findUniqueOrThrow({ where: { id: f.unit.id } })).status, "OCCUPIED");
      assert.deepEqual(await snapshot(other), otherBefore);
    });
    await t.test("mixed-organisation debit batch aborts and rolls back the stock release", async () => {
      const f = await fixture(), other = await fixture();
      await db.debitOrderInstruction.create({ data: { runId: f.run.id, accountId: other.account.id, period: "2099-02", invoiceId: "ci", mandateId: "ci", reference: "ci", amount: 1 } });
      const before = await snapshot(f), otherBefore = await snapshot(other);
      await assert.rejects(resetUatCustomerData(f.input), /UAT_RESET_SCOPE_CONFLICT/);
      assert.deepEqual(await snapshot(f), before);
      assert.deepEqual(await snapshot(other), otherBefore);
    });
    await t.test("audit failure rolls back every deletion and stock/unit change", async () => {
      const f = await fixture(), before = await snapshot(f);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_reset_audit_failure CHECK (action <> 'uat.customer_data_reset') NOT VALID`);
      try {
        await assert.rejects(resetUatCustomerData(f.input));
        assert.deepEqual(await snapshot(f), before);
        assert.equal(await db.collectionActivity.count({ where: { actorId: f.user.id } }), 1);
        assert.equal(await db.debitOrderRun.count({ where: { id: f.run.id } }), 1);
      } finally {
        await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_reset_audit_failure`);
      }
    });
  } finally { await db.$disconnect(); }
});
