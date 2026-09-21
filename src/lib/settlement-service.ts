import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import { decryptNetcashConfig } from "@/lib/payments/netcash-client";
import { merchantIdentity, requestDailyStatement, retrieveDailyStatement } from "@/lib/payments/netcash-statement";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/integration-secret-vault";
import { isTestPayment } from "@/lib/payments/payment-evidence";
import { buildAccountStatement } from "@/lib/finance/account-statement";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { amount, importStatementSchema, parseBankCsv, parseDailyStatement, settlementActionSchema, units } from "@/lib/settlement-policy";
import { csvCell, dateKey } from "@/lib/collections-policy";
type Client = Prisma.TransactionClient;
const hash = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
function orgScope(scope: RequestScope) { if (!scope.unrestrictedFacilities) throw new Error("SETTLEMENT_ORG_PERMISSION"); }
const today = () => southAfricaDateKey(new Date());
function past(date: string) { dateKey.parse(date); if (date >= today()) throw new Error("SETTLEMENT_DATE"); }
async function connection(tx: Client, scope: RequestScope, id: string) {
  orgScope(scope);
  const c = await tx.integrationConnection.findFirst({ where: { id, organisationId: scope.organisationId, provider: "NETCASH", category: "PAYMENTS" }, include: { facility: { select: { name: true } } } });
  if (!c) throw new Error("SETTLEMENT_NOT_FOUND");
  const environment = (c.config as { environment?: string }).environment;
  if (!["test", "live"].includes(environment ?? "")) throw new Error("SETTLEMENT_CONFIG");
  const cfg = decryptNetcashConfig(c.config);
  if (!cfg.merchantAccount || !/^5\d{10}$/.test(cfg.merchantAccount)) throw new Error("SETTLEMENT_CONFIG");
  return { id: c.id, config: cfg, merchantKey: merchantIdentity(scope.organisationId, cfg.environment, cfg.merchantAccount), merchantLabel: `${c.facility?.name ?? "Organisation merchant"} · …${cfg.merchantAccount.slice(-4)}`, fingerprint: hash([cfg.environment, cfg.merchantAccount, cfg.accountServiceKey]) };
}
async function audit(tx: Client, scope: RequestScope, id: string, action: string, details: unknown) {
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, entityType: "SettlementStatement", entityId: id, action: `settlement.${action}`, after: json(details) } });
}
async function serial<T>(scope: RequestScope, fn: (tx: Client) => Promise<T>) {
  orgScope(scope);
  return db.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${scope.organisationId} FOR UPDATE`; return fn(tx); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
}
async function statement(tx: Client, scope: RequestScope, id: string) {
  orgScope(scope);
  const s = await tx.settlementStatement.findFirst({ where: { id, organisationId: scope.organisationId }, include: { lines: { orderBy: { transactionId: "asc" } } } });
  if (!s) throw new Error("SETTLEMENT_NOT_FOUND"); return s;
}
type Statement = Awaited<ReturnType<typeof statement>>;
type Line = Statement["lines"][number];
async function paymentProof(tx: Client, scope: RequestScope, s: Statement, id: string, merchantConfirmed: boolean) {
  const p = await tx.payment.findFirst({ where: { id, account: { customer: { organisationId: scope.organisationId } } }, include: { account: { include: { ledgerEntries: { orderBy: { id: "asc" } }, payments: true } }, merchandiseOrder: { select: { id: true, isTest: true } } } });
  if (!p || s.environment !== "live" || p.provider !== "NETCASH" || p.environment !== "live" || p.currency !== "ZAR" || isTestPayment(p) || p.merchandiseOrder?.isTest || !["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "REVERSED"].includes(p.status)) throw new Error("SETTLEMENT_RECEIPT");
  if (p.providerMerchantKey ? p.providerMerchantKey !== s.merchantKey : !merchantConfirmed) throw new Error("SETTLEMENT_MERCHANT");
  const entries = p.account.ledgerEntries;
  if (entries.some(e => e.type === "PAYMENT" && p.account.payments.some(other => isTestPayment(other) && (e.externalRef === other.idempotencyKey || (e.metadata as { paymentId?: string } | null)?.paymentId === other.id)))) throw new Error("SETTLEMENT_RECEIPT");
  const matches = entries.filter(e => e.type === "PAYMENT" && (e.externalRef === p.idempotencyKey || (p.providerRef && e.externalRef === p.providerRef) || (e.metadata as { paymentId?: string } | null)?.paymentId === p.id));
  const source = matches[0];
  if (matches.length !== 1 || !source.amount.equals(p.amount)) throw new Error("SETTLEMENT_RECEIPT");
  const corrections = entries.filter(e => e.reversalOfId === source.id || (e.metadata as { paymentId?: string } | null)?.paymentId === p.id).filter(e => ["REFUND", "REVERSAL"].includes(e.type));
  const refunded = corrections.filter(e => e.type === "REFUND").reduce((n, e) => n + units(e.amount.toString()), BigInt(0));
  const reversed = corrections.filter(e => e.type === "REVERSAL");
  if (refunded > units(p.amount.toString()) || reversed.length > 1 || (reversed.length && (refunded > BigInt(0) || !reversed[0].amount.equals(p.amount)))) throw new Error("SETTLEMENT_RECEIPT");
  const expectedStatus = reversed.length ? "REVERSED" : refunded === units(p.amount.toString()) ? "REFUNDED" : refunded > BigInt(0) ? "PARTIALLY_REFUNDED" : "SUCCEEDED";
  if (p.status !== expectedStatus) throw new Error("SETTLEMENT_RECEIPT");
  const metadata = source.metadata as { verifiedStatus?: boolean; environment?: string } | null;
  const evidence = await tx.auditEvent.findFirst({ where: { organisationId: scope.organisationId, entityType: "Payment", entityId: p.id, action: { in: ["payment.posted", "booking.payment_recorded", "merchandise_order.payment_recorded"] } } });
  if (!evidence && !(metadata?.verifiedStatus === true && metadata.environment === "live")) throw new Error("SETTLEMENT_RECEIPT");
  const balance = buildAccountStatement(entries.map(e => ({ ...e, amount: e.amount.toString() })), new Date(0), new Date("9999-01-01")).closingBalance;
  if (units(balance) !== units(p.account.balance.toString())) throw new Error("SETTLEMENT_RECEIPT");
  return { id: p.id, amount: p.amount.toString(), status: p.status, merchantKey: p.providerMerchantKey, legacyMerchantConfirmed: !p.providerMerchantKey && merchantConfirmed, accountNumber: p.account.accountNumber, ledgerEntryId: source.id, evidenceId: evidence?.id ?? null, accountHash: hash({ entries, balance: p.account.balance, payments: p.account.payments }) };
}
async function proof(tx: Client, scope: RequestScope, s: Statement, l: Line, targetId: string | null, reference: string, merchantConfirmed: boolean) {
  if (l.kind === "RECEIPT") {
    if (!targetId) throw new Error("SETTLEMENT_RECEIPT");
    const p = await paymentProof(tx, scope, s, targetId, merchantConfirmed);
    if (units(p.amount) !== units(l.amount.toString())) throw new Error("SETTLEMENT_AMOUNT");
    return { type: "RECEIPT", payment: p };
  }
  if (l.kind === "RETURN") {
    const a = targetId ? await tx.financialAdjustment.findFirst({ where: { id: targetId, organisationId: scope.organisationId, status: "POSTED", kind: { in: ["REFUND", "REVERSAL"] } } }) : null;
    if (!a?.paymentId || !a.ledgerEntryId || units(a.amount.toString()) !== -units(l.amount.toString())) throw new Error("SETTLEMENT_RETURN");
    const refundCodes = ["PNR", "PVR", "PNX", "DRC"];
    if ((refundCodes.includes(l.code) && a.kind !== "REFUND") || (!refundCodes.includes(l.code) && a.kind !== "REVERSAL")) throw new Error("SETTLEMENT_RETURN");
    const p = await paymentProof(tx, scope, s, a.paymentId, merchantConfirmed);
    const ledger = await tx.ledgerEntry.findFirst({ where: { id: a.ledgerEntryId, accountId: a.accountId, type: a.kind as "REFUND" | "REVERSAL" } });
    if (!ledger || !ledger.amount.equals(a.amount) || (ledger.metadata as { adjustmentId?: string } | null)?.adjustmentId !== a.id) throw new Error("SETTLEMENT_RETURN");
    return { type: "RETURN", adjustment: { id: a.id, amount: a.amount.toString(), kind: a.kind, ledgerEntryId: ledger.id, postedAt: a.postedAt }, payment: p };
  }
  if (["PAYOUT", "BANK_RETURN"].includes(l.kind)) {
    const b = targetId ? await tx.settlementBankEntry.findFirst({ where: { id: targetId, active: true, import: { organisationId: scope.organisationId, status: "ACTIVE", environment: s.environment } }, include: { import: true } }) : null;
    if (!b || units(b.amount.toString()) !== -units(l.amount.toString()) || b.date < l.date) throw new Error("SETTLEMENT_BANK");
    if (hash(decryptIntegrationSecret(b.import.rawEncrypted)) !== b.import.sha256) throw new Error("SETTLEMENT_INTEGRITY");
    return { type: "BANK", id: b.id, bankKey: b.bankKey, alias: b.import.alias, transactionId: b.transactionId, date: b.date, amount: b.amount.toString(), reference: b.reference, sourceReference: b.import.sourceReference, importedById: b.import.importedById, sourceHash: b.import.sha256 };
  }
  if (targetId) throw new Error("SETTLEMENT_TARGET");
  // Unknown movements must not be explained away as if they proved settlement.
  if (l.kind === "OTHER" && !["INR", "IPR", "IRR", "REB", "NCA", "IAT", "IST", "BDW", "BAR", "ELM", "INS"].includes(l.code)) throw new Error("SETTLEMENT_UNSUPPORTED");
  return { type: "EXPLAINED", kind: l.kind, code: l.code, amount: l.amount.toString(), reference };
}
async function checkLine(tx: Client, scope: RequestScope, s: Statement, l: Line) {
  if (!l.reference || !l.resolutionHash) return "Unresolved";
  try {
    const snapshot = l.resolutionSnapshot as { merchantConfirmed?: boolean } | null;
    const current = await proof(tx, scope, s, l, l.paymentId ?? l.adjustmentId ?? l.bankEntryId, l.reference, snapshot?.merchantConfirmed === true);
    return hash(current) === l.resolutionHash ? null : "Source changed — rematch before approval";
  } catch { return "Source unavailable or inconsistent — investigate"; }
}
export async function settlementWorkspace(scope: RequestScope) {
  orgScope(scope);
  const connections = await db.integrationConnection.findMany({ where: { organisationId: scope.organisationId, category: "PAYMENTS", provider: "NETCASH" }, select: { id: true } });
  const merchants = [];
  for (const c of connections) { try { const v = await connection(db, scope, c.id); merchants.push({ id: v.id, label: v.merchantLabel, environment: v.config.environment, canFetch: !!v.config.accountServiceKey }); } catch { merchants.push({ id: c.id, label: "Netcash configuration needs review", environment: "unknown", canFetch: false }); } }
  const statements = await db.settlementStatement.findMany({ where: { organisationId: scope.organisationId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, date: true, merchantLabel: true, environment: true, source: true, sourceReference: true, opening: true, closing: true, status: true, revision: true, importedById: true, approvedAt: true, _count: { select: { lines: true } } } });
  const bankImports = await db.settlementBankImport.findMany({ where: { organisationId: scope.organisationId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, alias: true, environment: true, status: true, sourceReference: true, _count: { select: { entries: true } } } });
  const observations = await db.settlementBalanceObservation.findMany({ where: { organisationId: scope.organisationId }, orderBy: { createdAt: "desc" }, take: 20 });
  return { merchants, statements, bankImports, observations: observations.map(o => ({ ...o, held: amount(units(o.current.toString()) - units(o.available.toString())) })), userId: scope.userId, today: today() };
}
export async function settlementDetail(scope: RequestScope, id: string) {
  return db.$transaction(async tx => {
    const s = await statement(tx, scope, id), lines = [];
    for (const l of s.lines) lines.push({ id: l.id, transactionId: l.transactionId, code: l.code, description: l.description, date: l.date, amount: l.amount.toString(), vat: l.vat.toString(), extras: l.extras, kind: l.kind, paymentId: l.paymentId, adjustmentId: l.adjustmentId, bankEntryId: l.bankEntryId, reference: l.reference, resolvedById: l.resolvedById, issue: s.status === "VOID" ? "Voided" : await checkLine(tx, scope, s, l), snapshot: l.resolutionSnapshot });
    const payments = await tx.payment.findMany({ where: { provider: "NETCASH", environment: "live", account: { customer: { organisationId: scope.organisationId } }, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "REVERSED"] } }, select: { id: true, amount: true, providerRef: true, providerMerchantKey: true, idempotencyKey: true, status: true, environment: true, account: { select: { accountNumber: true } } }, orderBy: { createdAt: "desc" }, take: 501 });
    const adjustments = await tx.financialAdjustment.findMany({ where: { organisationId: scope.organisationId, status: "POSTED", kind: { in: ["REFUND", "REVERSAL"] } }, select: { id: true, kind: true, amount: true, paymentId: true }, orderBy: { postedAt: "desc" }, take: 501 });
    const bank = await tx.settlementBankEntry.findMany({ where: { active: true, import: { organisationId: scope.organisationId, environment: s.environment, status: "ACTIVE" } }, include: { import: { select: { alias: true } } }, orderBy: { date: "desc" }, take: 501 });
    // A bounded review must advertise missing candidate coverage rather than guess a match.
    return { id: s.id, date: s.date, status: s.status, revision: s.revision, environment: s.environment, merchantLabel: s.merchantLabel, opening: s.opening.toString(), closing: s.closing.toString(), source: s.source, sourceReference: s.sourceReference, importedById: s.importedById, editedById: s.editedById, approvedById: s.approvedById, approvalReference: s.approvalReference, lines, payments: payments.slice(0, 500).filter(p => !isTestPayment(p) && (!p.providerMerchantKey || p.providerMerchantKey === s.merchantKey)), adjustments: adjustments.slice(0, 500), bank: bank.slice(0, 500), candidatesTruncated: payments.length > 500 || adjustments.length > 500 || bank.length > 500 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
export async function previewStatement(scope: RequestScope, input: unknown) {
  const v = importStatementSchema.parse(input); past(v.date);
  const c = await connection(db, scope, v.connectionId), parsed = parseDailyStatement(v.raw, v.date);
  return { ...parsed, merchantLabel: c.merchantLabel, environment: c.config.environment, fingerprint: hash({ raw: v.raw, merchant: c.merchantKey, date: v.date, sourceReference: v.sourceReference }) };
}
async function saveStatement(scope: RequestScope, input: unknown, fingerprint: string | null, source: string, connectionFingerprint?: string) {
  const v = importStatementSchema.parse(input); past(v.date);
  return serial(scope, async tx => {
    const c = await connection(tx, scope, v.connectionId), parsed = parseDailyStatement(v.raw, v.date);
    if (connectionFingerprint && c.fingerprint !== connectionFingerprint) throw new Error("SETTLEMENT_CHANGED");
    if (fingerprint && hash({ raw: v.raw, merchant: c.merchantKey, date: v.date, sourceReference: v.sourceReference }) !== fingerprint) throw new Error("SETTLEMENT_CHANGED");
    const existing = await tx.settlementStatement.findFirst({ where: { organisationId: scope.organisationId, merchantKey: c.merchantKey, date: v.date, status: { not: "VOID" } } });
    if (existing) { if (existing.sha256 !== hash(v.raw)) throw new Error("SETTLEMENT_DUPLICATE"); return { id: existing.id }; }
    const s = await tx.settlementStatement.create({ data: { organisationId: scope.organisationId, connectionId: c.id, merchantKey: c.merchantKey, merchantLabel: c.merchantLabel, environment: c.config.environment, date: v.date, source, sourceReference: v.sourceReference, rawEncrypted: encryptIntegrationSecret(v.raw), sha256: hash(v.raw), opening: parsed.opening, closing: parsed.closing, importedById: scope.userId, editedById: scope.userId, lines: { create: parsed.lines.map(l => ({ ...l, extras: l.extras, merchantKey: c.merchantKey })) } } });
    await audit(tx, scope, s.id, "imported", { source, sourceHash: s.sha256, count: parsed.lines.length }); return { id: s.id };
  });
}
export async function settlementAction(scope: RequestScope, raw: unknown) {
  orgScope(scope); const v = settlementActionSchema.parse(raw);
  if (v.action === "preview") return previewStatement(scope, v);
  if (v.action === "import") return saveStatement(scope, v, v.fingerprint, "UPLOAD");
  if (v.action === "request") {
    past(v.date); const c = await connection(db, scope, v.connectionId); if (!c.config.accountServiceKey) throw new Error("SETTLEMENT_CONFIG");
    const token = await requestDailyStatement(c.config.accountServiceKey, v.date);
    return { ticket: encryptIntegrationSecret(JSON.stringify({ organisationId: scope.organisationId, connectionId: c.id, fingerprint: c.fingerprint, date: v.date, token, expires: Date.now() + 86400000 })), pending: true };
  }
  if (v.action === "retrieve") {
    const ticket = JSON.parse(decryptIntegrationSecret(v.ticket)) as { organisationId: string; connectionId: string; fingerprint: string; date: string; token: string; expires: number };
    if (ticket.organisationId !== scope.organisationId || ticket.expires < Date.now()) throw new Error("SETTLEMENT_CHANGED");
    const c = await connection(db, scope, ticket.connectionId); if (ticket.fingerprint !== c.fingerprint || !c.config.accountServiceKey) throw new Error("SETTLEMENT_CHANGED");
    const body = await retrieveDailyStatement(c.config.accountServiceKey, ticket.token);
    if (body === null) return { pending: true };
    return saveStatement(scope, { connectionId: c.id, date: ticket.date, raw: body, sourceReference: `Netcash daily download ${ticket.date}` }, null, "NETCASH", ticket.fingerprint);
  }
  return serial(scope, async tx => {
    if (v.action === "bank-import") {
      const rows = parseBankCsv(v.raw); if (rows.some(r => r.date > today())) throw new Error("SETTLEMENT_DATE");
      const bankKey = hash([scope.organisationId, v.environment, v.alias.trim().toLowerCase()]);
      const existing = await tx.settlementBankImport.findFirst({ where: { organisationId: scope.organisationId, bankKey, sha256: hash(v.raw), status: "ACTIVE" } });
      if (existing) return { id: existing.id };
      const b = await tx.settlementBankImport.create({ data: { organisationId: scope.organisationId, bankKey, alias: v.alias, environment: v.environment, sourceReference: v.sourceReference, rawEncrypted: encryptIntegrationSecret(v.raw), sha256: hash(v.raw), importedById: scope.userId, entries: { create: rows.map(r => ({ ...r, bankKey })) } } });
      await audit(tx, scope, b.id, "bank_imported", { count: rows.length, sourceHash: b.sha256 }); return { id: b.id };
    }
    if (v.action === "void-bank") {
      const b = await tx.settlementBankImport.findFirst({ where: { id: v.id, organisationId: scope.organisationId, status: "ACTIVE" }, include: { entries: true } });
      if (!b || await tx.settlementLine.count({ where: { active: true, bankEntryId: { in: b.entries.map(e => e.id) } } })) throw new Error("SETTLEMENT_BANK");
      await tx.settlementBankImport.update({ where: { id: b.id }, data: { status: "VOID" } }); await tx.settlementBankEntry.updateMany({ where: { importId: b.id }, data: { active: false } });
      await audit(tx, scope, b.id, "bank_voided", { reference: v.reference }); return { id: b.id };
    }
    if (v.action === "balance") {
      if (v.observedDate > today()) throw new Error("SETTLEMENT_DATE"); const current = units(v.current), available = units(v.available);
      if (available > current) throw new Error("SETTLEMENT_AMOUNT"); const c = await connection(tx, scope, v.connectionId);
      const b = await tx.settlementBalanceObservation.create({ data: { organisationId: scope.organisationId, merchantKey: c.merchantKey, merchantLabel: c.merchantLabel, environment: c.config.environment, observedDate: v.observedDate, current: amount(current), available: amount(available), reference: v.reference, recordedById: scope.userId } });
      await audit(tx, scope, b.id, "balance_observed", { reference: v.reference }); return { id: b.id };
    }
    const s = await statement(tx, scope, v.id);
    if (v.action === "resolve") {
      const l = s.lines.find(l => l.id === v.lineId); if (!l) throw new Error("SETTLEMENT_NOT_FOUND");
      const requestHash = hash(v), snapshot = l.resolutionSnapshot as { requestHash?: string } | null;
      if (l.requestKey === v.requestKey) { if (snapshot?.requestHash !== requestHash) throw new Error("SETTLEMENT_CHANGED"); return { id: s.id }; }
      if (s.status !== "DRAFT" || s.revision !== v.revision) throw new Error("SETTLEMENT_CHANGED");
      const p = await proof(tx, scope, s, l, v.targetId, v.reference, v.merchantConfirmed);
      await tx.settlementLine.update({ where: { id: l.id }, data: { paymentId: l.kind === "RECEIPT" ? v.targetId : null, adjustmentId: l.kind === "RETURN" ? v.targetId : null, bankEntryId: ["PAYOUT", "BANK_RETURN"].includes(l.kind) ? v.targetId : null, reference: v.reference, resolvedById: scope.userId, requestKey: v.requestKey, resolutionSnapshot: json({ proof: p, merchantConfirmed: v.merchantConfirmed, requestHash }), resolutionHash: hash(p) } });
      await tx.settlementStatement.update({ where: { id: s.id }, data: { revision: { increment: 1 }, editedById: scope.userId } });
      await audit(tx, scope, s.id, "line_resolved", { lineId: l.id, reference: v.reference, source: p }); return { id: s.id };
    }
    if (s.revision !== v.revision || s.status === "VOID") throw new Error("SETTLEMENT_CHANGED");
    if (v.action === "approve") {
      if (s.status !== "DRAFT" || s.importedById === scope.userId || s.editedById === scope.userId || s.lines.some(l => l.resolvedById === scope.userId)) throw new Error("SETTLEMENT_INDEPENDENT");
      if (await tx.auditEvent.count({ where: { organisationId: scope.organisationId, entityType: "SettlementStatement", entityId: s.id, action: "settlement.line_resolved", actorId: scope.userId } })) throw new Error("SETTLEMENT_INDEPENDENT");
      if (hash(decryptIntegrationSecret(s.rawEncrypted)) !== s.sha256) throw new Error("SETTLEMENT_INTEGRITY");
      for (const l of s.lines) {
        if (await checkLine(tx, scope, s, l)) throw new Error("SETTLEMENT_UNRESOLVED");
        if (l.bankEntryId) { const b = await tx.settlementBankEntry.findUniqueOrThrow({ where: { id: l.bankEntryId }, include: { import: true } }); if (b.import.importedById === scope.userId) throw new Error("SETTLEMENT_INDEPENDENT"); }
      }
      await tx.settlementStatement.update({ where: { id: s.id }, data: { status: "REVIEWED", revision: { increment: 1 }, approvedById: scope.userId, approvedAt: new Date(), approvalReference: v.reference } });
    } else if (v.action === "void") {
      if (s.status !== "DRAFT") throw new Error("SETTLEMENT_CHANGED");
      await tx.settlementStatement.update({ where: { id: s.id }, data: { status: "VOID", revision: { increment: 1 }, editedById: scope.userId } }); await tx.settlementLine.updateMany({ where: { statementId: s.id }, data: { active: false } });
    } else {
      if (s.status !== "REVIEWED") throw new Error("SETTLEMENT_CHANGED");
      await tx.settlementStatement.update({ where: { id: s.id }, data: { status: "DRAFT", revision: { increment: 1 }, editedById: scope.userId, approvedById: null, approvedAt: null, approvalReference: null } });
    }
    await audit(tx, scope, s.id, v.action, { reference: v.reference, previousApproval: s.approvalReference, previousApprover: s.approvedById, sourceHash: s.sha256 }); return { id: s.id };
  });
}
export async function settlementCsv(scope: RequestScope, id: string) {
  const s = await settlementDetail(scope, id);
  return "\uFEFF" + [["Merchant", "Environment", "Date", "Status", "Provider ID", "Code", "Amount ZAR", "VAT (included)", "Kind", "Current exception", "Payment", "Adjustment", "Bank entry", "Review reference"], ...s.lines.map(l => [s.merchantLabel, s.environment, s.date, s.status, l.transactionId, l.code, l.amount, l.vat, l.kind, l.issue, l.paymentId, l.adjustmentId, l.bankEntryId, l.reference])].map(r => r.map(csvCell).join(",")).join("\r\n");
}
