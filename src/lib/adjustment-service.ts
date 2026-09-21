import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { buildAccountStatement } from "@/lib/finance/account-statement";
import { isTestPayment } from "@/lib/payments/payment-evidence";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { adjustmentDelta, adjustmentInputSchema, adjustmentLabels, amountText, cents, evidenceText, refundLimits } from "@/lib/adjustment-policy";
import { documentShellHtml, escapeHtml, formatZar } from "@/lib/finance/billing-document-brand";
type Client = Prisma.TransactionClient;
const openStates = ["PENDING_APPROVAL", "APPROVED"];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const scoped = (scope: RequestScope) => ({ organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) });
const accountsWhere = (scope: RequestScope) => ({ customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(scope) } });

async function context(tx: Client, scope: RequestScope, accountId: string) {
  const account = await tx.account.findFirst({ where: { id: accountId, ...accountsWhere(scope) }, include: { tenancy: { include: { facility: { select: { name: true } } } }, ledgerEntries: { orderBy: [{ effectiveAt: "asc" }, { id: "asc" }] }, payments: { include: { merchandiseOrder: { select: { id: true } } }, orderBy: { id: "asc" } } } });
  if (!account?.tenancy) throw new Error("ADJUSTMENT_NOT_FOUND");
  const policy = await tx.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: account.tenancy.facilityId, domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY" } });
  return { account, tenancy: account.tenancy, policy };
}
function matchedPayment(account: Awaited<ReturnType<typeof context>>["account"], sourceId: string) {
  const source = account.ledgerEntries.find(e => e.id === sourceId && e.type === "PAYMENT");
  if (!source) return null;
  return account.payments.find(p => !p.merchandiseOrder && !isTestPayment(p) && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(p.status) && p.currency === "ZAR" && p.amount.equals(source.amount) &&
    (source.externalRef === p.idempotencyKey || (source.metadata as { paymentId?: string } | null)?.paymentId === p.id)) ?? null;
}
async function review(tx: Client, scope: RequestScope, raw: unknown, ownId?: string) {
  const input = adjustmentInputSchema.parse(raw);
  const { account, tenancy, policy } = await context(tx, scope, input.accountId);
  if (account.currency !== "ZAR") throw new Error("ADJUSTMENT_SOURCE");
  const entries = account.ledgerEntries;
  if (entries.some(e => e.type === "PAYMENT" && account.payments.some(p => isTestPayment(p) && (e.externalRef === p.idempotencyKey || (e.metadata as { paymentId?: string } | null)?.paymentId === p.id)))) throw new Error("ADJUSTMENT_TEST_REVIEW");
  const statement = buildAccountStatement(entries.map(e => ({ ...e, amount: e.amount.toString() })), new Date(0), new Date("9999-01-01"));
  if (cents(statement.closingBalance) !== cents(account.balance.toString()) || entries.some(e => e.effectiveAt > new Date())) throw new Error("ADJUSTMENT_RECONCILIATION");
  if (await tx.financialAdjustment.count({ where: { accountId: account.id, status: { in: openStates }, ...(ownId ? { id: { not: ownId } } : {}) } })) throw new Error("ADJUSTMENT_OPEN_REQUEST");
  if (await tx.debitOrderInstruction.count({ where: { accountId: account.id, run: { status: { not: "CANCELLED" } } } })) throw new Error("ADJUSTMENT_COLLECTION_PENDING");
  const amount = cents(input.amount), balance = cents(account.balance.toString());
  const source = entries.find(e => e.id === input.sourceEntryId);
  const history = await tx.financialAdjustment.findMany({ where: { accountId: account.id, status: "POSTED" }, orderBy: { id: "asc" } });
  let tax = cents(input.taxAmount), paymentId: string | null = null;
  if (input.kind === "CHARGE") {
    if (source || input.sourceEntryId) throw new Error("ADJUSTMENT_SOURCE");
  } else {
    if (!source) throw new Error("ADJUSTMENT_SOURCE");
    const used = history.filter(h => h.sourceEntryId === source.id).reduce((sum, h) => sum + cents(h.amount.toString()), 0);
    const remaining = cents(source.amount.toString()) - used;
    // Legacy credits without a linked source cannot safely be allocated retrospectively.
    if (entries.some(e => ["CREDIT", "WRITE_OFF", "REFUND", "REVERSAL"].includes(e.type) && !history.some(h => h.ledgerEntryId === e.id))) throw new Error("ADJUSTMENT_RECONCILIATION");
    if (amount > remaining) throw new Error("ADJUSTMENT_EXCEEDS_SOURCE");
    if (["CREDIT", "WRITE_OFF"].includes(input.kind)) {
      if (source.type !== "CHARGE") throw new Error("ADJUSTMENT_SOURCE");
      if (input.kind === "WRITE_OFF" && amount > balance) throw new Error("ADJUSTMENT_EXCEEDS_SOURCE");
      if (input.kind === "CREDIT") {
        const usedTax = history.filter(h => h.sourceEntryId === source.id).reduce((sum, h) => sum + cents(h.taxAmount.toString()), 0);
        tax = Math.min(cents(source.taxAmount.toString()) - usedTax, Math.round(amount * cents(source.taxAmount.toString()) / cents(source.amount.toString())));
      } else tax = 0;
    } else {
      const payment = matchedPayment(account, source.id);
      if (!payment || (payment.provider && payment.environment !== "live")) throw new Error("ADJUSTMENT_SOURCE");
      if (entries.filter(e => e.type === "PAYMENT" && (e.externalRef === payment.idempotencyKey || (e.metadata as { paymentId?: string } | null)?.paymentId === payment.id)).length !== 1) throw new Error("ADJUSTMENT_RECONCILIATION");
      const audited = await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, entityType: "Payment", entityId: payment.id, action: { in: ["payment.posted", "booking.payment_recorded"] } } });
      const metadata = source.metadata as { verifiedStatus?: boolean; environment?: string } | null;
      if (!audited && !(payment.provider === "NETCASH" && metadata?.verifiedStatus === true && metadata.environment === "live")) throw new Error("ADJUSTMENT_SOURCE");
      paymentId = payment.id;
      if (input.kind === "REVERSAL" && (used !== 0 || amount !== cents(source.amount.toString()))) throw new Error("ADJUSTMENT_EXCEEDS_SOURCE");
      if (input.kind === "REFUND") {
        if (amount > -balance) throw new Error("ADJUSTMENT_EXCEEDS_SOURCE");
        const limits = refundLimits(policy?.config);
        // No numeric-role override is guessed: configured maximum remains a hard ceiling.
        if ((limits.minimum && amount < limits.minimum) || (limits.maximum && amount > limits.maximum)) throw new Error("ADJUSTMENT_POLICY_REVIEW");
      }
      tax = 0;
    }
    if (cents(input.taxAmount) !== 0) throw new Error("ADJUSTMENT_TAX");
  }
  const snapshot = { input, accountNumber: account.accountNumber, facilityId: tenancy.facilityId, facilityName: tenancy.facility.name, tenancyId: tenancy.id, balanceBefore: amountText(balance), balanceAfter: amountText(balance + adjustmentDelta(input.kind, amount)), amount: amountText(amount), taxAmount: amountText(tax), source: source ? { id: source.id, type: source.type, description: source.description, amount: source.amount.toString(), effectiveAt: source.effectiveAt.toISOString(), externalRef: source.externalRef } : null, paymentId };
  return { ...snapshot, fingerprint: hash({ snapshot, entries, payments: account.payments, policy: policy?.config ?? null, history }) };
}
export async function adjustmentWorkspace(scope: RequestScope) {
  const [accounts, requests] = await Promise.all([
    db.account.findMany({ where: accountsWhere(scope), select: { id: true, accountNumber: true, balance: true, tenancy: { select: { facility: { select: { name: true } } } } }, orderBy: { accountNumber: "asc" }, take: 500 }),
    db.financialAdjustment.findMany({ where: scoped(scope), orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return { accounts, requests, userId: scope.userId };
}
export async function adjustmentAccount(scope: RequestScope, accountId: string) {
  const { account } = await context(db, scope, accountId);
  return { balance: account.balance, entries: account.ledgerEntries.filter(e => ["CHARGE", "PAYMENT"].includes(e.type)).map(e => ({ id: e.id, type: e.type, description: e.description, amount: e.amount.toString(), taxAmount: e.taxAmount.toString(), effectiveAt: e.effectiveAt })) };
}
export const previewAdjustment = (scope: RequestScope, raw: unknown) => review(db, scope, raw);
export async function requestAdjustment(scope: RequestScope, raw: unknown, fingerprint: string, requestKey: string) {
  const input = adjustmentInputSchema.parse(raw);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${input.accountId} FOR UPDATE`;
    const existing = await tx.financialAdjustment.findUnique({ where: { organisationId_requestKey: { organisationId: scope.organisationId, requestKey } } });
    if (existing) {
      await context(tx, scope, existing.accountId);
      if (existing.requestedById !== scope.userId || existing.fingerprint !== fingerprint || hash(adjustmentInputSchema.parse((existing.snapshot as { input?: unknown }).input)) !== hash(input)) throw new Error("ADJUSTMENT_DUPLICATE");
      return existing;
    }
    const reviewed = await review(tx, scope, input);
    if (reviewed.fingerprint !== fingerprint) throw new Error("ADJUSTMENT_CHANGED");
    const record = await tx.financialAdjustment.create({ data: { ...scoped(scope), organisationId: scope.organisationId, facilityId: reviewed.facilityId, accountId: input.accountId, requestKey, kind: input.kind, amount: reviewed.amount, taxAmount: reviewed.taxAmount, sourceEntryId: input.sourceEntryId, paymentId: reviewed.paymentId, reason: input.reason, evidenceReference: input.evidenceReference, snapshot: json(reviewed), fingerprint, requestedById: scope.userId } });
    await audit(tx, scope, record, "requested", { fingerprint, amount: reviewed.amount });
    return record;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
async function audit(tx: Client, scope: RequestScope, request: { id: string; facilityId: string }, action: string, after: unknown) {
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: request.facilityId, actorId: scope.userId, action: `adjustment.${action}`, entityType: "FinancialAdjustment", entityId: request.id, after: json(after) } });
}
async function locked(tx: Client, scope: RequestScope, id: string) {
  const initial = await tx.financialAdjustment.findFirst({ where: { id, ...scoped(scope) } });
  if (!initial) throw new Error("ADJUSTMENT_NOT_FOUND");
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${initial.accountId} FOR UPDATE`;
  await context(tx, scope, initial.accountId);
  return tx.financialAdjustment.findUniqueOrThrow({ where: { id } });
}
type Adjustment = Awaited<ReturnType<typeof locked>>;
async function post(tx: Client, scope: RequestScope, request: Adjustment, reviewed: Awaited<ReturnType<typeof review>>, payout?: { reference: string; date: string }) {
  const entry = await tx.ledgerEntry.create({ data: { accountId: request.accountId, type: request.kind as "CHARGE" | "CREDIT" | "WRITE_OFF" | "REVERSAL" | "REFUND", amount: request.amount, taxAmount: request.taxAmount, description: `${adjustmentLabels[request.kind]} · ${request.reason}`, effectiveAt: new Date(), reversalOfId: request.kind === "REVERSAL" ? request.sourceEntryId : null, externalRef: `adjustment:${request.id}`, createdById: scope.userId, metadata: { adjustmentId: request.id, sourceEntryId: request.sourceEntryId, paymentId: request.paymentId, evidenceReference: request.evidenceReference, reviewReference: request.reviewReference, payoutReference: payout?.reference ?? null, payoutDate: payout?.date ?? null, accountingDate: southAfricaDateKey(new Date()) } } });
  await tx.account.update({ where: { id: request.accountId }, data: { balance: { increment: amountText(adjustmentDelta(request.kind, cents(request.amount.toString()))) } } });
  if (request.paymentId) {
    const prior = await tx.financialAdjustment.aggregate({ where: { paymentId: request.paymentId, kind: "REFUND", status: "POSTED" }, _sum: { amount: true } });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: request.paymentId } });
    const refunded = cents(prior._sum.amount?.toString() ?? "0") + cents(request.amount.toString());
    await tx.payment.update({ where: { id: payment.id }, data: { status: request.kind === "REVERSAL" ? "REVERSED" : refunded >= cents(payment.amount.toString()) ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
  }
  const title = request.kind === "CREDIT" ? "Credit adjustment" : adjustmentLabels[request.kind];
  const html = documentShellHtml({ title: `${title} ${request.id}`, preheader: title, bodyHtml: `<h1>${escapeHtml(title)}</h1><p>Reference: ${escapeHtml(request.id)}</p><p>Account: ${escapeHtml(reviewed.accountNumber)} · ${escapeHtml(reviewed.facilityName)}</p><p>Original entry: ${escapeHtml(reviewed.source?.externalRef || reviewed.source?.id || "Additional charge")}</p><p>${escapeHtml(request.reason)}</p><p>Amount: ${formatZar(request.amount.toString())} · Included tax adjustment: ${formatZar(request.taxAmount.toString())}</p><p>Balance before: ${formatZar(reviewed.balanceBefore)} · Balance after: ${formatZar(reviewed.balanceAfter)}</p><p>Supporting evidence: ${escapeHtml(request.evidenceReference)} · Approval: ${escapeHtml(request.reviewReference ?? "")}</p><p>Posted ${escapeHtml(southAfricaDateKey(new Date()))}${payout ? ` · External payout ${escapeHtml(payout.reference)} on ${escapeHtml(payout.date)}` : ""}</p><p>Account adjustment record. Original documents remain unchanged. This record does not initiate a bank transfer.</p>` });
  const sha256 = createHash("sha256").update(html).digest("hex");
  const document = await tx.document.create({ data: { tenancyId: reviewed.tenancyId, type: "ADJUSTMENT", status: "GENERATED", content: html, sha256, storageKey: `inline:${sha256}`, externalId: `ADJ-${request.id}`, idempotencyKey: `adjustment-document:${request.id}` } });
  const result = await tx.financialAdjustment.update({ where: { id: request.id }, data: { status: "POSTED", ledgerEntryId: entry.id, documentId: document.id, postedById: scope.userId, postedAt: new Date(), payoutReference: payout?.reference, payoutDate: payout?.date } });
  await audit(tx, scope, request, "posted", { ledgerEntryId: entry.id, documentId: document.id, balanceBefore: reviewed.balanceBefore, balanceAfter: reviewed.balanceAfter, payout: payout ?? null });
  return result;
}
export async function decideAdjustment(scope: RequestScope, id: string, action: "approve" | "reject" | "cancel", reference: string, unpaidConfirmed = false) {
  reference = evidenceText.parse(reference);
  return db.$transaction(async tx => {
    const request = await locked(tx, scope, id);
    if (!openStates.includes(request.status)) throw new Error("ADJUSTMENT_STATE");
    if (action !== "cancel" && request.requestedById === scope.userId) throw new Error("ADJUSTMENT_SELF_APPROVAL");
    if (action === "cancel" && request.requestedById !== scope.userId && request.reviewedById !== scope.userId) throw new Error("FORBIDDEN");
    if (action === "cancel" && request.status === "APPROVED" && !unpaidConfirmed) throw new Error("ADJUSTMENT_UNPAID_CONFIRMATION");
    if (action !== "approve") {
      const result = await tx.financialAdjustment.update({ where: { id }, data: { status: action === "reject" ? "REJECTED" : "CANCELLED", reviewReference: reference, reviewedById: scope.userId, reviewedAt: new Date() } });
      await audit(tx, scope, request, action, { reference, previousStatus: request.status }); return result;
    }
    if (request.status !== "PENDING_APPROVAL") throw new Error("ADJUSTMENT_STATE");
    const reviewed = await review(tx, scope, (request.snapshot as { input: unknown }).input, id);
    if (reviewed.fingerprint !== request.fingerprint) throw new Error("ADJUSTMENT_CHANGED");
    const approved = await tx.financialAdjustment.update({ where: { id }, data: { status: "APPROVED", reviewedById: scope.userId, reviewedAt: new Date(), reviewReference: reference } });
    await audit(tx, scope, request, "approved", { reference, fingerprint: reviewed.fingerprint });
    return request.kind === "REFUND" ? approved : post(tx, scope, approved, reviewed);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
export async function recordRefundPayout(scope: RequestScope, id: string, reference: string, date: string) {
  reference = evidenceText.parse(reference).toUpperCase();
  return db.$transaction(async tx => {
    const request = await locked(tx, scope, id);
    if (request.kind !== "REFUND" || request.status !== "APPROVED" || !request.reviewedAt) throw new Error("ADJUSTMENT_STATE");
    if (scope.userId === request.requestedById) throw new Error("ADJUSTMENT_SELF_APPROVAL");
    const parsed = new Date(`${date}T00:00:00+02:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || southAfricaDateKey(parsed) !== date || date < southAfricaDateKey(request.reviewedAt) || date > southAfricaDateKey(new Date())) throw new Error("ADJUSTMENT_PAYOUT_DATE");
    const reviewed = await review(tx, scope, (request.snapshot as { input: unknown }).input, id);
    if (reviewed.fingerprint !== request.fingerprint) throw new Error("ADJUSTMENT_CHANGED");
    return post(tx, scope, request, reviewed, { reference, date });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
export async function adjustmentDocument(scope: RequestScope, id: string) {
  const request = await db.financialAdjustment.findFirst({ where: { id, ...scoped(scope), status: "POSTED" } });
  if (!request?.documentId) throw new Error("ADJUSTMENT_NOT_FOUND");
  await context(db, scope, request.accountId);
  const doc = await db.document.findUniqueOrThrow({ where: { id: request.documentId } });
  if (!doc.content || createHash("sha256").update(doc.content).digest("hex") !== doc.sha256) throw new Error("ADJUSTMENT_RECONCILIATION");
  return doc.content;
}
