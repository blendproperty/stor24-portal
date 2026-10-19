import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { receiptTrainingAction, receiptTrainingWorkspace } from "../../src/lib/receipt-correction-training-service";
import { previewReceiptReallocation } from "../../src/lib/receipt-reallocation-service";
import { receiptTrainingFixture } from "../../src/lib/receipt-correction-training-policy";

test("persisted receipt training remains store scoped, idempotent and outside all finances", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.equal(url.pathname, "/merchandise_ci");
  const org = await db.organisation.create({ data: { name: "Receipt training CI", slug: randomUUID() } });
  const store = await db.facility.create({ data: { organisationId: org.id, name: "Midpoint training CI", code: "A" } });
  const other = await db.facility.create({ data: { organisationId: org.id, name: "Other training CI", code: "B" } });
  const user = await db.user.create({ data: { organisationId: org.id, name: "Training requester", email: randomUUID() + "@example.invalid" } });
  const scope = { organisationId: org.id, userId: user.id, unrestrictedFacilities: false, facilityIds: [store.id] };
  try {
    const f = receiptTrainingFixture(org.id, store.id);
    const before = await receiptTrainingWorkspace(scope, { facilityId: store.id }, true);
    assert.equal(before.accounts.length, 2); assert.equal(before.capabilities.canApprove, false);
    assert.equal((await receiptTrainingWorkspace(scope, { facilityId: store.id, search: "Brett" }, true)).accounts.length, 1);
    assert.equal((await receiptTrainingWorkspace(scope, { facilityId: store.id, search: "Faeez" }, true)).accounts.length, 1);
    assert.equal((await receiptTrainingWorkspace(scope, { facilityId: store.id, sourceAccountId: f.accounts[0].id }, true)).receipts[0].remaining, "200.00");
    await assert.rejects(receiptTrainingWorkspace(scope, { facilityId: other.id }, true), /FORBIDDEN/);
    const input = { operation: "MOVE" as const, reversesId: null, sourceAccountId: f.accounts[0].id, targetAccountId: f.accounts[1].id, sourceEntryId: f.entryId, amount: "75.25", reason: "Synthetic training correction only", evidenceReference: "TRAINING-ONLY", requestKey: randomUUID() };
    const preview = await receiptTrainingAction(scope, { action: "preview", input }) as { fingerprint: string };
    const command = { action: "request", input, fingerprint: preview.fingerprint, confirmed: true };
    const first = await receiptTrainingAction(scope, command) as { id: string; idempotent: boolean };
    const retry = await receiptTrainingAction(scope, command) as { id: string; idempotent: boolean };
    assert.equal(first.id, retry.id); assert.equal(retry.idempotent, true);
    assert.equal((await receiptTrainingWorkspace(scope, { facilityId: store.id }, true)).requests.length, 1);
    await assert.rejects(receiptTrainingAction(scope, { ...command, input: { ...input, amount: "100" } }), /RECONCILIATION/);
    await assert.rejects(receiptTrainingAction({ ...scope, facilityIds: [other.id] }, command), /NOT_FOUND/);
    for (const decision of ["approve", "reject"]) await assert.rejects(receiptTrainingAction(scope, { action: "decide", id: first.id, revision: 0, decision, reference: "TRAINING-ONLY", confirmed: true }));
    const failedInput = { ...input, requestKey: randomUUID() };
    const failedPreview = await receiptTrainingAction(scope, { action: "preview", input: failedInput }) as { fingerprint: string };
    await assert.rejects(receiptTrainingAction({ ...scope, userId: "cunknownrequester000000001" }, { action: "request", input: failedInput, fingerprint: failedPreview.fingerprint, confirmed: true }));
    await assert.rejects(previewReceiptReallocation(scope, input), /NOT_FOUND/);
    assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:"training.receipt_requested"}}),1);
    const cancel = { action: "decide", id: first.id, revision: 0, decision: "cancel", reference: "TRAINING-CANCEL", confirmed: true };
    assert.equal((await receiptTrainingAction(scope, cancel) as { status: string }).status, "CANCELLED");
    assert.equal((await receiptTrainingAction(scope, cancel) as { idempotent: boolean }).idempotent, true);
    assert.equal((await receiptTrainingWorkspace(scope, { facilityId: store.id }, true)).requests[0].status, "CANCELLED");
    assert.equal(await db.account.count({ where: { customer: { organisationId: org.id } } }), 0);
    assert.equal(await db.tenancy.count({ where: { facility: { organisationId: org.id } } }), 0);
    assert.equal(await db.payment.count({ where: { account: { customer: { organisationId: org.id } } } }), 0);
    assert.equal(await db.ledgerEntry.count({ where: { account: { customer: { organisationId: org.id } } } }), 0);
    assert.equal(await db.receiptReallocation.count({ where: { organisationId: org.id } }), 0);
    assert.equal(await db.communicationLog.count({ where: { organisationId: org.id } }), 0);
  } finally {
    await db.auditEvent.deleteMany({ where: { organisationId: org.id } });
    await db.user.deleteMany({ where: { organisationId: org.id } });
    await db.facility.deleteMany({ where: { organisationId: org.id } });
    await db.organisation.delete({ where: { id: org.id } });
    await db.$disconnect();
  }
});
