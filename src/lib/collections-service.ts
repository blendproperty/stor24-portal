import {receiptAllocationGraph} from "./receipt-reallocation-source";
import { arrearsAccessReview } from "./arrears-access-review-policy";
import { currentRoleAccess } from "./current-role-access";
import { createHash, randomUUID } from "node:crypto";
import { ARREARS_REVIEW_SCHEDULE, arrearsReviewScheduleWindow, nextArrearsReviewAt } from "./arrears-review-schedule-policy";
import { arrearsReviewPlanId, arrearsReviewScheduleActor, decodeArrearsReviewPlan, readArrearsReviewCursor, readArrearsReviewPlan, reviewSchedulePermissions, saveArrearsReviewCursor, saveArrearsReviewPlan, type ArrearsReviewScheduleState } from "./arrears-review-schedule-state";
import { z } from "zod";
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
const include = { customer: { select: { companyName: true, firstName: true, lastName: true, email: true, emailVerifiedAt: true, communicationConsent: true, updatedAt: true } }, tenancy: { include: { facility: { select: { id: true, name: true } } } }, ledgerEntries: { orderBy: [{ effectiveAt: "asc" }, { id: "asc" }] }, payments: { include: { merchandiseOrder: { select: { id: true } } } }, adjustments: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, select: { id: true } }, debitInstructions: { where: { run: { status: { not: "CANCELLED" } } }, select: { id: true } }, collectionCase: { include: { activities: { orderBy: { createdAt: "desc" }, take: 30 }, promises: { orderBy: { createdAt: "desc" }, take: 20 } } } } satisfies Prisma.AccountInclude;
type Account = Prisma.AccountGetPayload<{ include: typeof include }>;
async function accountFor(tx: Client, scope: RequestScope, id: string) {
  const account = await tx.account.findFirst({ where: { id, ...where(scope) }, include });
  if (!account?.tenancy) throw new Error("COLLECTION_NOT_FOUND"); return account;
}
async function owners(tx: Client, scope: RequestScope) {
  const users = await tx.user.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { id: true, name: true, roleAssignments: { include: { role: true } } } });
  return users.map(u => ({ id: u.id, name: u.name, facilities: u.roleAssignments.filter(a => a.role.organisationId === scope.organisationId && hasPermission(a.role.permissions, "collections.manage")).map(a => a.facilityId) })).filter(u => u.facilities.length > 0);
}
async function accessReviewAssignee(tx: Client, scope: RequestScope, facilityId: string, ownerId: string | null) {
  const users = await tx.user.findMany({ where: { organisationId: scope.organisationId, active: true, id: { in: [...new Set([scope.userId, ...(ownerId ? [ownerId] : [])])] } }, select: { id: true, roleAssignments: { include: { role: true } } } });
  const eligible = users.filter(user => ["collections.view", "collections.manage", "operations.view", "operations.manage"].every(permission => currentRoleAccess(user.roleAssignments.filter(assignment => assignment.role.organisationId === scope.organisationId), permission, facilityId).allowed));
  return eligible.some(user => user.id === ownerId) ? ownerId : eligible.some(user => user.id === scope.userId) ? scope.userId : null;
}
type ReceiptProof=Set<string>&{allocations:Map<string,{accountId:string;rootPaymentId:string;remainingCents:number;receivedAt:Date;recordedAt:Date}>;held:Set<string>;pending:Set<string>};
async function receiptEvidence(tx: Client, scope: RequestScope, accounts: Account[]):Promise<ReceiptProof> {
  const ids = accounts.flatMap(a => a.payments.map(p => p.id));
  const evidence = ids.length?await tx.auditEvent.findMany({ where: { organisationId: scope.organisationId, entityType: "Payment", entityId: { in: ids }, action: { in: ["payment.posted", "booking.payment_recorded"] } }, select: { entityId: true } }):[];
  const proof:ReceiptProof=Object.assign(new Set(evidence.map(e=>e.entityId)),{allocations:new Map(),held:new Set<string>(),pending:new Set<string>()});
  const accountIds=accounts.map(a=>a.id);
  const rows=accountIds.length?await tx.receiptReallocation.findMany({where:{OR:[{sourceAccountId:{in:accountIds}},{targetAccountId:{in:accountIds}}],status:{in:["PENDING_APPROVAL","POSTED"]}},take:5001,orderBy:{id:"asc"},select:{sourceAccountId:true,targetAccountId:true,paymentId:true,status:true}}):[];
  if(rows.length>5000)throw Error("COLLECTION_LIMIT");
  for(const row of rows.filter(r=>r.status==="PENDING_APPROVAL")){proof.pending.add(row.sourceAccountId);proof.pending.add(row.targetAccountId);}
  for(const root of new Set(rows.filter(r=>r.status==="POSTED").map(r=>r.paymentId))){
    try{
      const graph=await receiptAllocationGraph(tx,scope,root);
      for(const p of graph.positions)proof.allocations.set(p.entryId,{accountId:p.accountId,rootPaymentId:root,remainingCents:moneyCents(p.remaining),receivedAt:graph.receivedAt,recordedAt:graph.recordedAt});
    }catch(error){
      const message=error instanceof Error?error.message:"";
      if(message==="REALLOCATION_LIMIT")throw Error("COLLECTION_LIMIT");
      if(!["REALLOCATION_RECEIPT_REVIEW","REALLOCATION_NOT_FOUND","REALLOCATION_SCOPE","REALLOCATION_RECONCILIATION","COLLECTION_REVIEW"].includes(message)&&!(error instanceof Error&&error.name==="ZodError"))throw error;
      for(const row of rows.filter(r=>r.paymentId===root)){proof.held.add(row.sourceAccountId);proof.held.add(row.targetAccountId);}
    }
  }
  return proof;
}
function evaluate(account: Account, asOf: string, provenPayments: ReceiptProof) {
  const entries = account.ledgerEntries.map(e => ({ ...e, amount: e.amount.toString() }));
  const verifiedReceiptIds: string[] = []; let receiptIssue = provenPayments.held.has(account.id);
  let currentValues: ReturnType<typeof effectiveEntries> = [];
  try { currentValues = effectiveEntries(entries, "9998-12-31"); } catch { receiptIssue = true; }
  for (const e of account.ledgerEntries.filter(e => e.type === "PAYMENT")) {
    const allocation=provenPayments.allocations.get(e.id);
    if(allocation){
      const effective=currentValues.find(v=>v.entry.id===e.id)?.amount??-1;
      const returned=currentValues.filter(v=>v.entry.type==="REFUND"&&(v.entry.metadata as {sourceEntryId?:string}|null)?.sourceEntryId===e.id).reduce((n,v)=>n+v.amount,0);
      if(allocation.accountId!==account.id||effective<0||effective-returned!==allocation.remainingCents)receiptIssue=true;else verifiedReceiptIds.push(e.id);
      continue;
    }
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
  let hold = account.collectionCase?.disputed ? "Dispute hold" : account.adjustments.length ? "Adjustment awaiting completion" : provenPayments.pending.has(account.id) ? "Receipt allocation awaiting independent review" : account.debitInstructions.length ? "Debit instruction needs review before follow-up" : null;
  if (!hold && account.payments.some(p => p.status === "PENDING" && !isTestPayment(p))) hold = "Payment awaiting confirmation";
  const promises = (account.collectionCase?.promises ?? []).map(p => ({ id: p.id, amount: p.amount.toString(), dueDate: p.dueDate, status: p.status, createdAt: p.createdAt.toISOString(), progress: ageing.issue ? null : promiseProgress(entries, verifiedReceiptIds.filter(id=>{const root=provenPayments.allocations.get(id);return !root||root.recordedAt>p.createdAt&&root.receivedAt>=p.createdAt;}), { ...p, amount: p.amount.toString() }, asOf) }));
  const openPromise = promises.find(p => p.status === "OPEN");
  if (!hold && openPromise && openPromise.dueDate >= southAfricaDateKey(new Date())) hold = `Agreed promise due ${openPromise.dueDate}`;
  if (!hold && openPromise?.progress?.covered) hold = "Promise receipts awaiting confirmation";
  return { ageing, entries, verifiedReceiptIds, hold, promises };
}
function accessReviewFor(account: Account, result: ReturnType<typeof evaluate>, asOf: string) {
  // A provider status without a verified, matching ledger receipt cannot become an access decision.
  // FAILED alone also does not distinguish an authoritative decline from an uncertain transport result.
  const unreviewedPayment = account.payments.filter(payment => !isTestPayment(payment)).some(payment => payment.status === "FAILED" || ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "REVERSED"].includes(payment.status) && !account.ledgerEntries.some(entry => result.verifiedReceiptIds.includes(entry.id) && (entry.externalRef === payment.idempotencyKey || (entry.metadata as { paymentId?: string } | null)?.paymentId === payment.id)));
  return arrearsAccessReview({ asOf, paymentMethod: account.tenancy?.paymentMethod ?? null, active: account.tenancy?.status === "ACTIVE", issue: result.ageing.issue, hold: result.hold ?? (unreviewedPayment ? "A failed or unposted payment outcome needs authoritative reconciliation review before access-review preparation." : null), charges: result.ageing.charges });
}
export async function collectionsWorkspace(scope: RequestScope, asOf: string, options: { reviewSchedules?: boolean } = {}) {
  dateKey.parse(asOf); if (asOf > southAfricaDateKey(new Date())) throw new Error("COLLECTION_DATE");
  return db.$transaction(async tx => {
    const accounts = await tx.account.findMany({ where: where(scope), include, orderBy: { accountNumber: "asc" }, take: 2001 });
    const staff = await owners(tx, scope);
    if (accounts.length > 2000) throw new Error("COLLECTION_LIMIT");
    const proof = await receiptEvidence(tx, scope, accounts);
    const actor = options.reviewSchedules === false ? null : await tx.user.findFirst({ where: { id: scope.userId, organisationId: scope.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } });
    const assignments = actor?.roleAssignments.filter(a => a.role.organisationId === scope.organisationId) ?? [];
    const plans = options.reviewSchedules === false ? [] : await tx.configurationProfile.findMany({ where: { organisationId: scope.organisationId, domain: ARREARS_REVIEW_SCHEDULE, id: { in: accounts.map(a => arrearsReviewPlanId(scope.organisationId, a.id)) } } });
    const planById = new Map(plans.map(p => [p.id, p]));
    function scheduleFor(account: Account) {
      const canManage = !!actor && reviewSchedulePermissions.every(key => currentRoleAccess(assignments, key, account.tenancy!.facilityId).allowed);
      try {
        const saved = planById.get(arrearsReviewPlanId(scope.organisationId, account.id));
        const plan = saved ? decodeArrearsReviewPlan(saved) : null;
        if (saved && (saved.facilityId !== account.tenancy!.facilityId || plan?.accountId !== account.id)) throw Error("ARREARS_REVIEW_SCHEDULE_INTEGRITY");
        return { plan, canManage, canSchedule: account.tenancy!.status === "ACTIVE" && ["EFT", "CARD"].includes(account.tenancy!.paymentMethod ?? ""), unavailable: false };
      } catch { return { plan: null, canManage: false, canSchedule: false, unavailable: true }; }
    }
    const rows = accounts.map(a => {
      const result = evaluate(a, asOf, proof), c = a.collectionCase;
      return { id: a.id, accountNumber: a.accountNumber, name: a.customer.companyName || [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" ") || "Unnamed customer", facilityId: a.tenancy!.facilityId, facility: a.tenancy!.facility.name, currentBalance: a.balance.toString(), ageing: result.ageing, hold: result.hold, accessReview: accessReviewFor(a, result, asOf), revision: c?.revision ?? 0, ownerId: c?.ownerId ?? null, nextFollowUp: c?.nextFollowUp ?? null, disputed: c?.disputed ?? false, disputeReason: c?.disputeReason ?? null, terms: termsSchema.safeParse(c?.terms).success ? termsSchema.parse(c?.terms) : null, promises: result.promises, activities: (c?.activities ?? []).map(v => ({ id: v.id, action: v.action, note: v.note, actorId: v.actorId, createdAt: v.createdAt.toISOString() })), owners: staff.filter(u => u.facilities.includes(null) || u.facilities.includes(a.tenancy!.facilityId)).map(u => ({ id: u.id, name: u.name })), sources: a.ledgerEntries.filter(e => e.type === "CHARGE").map(e => ({ id: e.id, description: e.description, date: southAfricaDateKey(e.effectiveAt) })) };
    });
    return { asOf, today: southAfricaDateKey(new Date()), userId: scope.userId, rows: rows.map((row, i) => ({ ...row, accessReviewSchedule: scheduleFor(accounts[i]) })), reviewScheduleWorkerEnabled: process.env.ARREARS_REVIEW_SCHEDULE_ENABLED === "true" && process.env.ARREARS_REVIEW_ORGANISATION_ID === scope.organisationId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
export type CollectionsWorkspaceData = Awaited<ReturnType<typeof collectionsWorkspace>>;

/** Minimal read-only report projection using the staff queue's receipt and due-date rules.
 * The caller supplies its already intersected report scope and transaction. */
export async function collectionCohortOutcomes(tx: Client, scope: RequestScope, ids: string[], asOf: string) {
  dateKey.parse(asOf);
  if (asOf > southAfricaDateKey(new Date())) throw new Error("COLLECTION_DATE");
  if (ids.length > 2000) throw new Error("COLLECTION_LIMIT");
  if (ids.length) {
    const account = { id: { in: ids }, ...where(scope) };
    const [entries, payments] = await Promise.all([
      tx.ledgerEntry.count({where:{account}}), tx.payment.count({where:{account}}),
    ]);
    if (entries > 5000 || payments > 5000) throw new Error("COLLECTION_LIMIT");
  }
  const accounts = ids.length ? await tx.account.findMany({ where: { id: { in: ids }, ...where(scope) }, include, take: 2001 }) : [];
  if (accounts.length > 2000) throw new Error("COLLECTION_LIMIT");
  const paymentIds = accounts.flatMap(account => account.payments.map(payment => payment.id));
  if (paymentIds.length && await tx.auditEvent.count({where:{organisationId:scope.organisationId,entityType:"Payment",entityId:{in:paymentIds},action:{in:["payment.posted","booking.payment_recorded"]}}}) > 5000) throw new Error("COLLECTION_LIMIT");
  const evidence = await receiptEvidence(tx, scope, accounts);
  return accounts.map(account => {
    const result = evaluate(account, asOf, evidence);
    const values = result.ageing.issue ? [] : effectiveEntries(result.entries, asOf);
    const verified = new Set(result.verifiedReceiptIds);
    const receipts = values.filter(v => v.entry.type === "PAYMENT" && verified.has(v.entry.id));
    const received = receipts.reduce((sum, v) => sum + v.amount, 0);
    const refunded = values.filter(v => v.entry.type === "REFUND" && verified.has((v.entry.metadata as {sourceEntryId?: string} | null)?.sourceEntryId ?? "")).reduce((sum, v) => sum + v.amount, 0);
    return { accountId: account.id, facilityId: account.tenancy!.facilityId, customerId: account.customerId,
      issue: result.ageing.issue, overdueCents: result.ageing.issue ? null : result.ageing.overdue,
      netReceiptCents: result.ageing.issue ? null : received - refunded,
      receiptCount: result.ageing.issue ? null : new Set(receipts.filter(v=>v.amount>0).map(v=>evidence.allocations.get(v.entry.id)?.rootPaymentId??v.entry.id)).size,
      hold: result.hold };
  });
}

/** Reuses the same due-date, receipt and hold rules as the staff queue. */
export async function collectionEmailSource(tx: Client, scope: RequestScope, accountId: string, asOf: string) {
  const account = await accountFor(tx, scope, accountId), evaluated = evaluate(account, asOf, await receiptEvidence(tx, scope, [account]));
  const blockers: string[] = [];
  if (account.tenancy!.status !== "ACTIVE") blockers.push("Only active tenancies are in this first notice workflow.");
  if (evaluated.ageing.issue) blockers.push(evaluated.ageing.issue);
  if (evaluated.hold) blockers.push(evaluated.hold);
  if (evaluated.ageing.overdue <= 0) blockers.push("No reconciled overdue amount is available.");
  if (!account.customer.emailVerifiedAt || !z.email().safeParse(account.customer.email).success) blockers.push("A verified customer email address is required.");
  if ((account.customer.communicationConsent as { email?: boolean } | null)?.email !== true) blockers.push("Explicit email communication consent is required.");
  const bound = { asOf, accountId: account.id, facilityId: account.tenancy!.facilityId, facilityName:account.tenancy!.facility.name, accountNumber: account.accountNumber, customerId: account.customerId, customerUpdatedAt: account.customer.updatedAt.toISOString(), accountUpdatedAt: account.updatedAt.toISOString(), balance: account.balance.toString(), currency: account.currency, tenancyStatus: account.tenancy!.status,
    ledger: account.ledgerEntries.map(e => ({ id: e.id, type: e.type, amount: e.amount.toString(), reversalOfId: e.reversalOfId, effectiveAt: e.effectiveAt.toISOString(), metadata: e.metadata })),
    receipts: account.payments.map(p => ({ id: p.id, status: p.status, amount: p.amount.toString(), environment: p.environment, provider: p.provider, processedAt: p.processedAt?.toISOString() ?? null })).sort((a,b)=>a.id.localeCompare(b.id)),
    verifiedReceipts: [...evaluated.verifiedReceiptIds].sort(), caseRevision: account.collectionCase?.revision ?? 0, terms: account.collectionCase?.terms ?? null, overdue: evaluated.ageing.overdue, blockers };
  return { accountId: account.id, customerId: account.customerId, facilityId: account.tenancy!.facilityId, facility: account.tenancy!.facility.name, accountNumber: account.accountNumber, recipient: account.customer.email ?? "", asOf, overdueCents: evaluated.ageing.overdue, blockers,
    fingerprint: createHash("sha256").update(JSON.stringify(bound)).digest("hex") };
}

/** Phone-channel notices use their own verified identity and consent, never an email-address fallback. */
export async function collectionPhoneSource(tx: Client, scope: RequestScope, accountId: string, channel: "SMS" | "WHATSAPP") {
  const asOf = southAfricaDateKey(new Date()), account = await accountFor(tx, scope, accountId);
  const customer = await tx.customer.findFirst({ where: { id: account.customerId, organisationId: scope.organisationId }, select: { phone: true, phoneVerifiedAt: true, communicationConsent: true, updatedAt: true } });
  if (!customer) throw Error("COLLECTION_NOT_FOUND");
  const result = evaluate(account, asOf, await receiptEvidence(tx, scope, [account]));
  const blockers = [result.ageing.issue, result.hold].filter((v): v is string => !!v);
  if (account.tenancy!.status !== "ACTIVE") blockers.push("Only an active tenancy may receive an arrears reminder.");
  if (result.ageing.overdue <= 0) blockers.push("No reconciled overdue balance is available.");
  if (account.payments.some(p => !isTestPayment(p) && (p.status === "FAILED" || p.status === "PENDING" || ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "REVERSED"].includes(p.status) && !account.ledgerEntries.some(e => result.verifiedReceiptIds.includes(e.id) && (e.externalRef === p.idempotencyKey || (e.metadata as { paymentId?: string } | null)?.paymentId === p.id))))) blockers.push("A pending, failed or unposted payment requires reconciliation before contact.");
  const consent = customer.communicationConsent as { sms?: boolean; whatsapp?: boolean; optedOutAt?: string | null } | null;
  if (!customer.phoneVerifiedAt) blockers.push("The customer's phone number must be verified.");
  if (consent?.[channel === "SMS" ? "sms" : "whatsapp"] !== true || consent?.optedOutAt) blockers.push(`Explicit current ${channel} consent is required.`);
  const bound = { channel, asOf, accountId, facilityId: account.tenancy!.facilityId, customer, updatedAt: account.updatedAt, balance: account.balance.toString(), ledger: result.entries, payments: account.payments.map(p => [p.id, p.status, p.amount.toString(), p.providerRef]), caseRevision: account.collectionCase?.revision ?? 0, terms: account.collectionCase?.terms, overdue: result.ageing.overdue, blockers };
  return { accountId, customerId: account.customerId, facilityId: account.tenancy!.facilityId, facility: account.tenancy!.facility.name, accountNumber: account.accountNumber, recipient: customer.phone ?? "", channel, asOf, overdueCents: result.ageing.overdue, blockers, fingerprint: createHash("sha256").update(JSON.stringify(bound)).digest("hex") };
}

async function prepareAccessReviewTask(tx: Client, scope: RequestScope, account: Account, ownerId: string | null, evaluated: ReturnType<typeof evaluate>, today: string, scheduled = false) {
  const assessment = accessReviewFor(account, evaluated, today);
  if (!assessment.eligible || !assessment.sourceChargeId || !assessment.reviewOn) throw Error("COLLECTION_ACCESS_REVIEW_HELD");
  const assigneeId = await accessReviewAssignee(tx, scope, account.tenancy!.facilityId, ownerId);
  if (!assigneeId) throw Error("COLLECTION_OWNER");
  const key = createHash("sha256").update(JSON.stringify(["ARREARS_ACCESS_REVIEW", scope.organisationId, account.id, assessment.sourceChargeId])).digest("hex");
  const previous = await tx.task.findUnique({ where: { requestKey: key } });
  const dueAt = new Date(`${assessment.reviewOn}T00:00:00+02:00`);
  if (previous) {
    if (previous.organisationId !== scope.organisationId || previous.facilityId !== account.tenancy!.facilityId || previous.purpose !== "ARREARS_ACCESS_REVIEW") throw Error("COLLECTION_CHANGED");
    const closed = ["COMPLETED", "CANCELLED"].includes(previous.status);
    const changed = !closed && (previous.assigneeId !== assigneeId || previous.dueAt?.getTime() !== dueAt.getTime());
    if (changed) await tx.task.update({ where: { id: previous.id }, data: { assigneeId, dueAt } });
    return { taskId: previous.id, assigneeId: closed ? previous.assigneeId : assigneeId, changed, assessment };
  }
  const task = await tx.task.create({ data: { organisationId: scope.organisationId, facilityId: account.tenancy!.facilityId, assigneeId, createdById: scope.userId, purpose: "ARREARS_ACCESS_REVIEW", requestKey: key, requestHash: createHash("sha256").update(JSON.stringify(assessment)).digest("hex"), title: `Access restriction review · ${account.accountNumber}`, description: `${scheduled ? "Prepared by an automatic evaluation under recorded staff delegation. " : ""}Authorised collections staff must open Collections and recheck current payment, dispute, arrangement and written-notice evidence. This internal task is not approval to restrict access, charge fees or change money.`, dueAt } });
  return { taskId: task.id, assigneeId, changed: true, assessment };
}

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
    let accessTaskId: string | null = null;
    let reviewAssigneeId: string | null = null;
    if (input.action === "access-review-task") {
      const prepared = await prepareAccessReviewTask(tx, scope, account, c.ownerId, evaluated, today);
      accessTaskId = prepared.taskId; reviewAssigneeId = prepared.assigneeId;
    } else if (input.action === "schedule-access-review" || input.action === "cancel-access-review-schedule") {
      await arrearsReviewScheduleActor(tx, scope, account.tenancy!.facilityId);
      const saved = await readArrearsReviewPlan(tx, scope.organisationId, account.id);
      if ((saved?.state.revision ?? null) !== input.scheduleRevision || saved && saved.row.facilityId !== account.tenancy!.facilityId) throw Error("COLLECTION_CHANGED");
      const row = { id: arrearsReviewPlanId(scope.organisationId, account.id), organisationId: scope.organisationId, facilityId: account.tenancy!.facilityId };
      if (input.action === "schedule-access-review") {
        if (account.tenancy!.status !== "ACTIVE" || !["EFT", "CARD"].includes(account.tenancy!.paymentMethod ?? "") || input.input.from < today) throw Error("ARREARS_REVIEW_SCHEDULE_INPUT");
        const creator = await tx.user.findUniqueOrThrow({ where: { id: scope.userId }, select: { name: true } });
        const plan: ArrearsReviewScheduleState = { revision: randomUUID(), accountId: account.id, creatorId: scope.userId, creatorName: creator.name.trim().slice(0, 160) || "Staff member", input: input.input, status: "ACTIVE", nextDueAt: nextArrearsReviewAt(input.input), last: null };
        await saveArrearsReviewPlan(tx, row, plan, !!saved);
      } else {
        if (!saved || saved.state.status !== "ACTIVE") throw Error("ARREARS_REVIEW_SCHEDULE_INPUT");
        await saveArrearsReviewPlan(tx, row, { ...saved.state, revision: randomUUID(), status: "CANCELLED" }, true);
      }
    } else if (input.action === "terms") {
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
    else if (input.action === "escalation-review") {
      if (input.reviewOn < today) throw new Error("COLLECTION_DATE");
      // Internal review record only. Never clear a hold, change terms, schedule a customer send, post a fee or command access.
    }
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
    const review = input.action === "escalation-review" ? {
      status: "HELD_POLICY", effect: "INTERNAL_REVIEW_ONLY", target: input.target, proposedChannel: input.target === "NOTICE" ? input.channel : null, reviewOn: input.reviewOn, proposedPolicyReference: input.policyReference || null,
      blockers: ["An approved escalation policy and responsible approver are required.", ...(evaluated.ageing.issue ? [evaluated.ageing.issue] : []), ...(evaluated.hold ? [evaluated.hold] : []), ...(input.target === "NOTICE" ? ["Use the existing independently reviewed email workflow where approved. Additional channels require approved templates, consent and provider acceptance."] : input.target === "FEE" ? ["Finance fee authority and the supported adjustment workflow are required."] : ["Approved access/legal policy, an authorised access operator and physical validation are required."])],
      sourceHash: createHash("sha256").update(JSON.stringify({ accountId: account.id, updatedAt: account.updatedAt, balance: account.balance.toString(), ledger: account.ledgerEntries.map(e => [e.id, e.type, e.amount.toString(), e.effectiveAt, e.reversalOfId]), caseRevision: input.revision, terms: c.terms, hold: evaluated.hold, issue: evaluated.ageing.issue })).digest("hex"),
      customerMessageSent: false, financialEntriesCreated: 0, accessCommandsCreated: 0,
    } : null;
    const activity = await tx.collectionActivity.create({ data: { caseId: c.id, requestKey: input.requestKey, actorId: scope.userId, action: input.action === "follow-up" ? input.outcome : review ? `Escalation review · ${review.target.toLowerCase()}${review.proposedChannel ? ` / ${review.proposedChannel}` : ""} · held for policy` : input.action,
      note: review ? `Internal review requested for ${review.reviewOn}. ${input.note}\n${review.blockers.join(" ")}${review.proposedPolicyReference ? ` Proposed policy evidence (unverified): ${review.proposedPolicyReference}.` : ""} No message, fee or access action was executed.` : accessTaskId ? `${input.note}\nInternal Operations review task ${accessTaskId} prepared. Separate written-notice checks and authorised access approval are still required. No message, fee, financial approval or access command was created.` : input.note, payload: json(input) } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: account.tenancy!.facilityId, actorId: scope.userId, entityType: "CollectionCase", entityId: c.id, action: `collections.${input.action}`, after: json({ activityId: activity.id, revision: input.revision + 1, ...(review ? { review } : {}), ...(accessTaskId ? { taskId: accessTaskId, assigneeId: reviewAssigneeId, assessment: accessReviewFor(account, evaluated, today), financialApproval: false, accessApproval: false } : {}), ...(["schedule-access-review", "cancel-access-review-schedule"].includes(input.action) ? { effect: "INTERNAL_REVIEW_TASKS_ONLY", financialApproval: false, accessApproval: false, feeAmount: null } : {}) }) } });
    return { id: activity.id, repeated: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}

/** Explicit delegated internal-task plans only. No customer send, fee, payment or access command. */
export async function processArrearsReviewSchedules(clock: () => Date = () => new Date(), elapsed: () => number = () => performance.now()) {
  if (process.env.ARREARS_REVIEW_SCHEDULE_ENABLED !== "true") return { disabled: true, evaluated: 0, prepared: 0, held: 0, more: false };
  const started = elapsed();
  const organisationId = z.cuid().parse(process.env.ARREARS_REVIEW_ORGANISATION_ID ?? "");
  const cursorTransaction = <T>(work: (tx: Client) => Promise<T>) => db.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`arrears-review-cursor:${organisationId}`}, 0))`;
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 10000 });
  const batch = await cursorTransaction(async tx => {
    const current = await readArrearsReviewCursor(tx, organisationId) ?? { cursor: null, lease: null };
    if (current.lease && new Date(current.lease.until).getTime() > Date.now()) return { candidates: [], more: true, lease: null };
    const { cursor } = current;
    const where = { organisationId, domain: ARREARS_REVIEW_SCHEDULE, status: "ACTIVE", config: { path: ["nextDueAt"], lte: clock().toISOString() } };
    let found = await tx.configurationProfile.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 26 });
    if (!found.length && cursor) found = await tx.configurationProfile.findMany({ where, orderBy: { id: "asc" }, take: 26 });
    const candidates = found.slice(0, 25);
    if (!candidates.length) return { candidates, more: false, lease: null };
    const lease = { token: randomUUID(), until: new Date(Date.now() + 120000).toISOString() };
    await saveArrearsReviewCursor(tx, organisationId, { cursor, lease });
    await tx.auditEvent.create({ data: { organisationId, actorId: null, facilityId: null, entityType: "ConfigurationProfile", entityId: `arrears-review-cursor:${organisationId}`, action: "collections.access-review-schedule.scan-started", after: json({ selected: candidates.length, taskCompletionClaimed: false, financialApproval: false, accessApproval: false }) } });
    return { candidates, more: found.length > 25, lease };
  });
  const { candidates } = batch;
  let evaluated = 0, prepared = 0, held = 0;
  let more = batch.more;
  const lease = batch.lease;
  if (!lease) return { disabled: false, evaluated, prepared, held, more };
  try {
  for (const candidate of candidates) {
    if (elapsed() - started > 25_000) { more = true; break; }
    const claimed = await cursorTransaction(async tx => {
      const current = await readArrearsReviewCursor(tx, organisationId), active = current?.lease;
      if (!current || !active || active.token !== lease.token || new Date(active.until).getTime() <= Date.now()) return false;
      // Only the row about to be attempted advances progress, never an untouched batch tail.
      await saveArrearsReviewCursor(tx, organisationId, { cursor: candidate.id, lease: active });
      await tx.auditEvent.create({ data: { organisationId, actorId: null, facilityId: null, entityType: "ConfigurationProfile", entityId: `arrears-review-cursor:${organisationId}`, action: "collections.access-review-schedule.scan-advanced", after: json({ attemptedPlan: candidate.id, taskCompletionClaimed: false, financialApproval: false, accessApproval: false }) } });
      return true;
    });
    if (!claimed) { more = true; break; }
    try {
      const initial = decodeArrearsReviewPlan(candidate);
      const outcome = await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        // Same account lock order as manual preparation, case edits and schedule cancellation.
        await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${initial.accountId} FOR UPDATE`;
        const saved = await readArrearsReviewPlan(tx, candidate.organisationId, initial.accountId);
        if (!saved || saved.state.status !== "ACTIVE" || !saved.row.facilityId) return "SKIPPED";
        const { state } = saved, at = clock(), window = arrearsReviewScheduleWindow(state.input, state.nextDueAt, at);
        const row = { id: saved.row.id, organisationId: saved.row.organisationId, facilityId: saved.row.facilityId };
        if (!window.due && !window.expired) {
          // A missed previous day never generates a backdated task or blocks later due plans.
          const next = new Date(`${window.day < state.input.from ? state.input.from : window.day}T${state.input.time}:00+02:00`).toISOString();
          if (state.nextDueAt < next) {
            await saveArrearsReviewPlan(tx, row, { ...state, nextDueAt: next }, true);
            await tx.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, actorId: null, entityType: "ConfigurationProfile", entityId: row.id, action: "collections.access-review-schedule.deferred", after: json({ day: window.day, nextDueAt: next, taskPrepared: false, financialApproval: false, accessApproval: false }) } });
          }
          return "SKIPPED";
        }
        if (state.last?.day === window.day) return "SKIPPED";
        let last: NonNullable<ArrearsReviewScheduleState["last"]> = { day: window.day, at: at.toISOString(), outcome: "HELD", taskId: null, reasons: [] };
        if (window.expired) last = { ...last, outcome: "EXPIRED", reasons: ["The explicit daily review date range has ended."] };
        else {
          const incoming: RequestScope = { userId: state.creatorId, organisationId: row.organisationId, facilityIds: [row.facilityId], unrestrictedFacilities: false };
          try {
            const scope = await arrearsReviewScheduleActor(tx, incoming, row.facilityId);
            const account = await accountFor(tx, scope, state.accountId);
            const source = evaluate(account, window.day, await receiptEvidence(tx, scope, [account]));
            const assessment = accessReviewFor(account, source, window.day);
            if (!assessment.eligible || !account.collectionCase) last.reasons = assessment.blockers.length ? assessment.blockers : ["Approved current case evidence is required."];
            else {
              const result = await prepareAccessReviewTask(tx, scope, account, account.collectionCase.ownerId, source, window.day, true);
              last = { ...last, outcome: result.changed ? "PREPARED" : "ALREADY_PREPARED", taskId: result.taskId };
              if (result.changed) {
                const requestKey = `scheduled-arrears-review:${createHash("sha256").update(JSON.stringify([row.id, state.revision, window.day])).digest("hex")}`;
                await tx.collectionActivity.create({ data: { caseId: account.collectionCase.id, requestKey, actorId: state.creatorId, action: "Scheduled internal review task prepared", note: "An automatic evaluation under the recorded staff delegation prepared an internal Operations review task. Staff have not approved restriction or fees. Recheck all current sources and required notice before any separately authorised action.", payload: json({ source: "SCHEDULED_INTERNAL_REVIEW", planId: row.id, planRevision: state.revision, day: window.day, taskId: result.taskId, delegatedById: state.creatorId, assessment: result.assessment, financialApproval: false, accessApproval: false, feeAmount: null }) } });
                await tx.collectionCase.update({ where: { id: account.collectionCase.id }, data: { revision: { increment: 1 } } });
              }
            }
          } catch (error) {
            const code = error instanceof Error ? error.message : "";
            if (!["FORBIDDEN", "COLLECTION_NOT_FOUND", "COLLECTION_OWNER", "COLLECTION_LIMIT", "COLLECTION_REVIEW"].includes(code)) throw error;
            last.reasons = [code === "FORBIDDEN" ? "The delegating staff member no longer has all required current store permissions." : "Current account, payment or assignee sources require staff review."];
          }
        }
        const next = { ...state, last, nextDueAt: nextArrearsReviewAt(state.input, window.day), status: window.expired || window.day >= state.input.until ? "EXPIRED" as const : "ACTIVE" as const };
        await saveArrearsReviewPlan(tx, row, next, true);
        await tx.auditEvent.create({ data: { organisationId: row.organisationId, facilityId: row.facilityId, actorId: null, entityType: "ConfigurationProfile", entityId: row.id, action: "collections.access-review-schedule.evaluated", after: json({ source: "SCHEDULED_INTERNAL_REVIEW", planRevision: state.revision, delegatedById: state.creatorId, ...last, financialApproval: false, accessApproval: false, feeAmount: null, customerMessageSent: false }) } });
        return last.outcome;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 20000 });
      if (outcome !== "SKIPPED") evaluated++;
      if (outcome === "PREPARED") prepared++;
      if (outcome === "HELD") held++;
    } catch { held++; /* A failed/uncertain transaction is never blindly replayed in this run. */ }
  }
  } finally {
    await cursorTransaction(async tx => {
      const current = await readArrearsReviewCursor(tx, organisationId);
      if (current?.lease?.token === lease.token) {
        await saveArrearsReviewCursor(tx, organisationId, { cursor: current.cursor, lease: null });
        await tx.auditEvent.create({ data: { organisationId, actorId: null, facilityId: null, entityType: "ConfigurationProfile", entityId: `arrears-review-cursor:${organisationId}`, action: "collections.access-review-schedule.scan-released", after: json({ cursor: current.cursor, taskCompletionClaimed: false }) } });
      }
    });
  }
  return { disabled: false, evaluated, prepared, held, more };
}
