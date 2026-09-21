import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { facilityWhere, requireFacility, type RequestScope } from "./scope";
import { getNetcashConnection } from "./payments/netcash-client";
import { buildCompactDebitFile, debitConnectionFingerprint, parseDebitLoadReport, retrieveDebitLoadReport, uploadDebitBatch, validDebitDate } from "./payments/netcash-debit-batch";
import { NETCASH_SOFTWARE_VENDOR_KEY } from "./integrations/netcash-configuration";
import { billingPeriodSchema } from "./monthly-billing-policy";
import type { MandateTerms } from "./payments/netcash-mandate";
import { refreshHostedMandate } from "./public-hosted-mandate";
import { isTestPayment } from "./payments/payment-evidence";

const DOMAIN = "DEBIT_COLLECTION";
type Client = Prisma.TransactionClient;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function testConnection(organisationId: string, facilityId: string) {
  const connection = await getNetcashConnection(organisationId, facilityId, true);
  const stored = await db.integrationConnection.findUniqueOrThrow({ where: { id: connection.id }, select: { config: true } });
  // The shared decoder defaults unknown values to sandbox. Debit runs require
  // the explicitly validated test environment, never that permissive default.
  if ((stored.config as { environment?: unknown } | null)?.environment !== "test" || connection.config.environment !== "sandbox") throw new Error("DEBIT_LIVE_NOT_APPROVED");
  return connection;
}
export const debitPlanSchema = z.object({ active: z.boolean(), firstPeriod: billingPeriodSchema, approvalReference: z.string().trim().min(5).max(200), masterfileConfirmed: z.literal(true) }).strict();
function accountsWhere(scope: RequestScope, facilityId?: string) {
  return { customer: { organisationId: scope.organisationId }, tenancy: { facility: { ...facilityWhere(scope), ...(facilityId ? { id: facilityId } : {}) } } };
}
async function accountContext(client: Client, scope: RequestScope, accountId: string) {
  const account = await client.account.findFirst({ where: { id: accountId, ...accountsWhere(scope) }, include: { tenancy: { include: { reservation: { include: { publicLease: { include: { mandate: true } } } } } } } });
  if (!account?.tenancy || account.customerId !== account.tenancy.customerId) throw new Error("DEBIT_ACCOUNT_NOT_FOUND");
  const mandate = account.tenancy.reservation?.publicLease?.mandate;
  return { account, tenancy: account.tenancy, mandate };
}
function assertMandate(m: Awaited<ReturnType<typeof accountContext>>["mandate"], connection: Awaited<ReturnType<typeof getNetcashConnection>>) {
  if (!m || m.status !== "SIGNED" || !m.verifiedAt || !m.signedPdf || !m.signedPdfSha256 || createHash("sha256").update(m.signedPdf).digest("hex") !== m.signedPdfSha256) throw new Error("DEBIT_SIGNED_MANDATE_REQUIRED");
  if (m.environment !== "sandbox" || m.connectionId !== connection.id || m.connectionFingerprint !== debitConnectionFingerprint(connection.config)) throw new Error("DEBIT_MANDATE_ENVIRONMENT_REVIEW");
  return m;
}
export async function debitWorkspace(scope: RequestScope) {
  const [facilities, accounts, runs] = await Promise.all([
    db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.account.findMany({ where: accountsWhere(scope), select: { id: true, accountNumber: true, tenancy: { select: { facilityId: true } } }, orderBy: { accountNumber: "asc" } }),
    db.debitOrderRun.findMany({ where: { organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) }, select: { id: true, batchName: true, facilityId: true, period: true, actionDate: true, environment: true, status: true, total: true, failureCode: true, createdAt: true, _count: { select: { instructions: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { facilities, accounts, runs, submissionEnabled: process.env.NETCASH_DEBIT_TEST_SUBMISSION_ENABLED === "true", liveEnabled: false };
}
export async function getDebitPlan(scope: RequestScope, accountId: string) {
  const { tenancy, mandate } = await accountContext(db, scope, accountId);
  const profile = await db.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, domain: DOMAIN, name: accountId } });
  return { plan: profile ? debitPlanSchema.parse(profile.config) : null, mandate: mandate ? { reference: mandate.reference, status: mandate.status, environment: mandate.environment, signedPdfAvailable: Boolean(mandate.signedPdfSha256) } : null };
}
export async function refreshAccountDebitMandate(scope: RequestScope, accountId: string) {
  const { tenancy } = await accountContext(db, scope, accountId);
  const token = tenancy.reservation?.publicLease?.signingToken;
  if (!token) throw new Error("DEBIT_SIGNED_MANDATE_REQUIRED");
  await refreshHostedMandate(token);
  return getDebitPlan(scope, accountId);
}
export async function saveDebitPlan(scope: RequestScope, accountId: string, value: unknown) {
  const plan = debitPlanSchema.parse(value);
  const initial = await accountContext(db, scope, accountId);
  const connection = plan.active ? await testConnection(scope.organisationId, initial.tenancy.facilityId) : null;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    const { tenancy, mandate } = await accountContext(tx, scope, accountId);
    if (plan.active) assertMandate(mandate, connection!);
    const profile = await tx.configurationProfile.upsert({ where: { organisationId_facilityId_domain_name: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, domain: DOMAIN, name: accountId } }, create: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, domain: DOMAIN, name: accountId, config: plan, status: "READY" }, update: { config: plan, status: "READY" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: tenancy.facilityId, actorId: scope.userId, action: "debit.plan_saved", entityType: "Account", entityId: accountId, after: plan } });
    return profile.config;
  });
}
export type DebitCandidate = { accountId: string; accountNumber: string; amount: number; reference?: string; mandateId?: string; invoiceId?: string; blocker?: string; evidence?: string };
export type DebitPreview = { facilityId: string; period: string; actionDate: string; connectionId: string; connectionFingerprint: string; environment: "sandbox"; rows: DebitCandidate[]; total: number; fingerprint: string };
async function preview(client: Client, scope: RequestScope, facilityId: string, period: string, actionDate: string, ownRunId?: string): Promise<DebitPreview> {
  billingPeriodSchema.parse(period);
  if (!validDebitDate(actionDate) || actionDate.slice(0, 7) !== period) throw new Error("DEBIT_DATE_INVALID");
  const connection = await testConnection(scope.organisationId, facilityId);
  if (connection.config.environment !== "sandbox") throw new Error("DEBIT_LIVE_NOT_APPROVED");
  if (!connection.config.debitOrderServiceKey) throw new Error("DEBIT_CONFIGURATION_REQUIRED");
  const connectionFingerprint = debitConnectionFingerprint(connection.config);
  const accounts = await client.account.findMany({ where: { ...accountsWhere(scope, facilityId), tenancy: { facilityId, facility: facilityWhere(scope), status: { in: ["ACTIVE", "NOTICE_GIVEN"] } } }, orderBy: { id: "asc" }, take: 501 });
  if (accounts.length > 500) throw new Error("DEBIT_BATCH_TOO_LARGE");
  const rows: DebitCandidate[] = [];
  for (const account of accounts) {
    const row: DebitCandidate = { accountId: account.id, accountNumber: account.accountNumber, amount: 0 };
    try {
      const { tenancy, mandate } = await accountContext(client, scope, account.id);
      if (tenancy.reservation?.publicLease?.status !== "SIGNED" || tenancy.reservation.customerId !== account.customerId) throw new Error("DEBIT_SIGNED_MANDATE_REQUIRED");
      if (await client.financialAdjustment.count({ where: { accountId: account.id, status: { in: ["PENDING_APPROVAL", "APPROVED"] } } })) throw new Error("DEBIT_ADJUSTMENT_PENDING");
      const profile = await client.configurationProfile.findFirst({ where: { organisationId: scope.organisationId, facilityId, domain: DOMAIN, name: account.id } });
      if (!profile) throw new Error("DEBIT_PLAN_REQUIRED");
      const plan = debitPlanSchema.parse(profile.config);
      if (!plan.active) throw new Error("DEBIT_PLAN_PAUSED");
      if (period < plan.firstPeriod) throw new Error("DEBIT_BEFORE_APPROVED_START");
      const m = assertMandate(mandate, connection);
      if (Date.now() - m.verifiedAt!.getTime() > 86_400_000) throw new Error("DEBIT_MANDATE_REFRESH_REQUIRED");
      const terms = m.terms as unknown as MandateTerms;
      const preferences = tenancy.reservation!.publicLease!.debitOrderPreferences as { firstCollectionDate?: string } | null;
      if (!preferences?.firstCollectionDate || !validDebitDate(preferences.firstCollectionDate) || actionDate < preferences.firstCollectionDate) throw new Error("DEBIT_BEFORE_MANDATE_START");
      if (Number(actionDate.slice(8)) !== terms.debitDay) throw new Error("DEBIT_MANDATE_DATE_MISMATCH");
      const reserved = await client.debitOrderInstruction.findUnique({ where: { accountId_period: { accountId: account.id, period } } });
      if (reserved && reserved.runId !== ownRunId) throw new Error("DEBIT_ALREADY_RESERVED");
      const invoice = await client.document.findUnique({ where: { idempotencyKey: `monthly-invoice:${account.id}:${period}` } });
      if (!invoice || invoice.tenancyId !== tenancy.id || !invoice.content || !invoice.sha256 || createHash("sha256").update(invoice.content).digest("hex") !== invoice.sha256) throw new Error("DEBIT_MONTHLY_INVOICE_REQUIRED");
      const entries = await client.ledgerEntry.findMany({ where: { accountId: account.id }, orderBy: { id: "asc" } });
      const payments = await client.payment.findMany({ where: { accountId: account.id }, orderBy: { id: "asc" } });
      const charges = entries.filter(e => (e.metadata as { invoiceNumber?: string } | null)?.invoiceNumber === invoice.externalId);
      const cents = charges.reduce((sum, e) => sum + Math.round(Number(e.amount) * 100) * (e.type === "CREDIT" ? -1 : 1), 0);
      if (!charges.length || charges.some(e => !["CHARGE", "CREDIT"].includes(e.type)) || !Number.isSafeInteger(cents) || cents <= 0 || account.currency !== "ZAR") throw new Error("DEBIT_AMOUNT_REVIEW_REQUIRED");
      // Without invoice allocation, an intervening receipt/credit or arrears balance
      // cannot safely be treated as this invoice's outstanding amount.
      const testPayments = payments.filter(isTestPayment);
      const contaminated = entries.some(e => e.type === "PAYMENT" && testPayments.some(p => e.externalRef === p.idempotencyKey || (e.metadata as { paymentId?: string } | null)?.paymentId === p.id));
      const unresolvedPayments = payments.some(p => ["PENDING", "TEST_PENDING"].includes(p.status) || (["SUCCEEDED", "TEST_SUCCEEDED"].includes(p.status) && (!p.processedAt || p.processedAt >= invoice.createdAt)));
      if (contaminated || Math.round(Number(account.balance) * 100) !== cents || entries.some(e => e.createdAt > invoice.createdAt) || unresolvedPayments) throw new Error("DEBIT_BALANCE_REVIEW_REQUIRED");
      if (Math.round(Number(terms.amount) * 100) !== cents) throw new Error("DEBIT_FIXED_MANDATE_AMOUNT_MISMATCH");
      Object.assign(row, { amount: cents / 100, reference: m.reference, mandateId: m.id, invoiceId: invoice.id, evidence: hash({ account, tenancy, plan, mandate: { id: m.id, terms: m.terms, status: m.status, pdf: m.signedPdfSha256, verifiedAt: m.verifiedAt }, entries, payments, invoice: invoice.sha256 }) });
    } catch (error) {
      if (!(error instanceof Error) || !/^DEBIT_[A-Z_]+$/.test(error.message)) throw error;
      row.blocker = error.message;
    }
    rows.push(row);
  }
  const total = rows.reduce((sum, r) => sum + (r.blocker ? 0 : Math.round(r.amount * 100)), 0) / 100;
  const result = { facilityId, period, actionDate, connectionId: connection.id, connectionFingerprint, environment: "sandbox" as const, rows, total };
  return { ...result, fingerprint: hash(result) };
}
export async function previewDebitRun(scope: RequestScope, facilityId: string, period: string, actionDate: string) {
  await requireFacility(scope, facilityId);
  return preview(db, scope, facilityId, period, actionDate);
}
export async function prepareDebitRun(scope: RequestScope, facilityId: string, period: string, actionDate: string, fingerprint: string) {
  await requireFacility(scope, facilityId);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id" = ${facilityId} FOR UPDATE`;
    const result = await preview(tx, scope, facilityId, period, actionDate);
    if (result.fingerprint !== fingerprint) throw new Error("DEBIT_PREVIEW_CHANGED");
    const eligible = result.rows.filter(r => !r.blocker);
    if (!eligible.length) throw new Error("DEBIT_NO_ELIGIBLE_ACCOUNTS");
    const run = await tx.debitOrderRun.create({ data: { organisationId: scope.organisationId, facilityId, period, actionDate, environment: result.environment, connectionId: result.connectionId, connectionFingerprint: result.connectionFingerprint, batchName: `ST24-${period.replace("-", "")}-${randomBytes(8).toString("hex")}`, fingerprint, snapshot: result as unknown as Prisma.InputJsonValue, total: result.total, createdById: scope.userId, instructions: { create: eligible.map(r => ({ accountId: r.accountId, period, invoiceId: r.invoiceId!, mandateId: r.mandateId!, reference: r.reference!, amount: r.amount })) } } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: "debit.run_prepared", entityType: "DebitOrderRun", entityId: run.id, after: { count: eligible.length, total: result.total, environment: "sandbox" } } });
    return { id: run.id, batchName: run.batchName };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
