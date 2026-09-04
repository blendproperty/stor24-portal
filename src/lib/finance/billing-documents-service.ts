/**
 * Orchestrates generating + emailing an invoice or statement for an
 * Account, and recording that it happened.
 *
 * Storage: reuses the existing `Document` model (currently used for signed
 * BlendSign lease documents) rather than a new table — every
 * signature-specific field on it (signerName, signingToken, initials,
 * clauseVersion, etc.) is nullable, `type` is a free-text String not an
 * enum, and it already has exactly what's needed here: `content` (the
 * rendered HTML), `sha256` (integrity/audit), `sentAt`. `storageKey` is
 * required by the schema; since this pass stores the document inline via
 * `content` rather than in blob storage, storageKey holds a synthetic
 * `inline:{sha256}` locator rather than a real object-storage key — worth
 * revisiting together with lease-document storage if a real blob store is
 * adopted later.
 *
 * Delivery tracking: reuses `CommunicationLog`, following the exact
 * upsert-by-idempotencyKey pattern src/lib/whatsapp.ts already uses for
 * WhatsApp sends — same model, same shape, different channel.
 *
 * Numbering: `INV-{year}-{sequence}` / `STMT-{year}-{sequence}` by counting
 * existing Document rows for the organisation this year. This is a
 * provisional scheme, not a decision — see claude/invoicing-statements-scope.md
 * §6 in the Stor24 project ("Invoice numbering") for the open question
 * (facility-scoped? aligned to a future MRI/MDA mapping?). It is also not
 * concurrency-safe (two documents generated in the same instant could in
 * theory get the same sequence number) — acceptable for the initial manual
 * send path this is built for, worth hardening (e.g. a DB sequence or a
 * unique constraint + retry) before high-volume automated use.
 *
 * Netcash: this module never calls Netcash. `payNowUrl` is accepted purely
 * as an optional pass-through string for the renderer — the caller decides
 * whether to supply one, and per claude/invoicing-statements-scope.md §0 it
 * should stay undefined until Pay Now is unblocked for real customers.
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { getBillingDocumentCompanyDetails } from "@/lib/finance/billing-document-config";
import { renderInvoiceHtml, type InvoiceLedgerLine } from "@/lib/finance/invoice-renderer";
import { renderStatementHtml, type StatementLedgerLine } from "@/lib/finance/statement-renderer";

type AccountBillingContext = {
  account: { id: string; accountNumber: string; balance: unknown; currency: string };
  customer: { id: string; email: string | null; firstName: string | null; lastName: string | null; companyName: string | null; taxNumber: string | null; billingAddress: unknown };
  tenancyId: string;
  facilityId: string;
  organisationId: string;
  facilityName: string;
  unitLabel: string | null;
};

function addressLines(billingAddress: unknown): string[] | undefined {
  if (!billingAddress || typeof billingAddress !== "object" || Array.isArray(billingAddress)) return undefined;
  const record = billingAddress as Record<string, unknown>;
  const lines = ["line1", "line2", "city", "province", "postalCode", "country"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return lines.length ? lines : undefined;
}

function customerDisplayName(customer: AccountBillingContext["customer"]): string {
  return customer.companyName?.trim() || [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() || "Customer";
}

async function getAccountBillingContext(accountId: string, organisationId: string): Promise<AccountBillingContext | null> {
  const account = await db.account.findFirst({
    where: { id: accountId, customer: { organisationId } },
    include: {
      customer: true,
      tenancy: {
        include: {
          facility: true,
          occupancies: { where: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } }, include: { unit: true }, orderBy: { startDate: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!account?.tenancy) return null;
  const occupancy = account.tenancy.occupancies[0];
  return {
    account: { id: account.id, accountNumber: account.accountNumber, balance: account.balance, currency: account.currency },
    customer: account.customer,
    tenancyId: account.tenancy.id,
    facilityId: account.tenancy.facilityId,
    organisationId,
    facilityName: account.tenancy.facility.name,
    unitLabel: occupancy ? `Unit ${occupancy.unit.number}` : null,
  };
}

async function nextDocumentNumber(organisationId: string, type: "INVOICE" | "STATEMENT"): Promise<string> {
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const count = await db.document.count({ where: { type, tenancy: { facility: { organisationId } }, createdAt: { gte: yearStart } } });
  const prefix = type === "INVOICE" ? "INV" : "STMT";
  return `${prefix}-${new Date().getUTCFullYear()}-${String(count + 1).padStart(5, "0")}`;
}

type SendResult =
  | { ok: true; documentId: string; communicationLogId: string }
  | { ok: false; code: "ACCOUNT_NOT_FOUND" | "NO_LEDGER_ENTRIES" | "NO_CUSTOMER_EMAIL" | "EMAIL_FAILED"; message?: string };

export async function sendInvoiceEmail(input: { accountId: string; organisationId: string; ledgerEntryIds: string[]; actorId: string; payNowUrl?: string }): Promise<SendResult> {
  const context = await getAccountBillingContext(input.accountId, input.organisationId);
  if (!context) return { ok: false, code: "ACCOUNT_NOT_FOUND" };
  if (!context.customer.email) return { ok: false, code: "NO_CUSTOMER_EMAIL" };

  const entries = await db.ledgerEntry.findMany({ where: { id: { in: input.ledgerEntryIds }, accountId: context.account.id }, orderBy: { effectiveAt: "asc" } });
  if (!entries.length) return { ok: false, code: "NO_LEDGER_ENTRIES" };

  const company = await getBillingDocumentCompanyDetails(context.organisationId, context.facilityId);
  const invoiceNumber = await nextDocumentNumber(context.organisationId, "INVOICE");
  const lines: InvoiceLedgerLine[] = entries.map((entry) => ({ id: entry.id, description: entry.description, effectiveAt: entry.effectiveAt, amount: entry.amount, taxAmount: entry.taxAmount }));

  const html = renderInvoiceHtml({
    invoiceNumber,
    issueDate: new Date(),
    facilityName: context.facilityName,
    company,
    customerName: customerDisplayName(context.customer),
    customerTaxNumber: context.customer.taxNumber ?? undefined,
    billingAddressLines: addressLines(context.customer.billingAddress),
    unitLabel: context.unitLabel ?? undefined,
    accountNumber: context.account.accountNumber,
    currentBalance: context.account.balance as number,
    lines,
    payNowUrl: input.payNowUrl,
  });

  const sha256 = createHash("sha256").update(html).digest("hex");
  const idempotencyKey = `INVOICE:${context.account.id}:${[...input.ledgerEntryIds].sort().join("+")}`;
  const idempotencyKeyHash = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);

  const document = await db.document.create({
    data: {
      tenancyId: context.tenancyId,
      type: "INVOICE",
      storageKey: `inline:${sha256}`,
      status: "GENERATED",
      content: html,
      sha256,
      idempotencyKey: `doc-invoice-${idempotencyKeyHash}`,
    },
  }).catch(async (error) => {
    // Unique constraint on idempotencyKey -- this exact invoice (same
    // account + same ledger entries) was already generated; reuse it
    // rather than creating a duplicate numbered invoice.
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return db.document.findFirst({ where: { idempotencyKey: `doc-invoice-${idempotencyKeyHash}` } });
    }
    throw error;
  });
  if (!document) return { ok: false, code: "ACCOUNT_NOT_FOUND" };

  const commsIdempotencyKey = `${document.idempotencyKey}:EMAIL`;
  try {
    await emailProvider().send({ to: context.customer.email, subject: `Invoice ${invoiceNumber} from Stor24`, text: `Invoice ${invoiceNumber} — see the attached details. Total due reflects your current account balance.`, html });
    const log = await db.communicationLog.upsert({
      where: { idempotencyKey: commsIdempotencyKey },
      create: { organisationId: context.organisationId, facilityId: context.facilityId, customerId: context.customer.id, channel: "EMAIL", direction: "OUTBOUND", messageType: "INVOICE", recipientHash: createHash("sha256").update(context.customer.email).digest("hex"), status: "SENT", idempotencyKey: commsIdempotencyKey, sentAt: new Date(), metadata: { documentId: document.id, invoiceNumber } },
      update: { status: "SENT", sentAt: new Date() },
    });
    await db.document.update({ where: { id: document.id }, data: { sentAt: new Date(), status: "SENT" } });
    await db.auditEvent.create({ data: { organisationId: context.organisationId, facilityId: context.facilityId, actorId: input.actorId, action: "billing_document.invoice_sent", entityType: "Document", entityId: document.id, after: { invoiceNumber, accountId: context.account.id, ledgerEntryIds: input.ledgerEntryIds, communicationLogId: log.id } } });
    return { ok: true, documentId: document.id, communicationLogId: log.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const log = await db.communicationLog.upsert({
      where: { idempotencyKey: commsIdempotencyKey },
      create: { organisationId: context.organisationId, facilityId: context.facilityId, customerId: context.customer.id, channel: "EMAIL", direction: "OUTBOUND", messageType: "INVOICE", recipientHash: createHash("sha256").update(context.customer.email).digest("hex"), status: "FAILED", idempotencyKey: commsIdempotencyKey, failureMessage: message.slice(0, 500), failedAt: new Date(), metadata: { documentId: document.id, invoiceNumber } },
      update: { status: "FAILED", failureMessage: message.slice(0, 500), failedAt: new Date() },
    });
    return { ok: false, code: "EMAIL_FAILED", message };
  }
}

export async function sendStatementEmail(input: { accountId: string; organisationId: string; from?: Date; to: Date; actorId: string; payNowUrl?: string }): Promise<SendResult> {
  const context = await getAccountBillingContext(input.accountId, input.organisationId);
  if (!context) return { ok: false, code: "ACCOUNT_NOT_FOUND" };
  if (!context.customer.email) return { ok: false, code: "NO_CUSTOMER_EMAIL" };

  // Default range start: since the last statement sent for this tenancy, or
  // the tenancy's start date if none exists yet -- per
  // claude/invoicing-statements-scope.md §2.
  let from = input.from;
  if (!from) {
    const lastStatement = await db.document.findFirst({ where: { tenancyId: context.tenancyId, type: "STATEMENT" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const tenancy = await db.tenancy.findUnique({ where: { id: context.tenancyId }, select: { startDate: true } });
    from = lastStatement?.createdAt ?? tenancy?.startDate ?? input.to;
  }

  const [priorEntries, rangeEntries] = await Promise.all([
    db.ledgerEntry.findMany({ where: { accountId: context.account.id, effectiveAt: { lt: from } } }),
    db.ledgerEntry.findMany({ where: { accountId: context.account.id, effectiveAt: { gte: from, lte: input.to } }, orderBy: { effectiveAt: "asc" } }),
  ]);
  const DEBIT_TYPES = new Set(["CHARGE", "REVERSAL"]);
  const openingBalance = priorEntries.reduce((sum, entry) => sum + (DEBIT_TYPES.has(entry.type) ? Number(entry.amount) : -Number(entry.amount)), 0);
  const closingBalance = rangeEntries.reduce((sum, entry) => sum + (DEBIT_TYPES.has(entry.type) ? Number(entry.amount) : -Number(entry.amount)), openingBalance);

  const company = await getBillingDocumentCompanyDetails(context.organisationId, context.facilityId);
  const statementNumber = await nextDocumentNumber(context.organisationId, "STATEMENT");
  const lines: StatementLedgerLine[] = rangeEntries.map((entry) => ({ id: entry.id, type: entry.type, description: entry.description, effectiveAt: entry.effectiveAt, amount: entry.amount }));

  const html = renderStatementHtml({
    statementNumber,
    issueDate: new Date(),
    periodFrom: from,
    periodTo: input.to,
    facilityName: context.facilityName,
    company,
    customerName: customerDisplayName(context.customer),
    billingAddressLines: addressLines(context.customer.billingAddress),
    accountNumber: context.account.accountNumber,
    openingBalance,
    lines,
    closingBalance,
    payNowUrl: input.payNowUrl,
  });

  const sha256 = createHash("sha256").update(html).digest("hex");
  const idempotencyKey = `STATEMENT:${context.account.id}:${from.toISOString().slice(0, 10)}:${input.to.toISOString().slice(0, 10)}`;
  const idempotencyKeyHash = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);

  const document = await db.document.create({
    data: { tenancyId: context.tenancyId, type: "STATEMENT", storageKey: `inline:${sha256}`, status: "GENERATED", content: html, sha256, idempotencyKey: `doc-statement-${idempotencyKeyHash}` },
  }).catch(async (error) => {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return db.document.findFirst({ where: { idempotencyKey: `doc-statement-${idempotencyKeyHash}` } });
    }
    throw error;
  });
  if (!document) return { ok: false, code: "ACCOUNT_NOT_FOUND" };

  const commsIdempotencyKey = `${document.idempotencyKey}:EMAIL`;
  try {
    await emailProvider().send({ to: context.customer.email, subject: `Your Stor24 statement (${statementNumber})`, text: `Statement ${statementNumber} for the period ${from.toDateString()} to ${input.to.toDateString()}. Closing balance: R${closingBalance.toFixed(2)}.`, html });
    const log = await db.communicationLog.upsert({
      where: { idempotencyKey: commsIdempotencyKey },
      create: { organisationId: context.organisationId, facilityId: context.facilityId, customerId: context.customer.id, channel: "EMAIL", direction: "OUTBOUND", messageType: "STATEMENT", recipientHash: createHash("sha256").update(context.customer.email).digest("hex"), status: "SENT", idempotencyKey: commsIdempotencyKey, sentAt: new Date(), metadata: { documentId: document.id, statementNumber } },
      update: { status: "SENT", sentAt: new Date() },
    });
    await db.document.update({ where: { id: document.id }, data: { sentAt: new Date(), status: "SENT" } });
    await db.auditEvent.create({ data: { organisationId: context.organisationId, facilityId: context.facilityId, actorId: input.actorId, action: "billing_document.statement_sent", entityType: "Document", entityId: document.id, after: { statementNumber, accountId: context.account.id, from: from.toISOString(), to: input.to.toISOString(), communicationLogId: log.id } } });
    return { ok: true, documentId: document.id, communicationLogId: log.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const log = await db.communicationLog.upsert({
      where: { idempotencyKey: commsIdempotencyKey },
      create: { organisationId: context.organisationId, facilityId: context.facilityId, customerId: context.customer.id, channel: "EMAIL", direction: "OUTBOUND", messageType: "STATEMENT", recipientHash: createHash("sha256").update(context.customer.email).digest("hex"), status: "FAILED", idempotencyKey: commsIdempotencyKey, failureMessage: message.slice(0, 500), failedAt: new Date(), metadata: { documentId: document.id, statementNumber } },
      update: { status: "FAILED", failureMessage: message.slice(0, 500), failedAt: new Date() },
    });
    return { ok: false, code: "EMAIL_FAILED", message };
  }
}
