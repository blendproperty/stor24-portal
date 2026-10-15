import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { facilityWhere, type RequestScope } from "./scope";
import { allocationHash, receiptAllocationGraph, receiptAmount } from "./receipt-reallocation-source";
import { receiptCents, receiptReallocationInput, receiptReallocationNotice } from "./receipt-reallocation-policy";
import { previewReceiptReallocation } from "./receipt-reallocation-service";
import { receiptCorrectionPreviewSchema, receiptCorrectionWorkspaceSchema, receiptRetainedPreviewSchema, RECEIPT_CORRECTION_ENDPOINT } from "./receipt-reallocation-ui-contract";

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const querySchema = z.object({ facilityId: z.cuid().optional(), sourceAccountId: z.cuid().optional(), search: z.string().trim().max(200).optional(), cursor: z.cuid().optional(), receiptCursor: z.cuid().optional() }).strict().refine(q => !q.receiptCursor || !!q.sourceAccountId, "Receipt pagination requires a scoped source account").refine(q => !q.search || q.search.split(/\s+/).length <= 10, "Narrow the account search");
const accountWhere = (scope: RequestScope) => ({ currency: "ZAR", customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(scope) } });
const requestWhere = (scope: RequestScope) => ({ organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }), sourceAccount: accountWhere(scope), targetAccount: accountWhere(scope) });

export function retainedReceiptPreview(snapshot: unknown, fingerprint: string, paymentId: string) {
  try {
    if (allocationHash(snapshot) !== fingerprint) return null;
    const saved = object(snapshot), source = object(saved.source), target = object(saved.target), root = object(saved.root), plan = object(saved.plan);
    if (root.paymentId !== paymentId) return null;
    const cents = (value: unknown) => { if (!Number.isSafeInteger(value)) throw Error("REALLOCATION_RECONCILIATION"); return receiptAmount(value as number); };
    return receiptRetainedPreviewSchema.parse({ sourceBalance: String(source.balance), targetBalance: String(target.balance), sourceBalanceAfter: cents(plan.sourceBalanceAfterCents), targetBalanceAfter: cents(plan.targetBalanceAfterCents), sourceReceiptRemaining: cents(plan.sourceReceiptRemainingCents), paymentReference: `STOR24 receipt ${paymentId}` });
  } catch { return null; }
}

export async function receiptCorrectionPreview(scope: RequestScope, input: z.input<typeof receiptReallocationInput>) {
  const result = await previewReceiptReallocation(scope, input);
  const accounts = await db.account.findMany({ where: { id: { in: [input.sourceAccountId, input.targetAccountId] }, ...accountWhere(scope) }, select: { id: true, accountNumber: true } });
  const source = accounts.find(a => a.id === input.sourceAccountId), target = accounts.find(a => a.id === input.targetAccountId);
  if (!source || !target) throw Error("REALLOCATION_NOT_FOUND");
  const retained = retainedReceiptPreview(result.snapshot, result.fingerprint, result.snapshot.root.paymentId);
  if (!retained) throw Error("REALLOCATION_RECONCILIATION");
  return receiptCorrectionPreviewSchema.parse({ fingerprint: result.fingerprint, operation: result.snapshot.input.operation, source: { accountNumber: source.accountNumber, balance: retained.sourceBalance }, target: { accountNumber: target.accountNumber, balance: retained.targetBalance }, amount: receiptAmount(result.snapshot.plan.amountCents), sourceBalanceAfter: retained.sourceBalanceAfter, targetBalanceAfter: retained.targetBalanceAfter, sourceReceiptRemaining: retained.sourceReceiptRemaining, notice: receiptReallocationNotice });
}

