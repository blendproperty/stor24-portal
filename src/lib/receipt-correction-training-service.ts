import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { facilityWhere, type RequestScope } from "./scope";
import { receiptTrainingFixture, previewReceiptTraining, receiptTrainingCommand } from "./receipt-correction-training-policy";
import { receiptReallocationInput } from "./receipt-reallocation-policy";
import { receiptCorrectionWorkspaceSchema, type ReceiptCorrectionRow } from "./receipt-reallocation-ui-contract";

const entityType = "ReceiptCorrectionTraining";
const savedSchema = z.object({ version: z.literal(1), trainingOnly: z.literal(true), input: receiptReallocationInput, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const querySchema = z.object({ facilityId: z.cuid().optional(), sourceAccountId: z.cuid().optional(), search: z.string().trim().max(200).optional() }).strict();


async function trainingFacilities(scope: RequestScope, database: Prisma.TransactionClient = db) {
  const rows = await database.facility.findMany({ where: { ...facilityWhere(scope), active: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 101 });
  if (rows.length > 100) throw Error("REALLOCATION_LIMIT");
  return rows;
}
async function inputFacility(scope: RequestScope, input: z.infer<typeof receiptReallocationInput>, database: Prisma.TransactionClient = db) {
  const facilities = await trainingFacilities(scope, database);
  const facility = facilities.find(f => receiptTrainingFixture(scope.organisationId, f.id).accounts.some(a => a.id === input.sourceAccountId));
  if (!facility) throw Error("REALLOCATION_NOT_FOUND");
  return facility;
}

export async function receiptTrainingWorkspace(scope: RequestScope, raw: Record<string, string>, canRequest: boolean) {
  const query = querySchema.parse(raw), facilities = await trainingFacilities(scope);
  const selected = query.facilityId ? facilities.find(f => f.id === query.facilityId) : facilities[0];
  if (query.facilityId && !selected) throw Error("FORBIDDEN");
  const fixture = selected ? receiptTrainingFixture(scope.organisationId, selected.id) : null;
  if (query.sourceAccountId && !fixture?.accounts.some(a => a.id === query.sourceAccountId)) throw Error("REALLOCATION_NOT_FOUND");
  const events = selected ? await db.auditEvent.findMany({ where: { organisationId: scope.organisationId, facilityId: selected.id, entityType, action: { in: ["training.receipt_requested", "training.receipt_cancelled"] } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1001 }) : [];
  if (events.length > 1000) throw Error("REALLOCATION_LIMIT");
  const requests: ReceiptCorrectionRow[] = [];
  for (const event of events.filter(e => e.action === "training.receipt_requested").slice(0, 50)) {
    const saved = savedSchema.parse(event.after), input = saved.input;
    const preview = previewReceiptTraining(scope.organisationId, selected!.id, input);
    if (preview.fingerprint !== saved.fingerprint || event.entityId !== input.requestKey || !event.actorId) throw Error("REALLOCATION_RECONCILIATION");
    const cancelled = events.find(e => e.action === "training.receipt_cancelled" && e.entityId === event.id);
    const actor = await db.user.findFirst({ where: { id: event.actorId, organisationId: scope.organisationId }, select: { name: true } });
    requests.push({ id: event.id, revision: cancelled ? 1 : 0, status: cancelled ? "CANCELLED" : "PENDING_APPROVAL", operation: "MOVE", reversesId: null, sourceAccountId: input.sourceAccountId, targetAccountId: input.targetAccountId, sourceEntryId: input.sourceEntryId, facilityId: selected!.id, sourceAccountNumber: preview.source.accountNumber, targetAccountNumber: preview.target.accountNumber, targetLedgerEntryId: null, amount: preview.amount, reason: input.reason, evidenceReference: input.evidenceReference, requestedById: event.actorId, requestedByName: actor?.name ?? "Recorded staff member", createdAt: event.occurredAt.toISOString(), reviewReference: null, postedAt: null, sourceDocumentHref: null, targetDocumentHref: null, retainedPreview: { sourceBalance: preview.source.balance, targetBalance: preview.target.balance, sourceBalanceAfter: preview.sourceBalanceAfter, targetBalanceAfter: preview.targetBalanceAfter, sourceReceiptRemaining: preview.sourceReceiptRemaining, paymentReference: null } });
  }
  const terms = query.search?.toLowerCase().split(/\s+/) ?? [];
  return receiptCorrectionWorkspaceSchema.parse({ userId: scope.userId, facilities, capabilities: { canRequest, canApprove: false }, accounts: fixture?.accounts.filter(a => terms.every(t => `${a.accountNumber} ${a.customerName}`.toLowerCase().includes(t))) ?? [], accountsLimited: false, receipts: fixture && query.sourceAccountId === fixture.accounts[0].id ? [{ entryId: fixture.entryId, description: "TRAINING sample receipt only", recordedAt: "2026-10-19T06:00:00.000Z", remaining: "200.00", paymentReference: "TRAINING-RECEIPT-200 - sample only" }] : [], requests, nextCursor: null, nextReceiptCursor: null });
}

export async function receiptTrainingAction(scope: RequestScope, raw: unknown) {
  const command = receiptTrainingCommand.parse(raw);
  if (command.action === "preview") {
    const facility = await inputFacility(scope, command.input);
    return previewReceiptTraining(scope.organisationId, facility.id, command.input);
  }
  // Only training audit events can be written. No live financial service is imported.
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${scope.organisationId} FOR UPDATE`;
    if (command.action === "request") {
      const facility = await inputFacility(scope, command.input, tx), preview = previewReceiptTraining(scope.organisationId, facility.id, command.input);
      if (command.fingerprint !== preview.fingerprint) throw Error("REALLOCATION_RECONCILIATION");
      const saved = await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, entityType, action: "training.receipt_requested", entityId: command.input.requestKey } });
      if (saved) {
        const prior = savedSchema.parse(saved.after);
        if (saved.actorId !== scope.userId || saved.facilityId !== facility.id || prior.fingerprint !== command.fingerprint) throw Error("REALLOCATION_RECONCILIATION");
        return { id: saved.id, idempotent: true };
      }
      const record = await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: facility.id, actorId: scope.userId, entityType, entityId: command.input.requestKey, action: "training.receipt_requested", after: { version: 1, trainingOnly: true, input: command.input, fingerprint: command.fingerprint } } });
      return { id: record.id, idempotent: false };
    }
    const row = await tx.auditEvent.findFirst({ where: { id: command.id, organisationId: scope.organisationId, entityType, action: "training.receipt_requested", actorId: scope.userId } });
    if (!row || !(await trainingFacilities(scope, tx)).some(f => f.id === row.facilityId)) throw Error("REALLOCATION_NOT_FOUND");
    const prior = await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, entityType, action: "training.receipt_cancelled", entityId: row.id } });
    if (prior) return { id: row.id, status: "CANCELLED", idempotent: true };
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: row.facilityId, actorId: scope.userId, entityType, entityId: row.id, action: "training.receipt_cancelled", after: { trainingOnly: true, reference: command.reference } } });
    return { id: row.id, status: "CANCELLED", idempotent: false };
  });
}