async function scopedRun(client: Client, scope: RequestScope, id: string) {
  const run = await client.debitOrderRun.findFirst({ where: { id, organisationId: scope.organisationId, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) }, include: { instructions: true } });
  if (!run) throw new Error("DEBIT_RUN_NOT_FOUND");
  return run;
}
export async function debitRunReview(scope: RequestScope, id: string) {
  const run = await scopedRun(db, scope, id);
  const snapshot = run.snapshot as unknown as DebitPreview;
  return { batchName: run.batchName, total: run.total, rows: snapshot.rows.map(({ accountId, accountNumber, amount, reference, blocker }) => ({ accountId, accountNumber, amount, reference, blocker })) };
}
export async function cancelDebitRun(scope: RequestScope, id: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "DebitOrderRun" WHERE "id" = ${id} FOR UPDATE`;
    const run = await scopedRun(tx, scope, id);
    if (run.status !== "PREPARED") throw new Error("DEBIT_RUN_NOT_CANCELLABLE");
    await tx.debitOrderInstruction.deleteMany({ where: { runId: id } }); // Immutable snapshot retains cancelled contents.
    await tx.debitOrderRun.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: run.facilityId, actorId: scope.userId, action: "debit.run_cancelled", entityType: "DebitOrderRun", entityId: id } });
  });
}
function assertTestSubmission(run: { environment: string; actionDate: string; instructions: Array<{ accountId: string }> }) {
  const approvedAccounts = (process.env.NETCASH_DEBIT_TEST_ACCOUNT_IDS ?? "").split(",").map(s => s.trim());
  const approvedDates = (process.env.NETCASH_DEBIT_TEST_ACTION_DATES ?? "").split(",").map(s => s.trim());
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (process.env.NETCASH_DEBIT_TEST_SUBMISSION_ENABLED !== "true" || run.environment !== "sandbox" || !approvedDates.includes(run.actionDate) || run.actionDate <= today || !run.instructions.length || run.instructions.some(r => !approvedAccounts.includes(r.accountId))) throw new Error("DEBIT_TEST_SUBMISSION_DISABLED");
}
export async function submitDebitRun(scope: RequestScope, id: string, confirmBatchName: string, request: typeof fetch = fetch) {
  const initial = await scopedRun(db, scope, id);
  assertTestSubmission(initial);
  if (confirmBatchName !== initial.batchName) throw new Error("DEBIT_CONFIRMATION_REQUIRED");
  const connection = await testConnection(scope.organisationId, initial.facilityId);
  if (connection.config.environment !== "sandbox" || !/^5\d{10}$/.test(connection.config.merchantAccount ?? "") || connection.config.transactionProcessingEnabled !== true || debitConnectionFingerprint(connection.config) !== initial.connectionFingerprint || connection.id !== initial.connectionId) throw new Error("DEBIT_CONFIGURATION_CHANGED");
  const file = buildCompactDebitFile(connection.config.debitOrderServiceKey!, NETCASH_SOFTWARE_VENDOR_KEY, initial.batchName, initial.actionDate, initial.instructions.map(r => ({ reference: r.reference, amount: Number(r.amount) })));
  // Claim before network I/O. An interrupted/ambiguous upload stays reserved and
  // is never retried automatically, even if the provider accepted the first call.
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "DebitOrderRun" WHERE "id" = ${id} FOR UPDATE`;
    const run = await scopedRun(tx, scope, id);
    if (run.status !== "PREPARED") throw new Error("DEBIT_RUN_ALREADY_SUBMITTED");
    for (const row of [...run.instructions].sort((a, b) => a.accountId.localeCompare(b.accountId))) await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${row.accountId} FOR UPDATE`;
    const latest = await preview(tx, scope, run.facilityId, run.period, run.actionDate, run.id);
    if (latest.fingerprint !== run.fingerprint) throw new Error("DEBIT_PREVIEW_CHANGED");
    await tx.debitOrderRun.update({ where: { id }, data: { status: "SUBMITTING", submittedAt: new Date() } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: run.facilityId, actorId: scope.userId, action: "debit.test_submission_started", entityType: "DebitOrderRun", entityId: id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
  try {
    const providerToken = await uploadDebitBatch(connection.config.debitOrderServiceKey!, file, request);
    await db.debitOrderRun.update({ where: { id }, data: { status: "SUBMITTED", providerToken } });
    return { status: "SUBMITTED" };
  } catch (error) {
    const code = error instanceof Error && /^DEBIT_UPLOAD_REJECTED_\d+$/.test(error.message) ? error.message : "DEBIT_PROVIDER_OUTCOME_UNKNOWN";
    await db.debitOrderRun.update({ where: { id }, data: { status: code.startsWith("DEBIT_UPLOAD_REJECTED") ? "REJECTED" : "REVIEW_REQUIRED", failureCode: code } });
    throw new Error(code);
  }
}
export async function refreshDebitRun(scope: RequestScope, id: string, request: typeof fetch = fetch) {
  const run = await scopedRun(db, scope, id);
  if (!run.providerToken || !["SUBMITTED", "REVIEW_REQUIRED"].includes(run.status)) throw new Error("DEBIT_REPORT_UNAVAILABLE");
  const connection = await testConnection(scope.organisationId, run.facilityId);
  if (connection.id !== run.connectionId || debitConnectionFingerprint(connection.config) !== run.connectionFingerprint) throw new Error("DEBIT_CONFIGURATION_CHANGED");
  if (run.checkedAt && Date.now() - run.checkedAt.getTime() < 30000) throw new Error("DEBIT_REPORT_COOLDOWN");
  const claim = await db.debitOrderRun.updateMany({ where: { id, checkedAt: run.checkedAt, status: run.status }, data: { checkedAt: new Date() } });
  if (!claim.count) throw new Error("DEBIT_REPORT_COOLDOWN");
  const report = await retrieveDebitLoadReport(connection.config.debitOrderServiceKey!, run.providerToken, request);
  const status = parseDebitLoadReport(report, run.batchName, run.actionDate, Number(run.total));
  await db.$transaction(async tx => {
    await tx.debitOrderRun.update({ where: { id }, data: { status, reportHash: hash(report), failureCode: status === "REVIEW_REQUIRED" ? "DEBIT_LOAD_REQUIRES_REVIEW" : null } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: run.facilityId, actorId: scope.userId, action: "debit.load_report_checked", entityType: "DebitOrderRun", entityId: id, after: { status, reportHash: hash(report) } } });
  });
  return { status }; // No Payment, ledger, access change, email or MRI export.
}
