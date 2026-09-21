import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { facilityWhere, type RequestScope } from "@/lib/scope";
import { hasPermission } from "@/lib/permissions";
import { isTestPayment } from "@/lib/payments/payment-evidence";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { ageAccount, collectionActionSchema, dateKey, effectiveEntries, moneyCents, promiseProgress, termsSchema, type CollectionAction } from "@/lib/collections-policy";

type Client = Prisma.TransactionClient;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const where = (scope: RequestScope) => ({ customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(scope) } });
const include = { customer: { select: { companyName: true, firstName: true, lastName: true } }, tenancy: { include: { facility: { select: { id: true, name: true } } } }, ledgerEntries: { orderBy: [{ effectiveAt: "asc" }, { id: "asc" }] }, payments: { include: { merchandiseOrder: { select: { id: true } } } }, adjustments: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, select: { id: true } }, debitInstructions: { where: { run: { status: { not: "CANCELLED" } } }, select: { id: true } }, collectionCase: { include: { activities: { orderBy: { createdAt: "desc" }, take: 30 }, promises: { orderBy: { createdAt: "desc" }, take: 20 } } } } satisfies Prisma.AccountInclude;
type Account = Prisma.AccountGetPayload<{ include: typeof include }>;
async function accountFor(tx: Client, scope: RequestScope, id: string) {
  const account = await tx.account.findFirst({ where: { id, ...where(scope) }, include });
  if (!account?.tenancy) throw new Error("COLLECTION_NOT_FOUND"); return account;
}
async function owners(tx: Client, scope: RequestScope) {
  const users = await tx.user.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { id: true, name: true, roleAssignments: { include: { role: true } } } });
  return users.map(u => ({ id: u.id, name: u.name, facilities: u.roleAssignments.filter(a => a.role.organisationId === scope.organisationId && hasPermission(a.role.permissions, "collections.manage")).map(a => a.facilityId) })).filter(u => u.facilities.length > 0);
}
async function receiptEvidence(tx: Client, scope: RequestScope, accounts: Account[]) {
  const ids = accounts.flatMap(a => a.payments.map(p => p.id));
  if (!ids.length) return new Set<string>();
  const evidence = await tx.auditEvent.findMany({ where: { organisationId: scope.organisationId, entityType: "Payment", entityId: { in: ids }, action: { in: ["payment.posted", "booking.payment_recorded"] } }, select: { entityId: true } });
  return new Set(evidence.map(e => e.entityId));
}
function evaluate(account: Account, asOf: string, provenPayments: Set<string>) {
  const entries = account.ledgerEntries.map(e => ({ ...e, amount: e.amount.toString() }));
  const verifiedReceiptIds: string[] = []; let receiptIssue = false;
  let currentValues: ReturnType<typeof effectiveEntries> = [];
  try { currentValues = effectiveEntries(entries, "9998-12-31"); } catch { receiptIssue = true; }
  for (const e of account.ledgerEntries.filter(e => e.type === "PAYMENT")) {
    const matched = account.payments.filter(p => e.externalRef === p.idempotencyKey || (e.metadata as { paymentId?: string } | null)?.paymentId === p.id);
    const p = matched[0];
    const metadata = e.metadata as { verifiedStatus?: boolean; environment?: string } | null;
    const proof = p && (provenPayments.has(p.id) || (p.provider === "NETCASH" && metadata?.verifiedStatus === true && metadata.environment === "live"));
    const duplicates = p ? account.ledgerEntries.filter(v => v.type === "PAYMENT" && (v.externalRef === p.idempotencyKey || (v.metadata as { paymentId?: string } | null)?.paymentId === p.id)).length : 0;
    const effective = currentValues.find(v => v.entry.id === e.id)?.amount ?? -1;
    const refunded = currentValues.filter(v => v.entry.type === "REFUND" && (v.entry.metadata as { sourceEntryId?: string } | null)?.sourceEntryId === e.id).reduce((s, v) => s + v.amount, 0);
    const original = moneyCents(e.amount.toString());
    const consistent = p?.status === "REVERSED" ? effective === 0 && refunded === 0 : effective === original && (p?.status === "REFUNDED" ? refunded === original : p?.status === "PARTIALLY_REFUNDED" ? refunded > 0 && refunded < original : refunded === 0);
    if (matched.length !== 1 || duplicates !== 1 || !p || !proof || !consistent || p.merchandiseOrder || isTestPayment(p) || p.currency !== "ZAR" || !p.amount.equals(e.amount) || !["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "REVERSED"].includes(p.status) || (p.provider && p.environment !== "live")) receiptIssue = true;
    else verifiedReceiptIds.push(e.id);
  }
  const ageing = ageAccount(entries, account.balance.toString(), asOf, account.collectionCase?.terms);
  if (account.currency !== "ZAR") ageing.issue = "Non-rand account needs finance review.";
  if (receiptIssue) ageing.issue = "Unmatched, test or unverified receipt history needs reconciliation.";
  // Never display plausible numeric buckets for quarantined history.
  if (ageing.issue) { ageing.buckets = [0, 0, 0, 0, 0]; ageing.overdue = 0; ageing.charges = []; ageing.oldestDays = 0; }
  let hold = account.collectionCase?.disputed ? "Dispute hold" : account.adjustments.length ? "Adjustment awaiting completion" : account.debitInstructions.length ? "Debit instruction needs review before follow-up" : null;
  if (!hold && account.payments.some(p => p.status === "PENDING" && !isTestPayment(p))) hold = "Payment awaiting confirmation";
  const promises = (account.collectionCase?.promises ?? []).map(p => ({ id: p.id, amount: p.amount.toString(), dueDate: p.dueDate, status: p.status, createdAt: p.createdAt.toISOString(), progress: ageing.issue ? null : promiseProgress(entries, verifiedReceiptIds, { ...p, amount: p.amount.toString() }, asOf) }));
  const openPromise = promises.find(p => p.status === "OPEN");
  if (!hold && openPromise && openPromise.dueDate >= southAfricaDateKey(new Date())) hold = `Agreed promise due ${openPromise.dueDate}`;
  if (!hold && openPromise?.progress?.covered) hold = "Promise receipts awaiting confirmation";
  return { ageing, entries, verifiedReceiptIds, hold, promises };
}
export async function collectionsWorkspace(scope: RequestScope, asOf: string) {
  dateKey.parse(asOf); if (asOf > southAfricaDateKey(new Date())) throw new Error("COLLECTION_DATE");
  return db.$transaction(async tx => {
    const accounts = await tx.account.findMany({ where: where(scope), include, orderBy: { accountNumber: "asc" }, take: 2001 });
    const staff = await owners(tx, scope);
    if (accounts.length > 2000) throw new Error("COLLECTION_LIMIT");
    const proof = await receiptEvidence(tx, scope, accounts);
    const rows = accounts.map(a => {
      const result = evaluate(a, asOf, proof), c = a.collectionCase;
      return { id: a.id, accountNumber: a.accountNumber, name: a.customer.companyName || [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ") || "Unnamed customer", facilityId: a.tenancy!.facilityId, facility: a.tenancy!.facility.name, currentBalance: a.balance.toString(), ageing: result.ageing, hold: result.hold, revision: c?.revision ?? 0, ownerId: c?.ownerId ?? null, nextFollowUp: c?.nextFollowUp ?? null, disputed: c?.disputed ?? false, disputeReason: c?.disputeReason ?? null, terms: termsSchema.safeParse(c?.terms).success ? termsSchema.parse(c?.terms) : null, promises: result.promises, activities: (c?.activities ?? []).map(v => ({ id: v.id, action: v.action, note: v.note, actorId: v.actorId, createdAt: v.createdAt.toISOString() })), owners: staff.filter(u => u.facilities.includes(null) || u.facilities.includes(a.tenancy!.facilityId)).map(u => ({ id: u.id, name: u.name })), sources: a.ledgerEntries.filter(e => e.type === "CHARGE").map(e => ({ id: e.id, description: e.description, date: southAfricaDateKey(e.effectiveAt) })) };
    });
    return { asOf, today: southAfricaDateKey(new Date()), userId: scope.userId, rows };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
export type CollectionsWorkspaceData = Awaited<ReturnType<typeof collectionsWorkspace>>;

export async function updateCollection(scope: RequestScope, raw: CollectionAction) {
  const input = collectionActionSchema.parse(raw), today = southAfricaDateKey(new Date());
  return db.$transaction(async tx => {
    // Scope is checked before the lock; every writer for this case serialises on its account.
    await accountFor(tx, scope, input.accountId);
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${input.accountId} FOR UPDATE`;
    const account = await accountFor(tx, scope, input.accountId);
    let c = account.collectionCase;
    const previous = c ? await tx.collectionActivity.findUnique({ where: { caseId_requestKey: { caseId: c.id, requestKey: input.requestKey } } }) : null;
    if (previous) {
      if (previous.actorId !== scope.userId || JSON.stringify(collectionActionSchema.parse(previous.payload)) !== JSON.stringify(input)) throw new Error("COLLECTION_CHANGED");
      return { id: previous.id, repeated: true };
    }
    if ((c?.revision ?? 0) !== input.revision) throw new Error("COLLECTION_CHANGED");
    if (!c) c = { ...await tx.collectionCase.create({ data: { accountId: account.id } }), activities: [], promises: [] };
    const evaluated = evaluate(account, today, await receiptEvidence(tx, scope, [account]));
    const data: Prisma.CollectionCaseUpdateInput = { revision: { increment: 1 } };
    if (input.action === "terms") {
      const ids = new Set<string>();
      for (const o of input.terms.overrides) {
        const source = account.ledgerEntries.find(e => e.id === o.entryId && e.type === "CHARGE");
        if (!source || ids.has(o.entryId) || o.dueDate < southAfricaDateKey(source.effectiveAt)) throw new Error("COLLECTION_TERMS"); ids.add(o.entryId);
      }
      data.terms = json(input.terms);
    } else if (input.action === "follow-up") {
      if (input.nextFollowUp && input.nextFollowUp < today) throw new Error("COLLECTION_DATE");
      const eligible = await owners(tx, scope);
      if (input.ownerId && !eligible.some(u => u.id === input.ownerId && (u.facilities.includes(null) || u.facilities.includes(account.tenancy!.facilityId)))) throw new Error("COLLECTION_OWNER");
      data.ownerId = input.ownerId; data.nextFollowUp = input.nextFollowUp;
    } else if (input.action === "dispute") { data.disputed = input.disputed; data.disputeReason = input.disputed ? input.note : null; }
    else if (input.action === "promise") {
      if (evaluated.ageing.issue || evaluated.hold || moneyCents(input.amount) > evaluated.ageing.overdue || input.dueDate < today) throw new Error("COLLECTION_PROMISE");
      if (await tx.collectionPromise.count({ where: { caseId: c.id, status: "OPEN" } })) throw new Error("COLLECTION_PROMISE");
      await tx.collectionPromise.create({ data: { caseId: c.id, amount: input.amount, dueDate: input.dueDate, createdById: scope.userId } });
    } else {
      const p = await tx.collectionPromise.findFirst({ where: { id: input.promiseId, caseId: c.id, status: "OPEN" } });
      if (!p) throw new Error("COLLECTION_PROMISE");
      if (input.status === "KEPT" && (evaluated.ageing.issue || !promiseProgress(evaluated.entries, evaluated.verifiedReceiptIds, { ...p, amount: p.amount.toString() }, today).covered)) throw new Error("COLLECTION_PROMISE");
      await tx.collectionPromise.update({ where: { id: p.id }, data: { status: input.status, closedAt: new Date() } });
    }
    await tx.collectionCase.update({ where: { id: c.id }, data });
    const activity = await tx.collectionActivity.create({ data: { caseId: c.id, requestKey: input.requestKey, actorId: scope.userId, action: input.action === "follow-up" ? input.outcome : input.action, note: input.note, payload: json(input) } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: account.tenancy!.facilityId, actorId: scope.userId, entityType: "CollectionCase", entityId: c.id, action: `collections.${input.action}`, after: json({ activityId: activity.id, revision: input.revision + 1 }) } });
    return { id: activity.id, repeated: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