export async function receiptCorrectionWorkspace(scope: RequestScope, raw: Record<string, string>, capabilities: { canRequest: boolean; canApprove: boolean }) {
  const query = querySchema.parse(raw);
  return db.$transaction(async tx => {
    const facilities = await tx.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 101 });
    if (facilities.length > 100) throw Error("REALLOCATION_LIMIT");
    if (query.facilityId && !facilities.some(f => f.id === query.facilityId)) throw Error("FORBIDDEN");
    const search = query.search ? { OR: [{ accountNumber: { contains: query.search, mode: "insensitive" as const } }, { AND: query.search.split(/\s+/).map(term => ({ OR: [{ customer: { firstName: { contains: term, mode: "insensitive" as const } } }, { customer: { lastName: { contains: term, mode: "insensitive" as const } } }] })) }] } : {};
    const accounts = await tx.account.findMany({ where: { ...accountWhere(scope), ...(query.facilityId ? { tenancy: { facility: facilityWhere(scope), facilityId: query.facilityId } } : {}), ...search }, select: { id: true, accountNumber: true, balance: true, customer: { select: { firstName: true, lastName: true } }, tenancy: { select: { facilityId: true } } }, orderBy: [{ accountNumber: "asc" }, { id: "asc" }], take: 201 });
    const historyScope = { ...requestWhere(scope), ...(query.facilityId ? { facilityId: query.facilityId } : {}) };
    const cursor = query.cursor ? await tx.receiptReallocation.findFirst({ where: { id: query.cursor, ...historyScope }, select: { id: true, createdAt: true } }) : null;
    if (query.cursor && !cursor) throw Error("REALLOCATION_NOT_FOUND");
    const requests = await tx.receiptReallocation.findMany({ where: { ...historyScope, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, include: { sourceAccount: { select: { accountNumber: true } }, targetAccount: { select: { accountNumber: true } } } });
    const actors = await tx.user.findMany({ where: { organisationId: scope.organisationId, id: { in: requests.map(r => r.requestedById) } }, select: { id: true, name: true } });
    const receipts: { entryId: string; description: string; recordedAt: string; remaining: string; paymentReference: string }[] = [];
    let nextReceiptCursor: string | null = null;
    if (query.sourceAccountId) {
      const source = await tx.account.findFirst({ where: { id: query.sourceAccountId, ...accountWhere(scope), ...(query.facilityId ? { tenancy: { facility: facilityWhere(scope), facilityId: query.facilityId } } : {}) }, select: { id: true } });
      if (!source) throw Error("REALLOCATION_NOT_FOUND");
      const receiptCursor = query.receiptCursor ? await tx.ledgerEntry.findFirst({ where: { id: query.receiptCursor, accountId: source.id, type: "PAYMENT" }, select: { id: true, createdAt: true } }) : null;
      if (query.receiptCursor && !receiptCursor) throw Error("REALLOCATION_NOT_FOUND");
      const entries = await tx.ledgerEntry.findMany({ where: { accountId: source.id, type: "PAYMENT", ...(receiptCursor ? { OR: [{ createdAt: { lt: receiptCursor.createdAt } }, { createdAt: receiptCursor.createdAt, id: { lt: receiptCursor.id } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26, include: { receiptReallocationIncoming: { select: { paymentId: true } } } });
      nextReceiptCursor = entries.length > 25 ? entries[24].id : null;
      const payments = await tx.payment.findMany({ where: { accountId: source.id }, select: { id: true, idempotencyKey: true }, take: 5001 });
      if (payments.length > 5000) throw Error("REALLOCATION_LIMIT");
      for (const entry of entries.slice(0, 25)) {
        const matches = payments.filter(p => object(entry.metadata).paymentId === p.id || entry.externalRef === p.idempotencyKey);
        const root = entry.receiptReallocationIncoming?.paymentId ?? (matches.length === 1 ? matches[0].id : null);
        if (!root) continue;
        // An unprovable receipt never becomes a selectable funding source.
        const graph = await receiptAllocationGraph(tx, scope, root, [source.id]);
        const position = graph.positions.find(p => p.entryId === entry.id && p.accountId === source.id);
        if (position && receiptCents(position.remaining) > 0) receipts.push({ entryId: entry.id, description: entry.description.slice(0, 500), recordedAt: graph.recordedAt.toISOString(), remaining: position.remaining, paymentReference: `STOR24 receipt ${root}` });
      }
    }
    return receiptCorrectionWorkspaceSchema.parse({ userId: scope.userId, capabilities, facilities, accounts: accounts.slice(0, 200).map(a => ({ id: a.id, accountNumber: a.accountNumber, customerName: [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ").slice(0, 200), facilityId: a.tenancy!.facilityId, balance: a.balance.toString() })), accountsLimited: accounts.length > 200, receipts, nextReceiptCursor, requests: requests.slice(0, 50).map(r => ({ id: r.id, revision: r.revision, status: r.status, operation: r.operation, reversesId: r.reversesId, sourceAccountId: r.sourceAccountId, targetAccountId: r.targetAccountId, sourceEntryId: r.sourceEntryId, facilityId: r.facilityId, sourceAccountNumber: r.sourceAccount.accountNumber, targetAccountNumber: r.targetAccount.accountNumber, targetLedgerEntryId: r.targetLedgerEntryId, amount: r.amount.toString(), reason: r.reason, evidenceReference: r.evidenceReference, requestedById: r.requestedById, requestedByName: actors.find(a => a.id === r.requestedById)?.name ?? "Unavailable staff record", createdAt: r.createdAt.toISOString(), reviewReference: r.reviewReference, postedAt: r.postedAt?.toISOString() ?? null, retainedPreview: retainedReceiptPreview(r.snapshot, r.fingerprint, r.paymentId), sourceDocumentHref: r.status === "POSTED" && r.sourceDocumentId ? `${RECEIPT_CORRECTION_ENDPOINT}?document=${r.id}&side=source` : null, targetDocumentHref: r.status === "POSTED" && r.targetDocumentId ? `${RECEIPT_CORRECTION_ENDPOINT}?document=${r.id}&side=target` : null })), nextCursor: requests.length > 50 ? requests[49].id : null });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}

export async function receiptCorrectionDocument(scope: RequestScope, id: string, side: "source" | "target") {
  return db.$transaction(async tx => {
    const row = await tx.receiptReallocation.findFirst({ where: { id, status: "POSTED", ...requestWhere(scope) }, include: { sourceAccount: { select: { tenancy: { select: { id: true } } } }, targetAccount: { select: { tenancy: { select: { id: true } } } } } });
    if (!row) throw Error("REALLOCATION_NOT_FOUND");
    await receiptAllocationGraph(tx, scope, row.paymentId, [row.sourceAccountId, row.targetAccountId]);
    const documentId = side === "source" ? row.sourceDocumentId : row.targetDocumentId;
    const tenancyId = (side === "source" ? row.sourceAccount : row.targetAccount).tenancy?.id;
    if (!documentId || !tenancyId) throw Error("REALLOCATION_RECONCILIATION");
    const doc = await tx.document.findFirst({ where: { id: documentId, tenancyId }, select: { content: true, sha256: true } });
    if (!doc?.content || createHash("sha256").update(doc.content).digest("hex") !== doc.sha256) throw Error("REALLOCATION_RECONCILIATION");
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: row.facilityId, actorId: scope.userId, entityType: "ReceiptReallocation", entityId: row.id, action: "receipt_reallocation.document_requested", after: { side, documentId, sha256: doc.sha256 } } });
    return { content: doc.content, facilityId: row.facilityId, documentId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
