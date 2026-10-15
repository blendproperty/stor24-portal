import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { facilityWhere, requireFacility, type RequestScope } from "./scope";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "./integrations/integration-secret-vault";
import { lineKind, units } from "./settlement-policy";
import { assertIndependentReceiptReview, assertReceiptDate, receiptAmount, receiptIntakeSchema, receiptReviewActionSchema, reportedReceiptSchema, receiptReviewBoundary, type ReceiptIntakeInput, type ReceiptReviewAction } from "./unidentified-receipt-policy";

type Client = Prisma.TransactionClient;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function serial<T>(scope: RequestScope, fn: (tx: Client) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id"=${scope.organisationId} FOR UPDATE`;
    return fn(tx);
  }, { timeout: 30000 });
}
async function audit(tx: Client, scope: RequestScope, id: string, facilityId: string, action: string, evidence: unknown) {
  await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, entityType: "UnidentifiedReceiptIntake", entityId: id, action: `receipt_review.${action}`, after: json(evidence) } });
}
function manualProof(source: ReceiptIntakeInput["source"]) {
  const value = reportedReceiptSchema.parse(source); assertReceiptDate(value.receiptDate);
  const amount = receiptAmount(value.amount);
  const evidence = { ...value, amount };
  return { sourceType: value.sourceType, sourceId: null, sourceIdentity: hash([value.sourceType, value.receiptDate, value.evidenceReference.toUpperCase().replace(/\s+/g, " ")]), sourceFingerprint: hash(evidence), sourceEnvironment: "REPORTED_UNVERIFIED", receiptDate: value.receiptDate, amount, evidence };
}
async function importedProof(tx: Client, scope: RequestScope, sourceType: "BANK_IMPORT_ENTRY" | "NETCASH_STATEMENT_LINE", sourceId: string) {
  if (sourceType === "BANK_IMPORT_ENTRY") {
    const row = await tx.settlementBankEntry.findFirst({ where: { id: sourceId, active: true, import: { organisationId: scope.organisationId, status: "ACTIVE" } }, include: { import: true } });
    if (!row || await tx.settlementLine.count({ where: { active: true, bankEntryId: row.id } })) throw new Error("RECEIPT_REVIEW_SOURCE");
    const amount = receiptAmount(row.amount.toString()); assertReceiptDate(row.date);
    if (!["test", "live"].includes(row.import.environment)) throw new Error("RECEIPT_REVIEW_SOURCE");
    const evidence = { currencyBasis: "ORIGINAL_BANK_CURRENCY_UNVERIFIED", sourceType, sourceId, importId: row.importId, sha256: row.import.sha256, bankKey: row.bankKey, transactionId: row.transactionId, reference: row.reference, date: row.date, amount, alias: row.import.alias, environment: row.import.environment };
    return { sourceType, sourceId, sourceIdentity: hash([sourceType, row.import.environment, row.bankKey, row.transactionId]), sourceFingerprint: hash(evidence), sourceEnvironment: row.import.environment, receiptDate: row.date, amount, evidence };
  }
  const row = await tx.settlementLine.findFirst({ where: { id: sourceId, active: true, statement: { organisationId: scope.organisationId, status: { not: "VOID" } } }, include: { statement: true } });
  if (!row || row.paymentId || row.adjustmentId || row.bankEntryId || row.resolutionHash || row.kind !== "RECEIPT" || lineKind(row.code, units(row.amount.toString())) !== "RECEIPT" || !["test", "live"].includes(row.statement.environment)) throw new Error("RECEIPT_REVIEW_SOURCE");
  const amount = receiptAmount(row.amount.toString()); assertReceiptDate(row.date);
  const evidence = { sourceType, sourceId, statementId: row.statementId, sha256: row.statement.sha256, revision: row.statement.revision, status: row.statement.status, merchantKey: row.merchantKey, transactionId: row.transactionId, code: row.code, description: row.description, date: row.date, amount, extras: row.extras, environment: row.statement.environment };
  return { sourceType, sourceId, sourceIdentity: hash([sourceType, row.statement.environment, row.merchantKey, row.transactionId]), sourceFingerprint: hash(evidence), sourceEnvironment: row.statement.environment, receiptDate: row.date, amount, evidence };
}
async function intake(tx: Client, scope: RequestScope, id: string, facilityId: string) {
  if (!await tx.facility.findFirst({where:{AND:[{id:facilityId},facilityWhere(scope)]},select:{id:true}})) throw new Error("FACILITY_FORBIDDEN");
  const item = await tx.unidentifiedReceiptIntake.findFirst({ where: { id, organisationId: scope.organisationId, facilityId }, include: { proposals: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } } });
  if (!item) throw new Error("NOT_FOUND"); return item;
}
type Intake = Awaited<ReturnType<typeof intake>>;
async function currentProof(tx: Client, scope: RequestScope, item: Intake) {
  const proof = item.sourceType === "MANUAL_REPORTED"
    ? manualProof(JSON.parse(decryptIntegrationSecret(item.evidenceEncrypted)))
    : item.sourceId && ["BANK_IMPORT_ENTRY", "NETCASH_STATEMENT_LINE"].includes(item.sourceType)
      ? await importedProof(tx, scope, item.sourceType as "BANK_IMPORT_ENTRY" | "NETCASH_STATEMENT_LINE", item.sourceId) : null;
  if (item.currency !== "ZAR" || !proof || proof.sourceFingerprint !== item.sourceFingerprint || proof.sourceIdentity !== item.sourceIdentity || proof.amount !== item.amount.toFixed(2) || proof.receiptDate !== item.receiptDate || proof.sourceEnvironment !== item.sourceEnvironment) throw new Error("RECEIPT_REVIEW_CHANGED");
  return proof;
}
async function accountProof(tx: Client, scope: RequestScope, facilityId: string, accountId: string) {
  if (!await tx.account.findFirst({where:{id:accountId,customer:{organisationId:scope.organisationId},tenancy:{facilityId,facility:{organisationId:scope.organisationId}}},select:{id:true}})) throw new Error("RECEIPT_REVIEW_ACCOUNT");
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${accountId} FOR UPDATE`;
  const account = await tx.account.findFirst({ where: { id: accountId, customer: { organisationId: scope.organisationId }, tenancy: { facilityId, facility: { organisationId: scope.organisationId } } }, include: { customer: true, tenancy: true } });
  if (!account || account.currency !== "ZAR" || account.tenancy?.customerId !== account.customerId) throw new Error("RECEIPT_REVIEW_ACCOUNT");
  const evidence = { accountId: account.id, accountNumber: account.accountNumber, customerId: account.customerId, customer: account.customer.companyName || `${account.customer.firstName} ${account.customer.lastName}`, facilityId, tenancyId: account.tenancy.id, tenancyStatus: account.tenancy.status, balance: account.balance.toString(), updatedAt: account.updatedAt.toISOString() };
  return { fingerprint: hash(evidence), label: `${evidence.accountNumber} · ${evidence.customer}` };
}
export async function captureUnidentifiedReceipt(scope: RequestScope, raw: ReceiptIntakeInput) {
  const input = receiptIntakeSchema.parse(raw); await requireFacility(scope, input.facilityId);
  return serial(scope, async tx => {
    const requestHash = hash(input);
    const existing = await tx.unidentifiedReceiptIntake.findUnique({ where: { organisationId_requestKey: { organisationId: scope.organisationId, requestKey: input.requestKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.facilityId !== input.facilityId) throw new Error("CONFLICT");
      return { id: existing.id, idempotent: true };
    }
    if (input.source.sourceType !== "MANUAL_REPORTED" && !scope.unrestrictedFacilities) throw new Error("RECEIPT_REVIEW_SOURCE_PERMISSION");
    const proof = input.source.sourceType === "MANUAL_REPORTED" ? manualProof(input.source) : await importedProof(tx, scope, input.source.sourceType, input.source.sourceId);
    if (input.source.sourceType !== "MANUAL_REPORTED" && input.source.sourceFingerprint !== proof.sourceFingerprint) throw new Error("RECEIPT_REVIEW_CHANGED");
    if (await tx.unidentifiedReceiptIntake.findUnique({ where: { organisationId_sourceIdentity: { organisationId: scope.organisationId, sourceIdentity: proof.sourceIdentity } } })) throw new Error("RECEIPT_REVIEW_DUPLICATE");
    const { evidence, ...source } = proof;
    const item = await tx.unidentifiedReceiptIntake.create({ data: { ...source, organisationId: scope.organisationId, facilityId: input.facilityId, currency: "ZAR", capturedById: scope.userId, requestKey: input.requestKey, requestHash, evidenceEncrypted: encryptIntegrationSecret(JSON.stringify(evidence)) } });
    await audit(tx, scope, item.id, input.facilityId, "captured", { sourceType: source.sourceType, sourceFingerprint: source.sourceFingerprint, environment: source.sourceEnvironment, receiptDate: source.receiptDate, amount: source.amount, currency: "ZAR", financialPosting: false });
    return { id: item.id, idempotent: false };
  });
}
export async function actOnUnidentifiedReceipt(scope: RequestScope, raw: Exclude<ReceiptReviewAction, { action: "capture" }>) {
  const input = receiptReviewActionSchema.parse(raw);
  if (input.action === "capture") throw new Error("CONFLICT");
  return serial(scope, async tx => {
    const item = await intake(tx, scope, input.id, input.facilityId);
    if (item.revision !== input.revision || item.status === "WITHDRAWN") throw new Error("CONFLICT");
    if (input.action === "withdraw") {
      await tx.unidentifiedReceiptMatchProposal.updateMany({ where: { intakeId: item.id, status: { in: ["PROPOSED", "REVIEWED"] } }, data: { status: "WITHDRAWN" } });
      await tx.unidentifiedReceiptIntake.update({ where: { id: item.id }, data: { status: "WITHDRAWN", revision: { increment: 1 } } });
      await audit(tx, scope, item.id, item.facilityId, "withdrawn", { reference: input.reference, revision: item.revision + 1, financialPosting: false });
      return { id: item.id };
    }
    await currentProof(tx, scope, item);
    if (item.sourceEnvironment === "test") throw new Error("RECEIPT_REVIEW_TEST_SOURCE");
    if (input.action === "propose") {
      const account = await accountProof(tx, scope, item.facilityId, input.accountId);
      await tx.unidentifiedReceiptMatchProposal.updateMany({ where: { intakeId: item.id, status: { in: ["PROPOSED", "REVIEWED"] } }, data: { status: "SUPERSEDED" } });
      const proposal = await tx.unidentifiedReceiptMatchProposal.create({ data: { intakeId: item.id, accountId: input.accountId, accountFingerprint: account.fingerprint, sourceFingerprint: item.sourceFingerprint, proposedById: scope.userId, detailsEncrypted: encryptIntegrationSecret(JSON.stringify({ accountLabel: account.label, reason: input.reason })) } });
      await tx.unidentifiedReceiptIntake.update({ where: { id: item.id }, data: { status: "PROPOSED", revision: { increment: 1 } } });
      await audit(tx, scope, item.id, item.facilityId, "proposed", { proposalId: proposal.id, sourceFingerprint: item.sourceFingerprint, accountFingerprint: account.fingerprint, revision: item.revision + 1, financialPosting: false });
      return { id: item.id };
    }
    const proposal = item.proposals.find(value => value.id === input.proposalId && value.status === "PROPOSED");
    if (!proposal || item.status !== "PROPOSED") throw new Error("CONFLICT");
    assertIndependentReceiptReview(item.capturedById, proposal.proposedById, scope.userId);
    const account = await accountProof(tx, scope, item.facilityId, proposal.accountId);
    if (account.fingerprint !== proposal.accountFingerprint || proposal.sourceFingerprint !== item.sourceFingerprint) throw new Error("RECEIPT_REVIEW_CHANGED");
    await tx.unidentifiedReceiptMatchProposal.update({ where: { id: proposal.id }, data: { status: input.decision, reviewedById: scope.userId, reviewedAt: new Date(), reviewReference: input.reference } });
    await tx.unidentifiedReceiptIntake.update({ where: { id: item.id }, data: { status: input.decision === "REVIEWED" ? "REVIEWED" : "OPEN", revision: { increment: 1 } } });
    await audit(tx, scope, item.id, item.facilityId, input.decision.toLowerCase(), { proposalId: proposal.id, reference: input.reference, revision: item.revision + 1, financialPosting: false });
    return { id: item.id };
  });
}

export async function unidentifiedReceiptWorkspace(scope: RequestScope, facilityId?: string, cursor?: string) {
  const facilities = await db.facility.findMany({ where: facilityWhere(scope), select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (facilityId) await requireFacility(scope, facilityId);
  const where = { organisationId: scope.organisationId, facilityId: { in: facilities.filter(f => !facilityId || f.id === facilityId).map(f => f.id) } };
  if (cursor && !await db.unidentifiedReceiptIntake.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) throw new Error("NOT_FOUND");
  const items = await db.unidentifiedReceiptIntake.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { proposals: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21 } } });
  const rows = await Promise.all(items.slice(0, 50).map(async item => {
    let evidence: Record<string, unknown> | null = null, issue: string | null = null;
    try { evidence = JSON.parse(decryptIntegrationSecret(item.evidenceEncrypted)); await currentProof(db, scope, item); } catch { issue = "Original evidence is unavailable or changed. Investigate before proposing or reviewing a match."; }
    const proposals = item.proposals.slice(0, 20).map(proposal => {
      let details = { accountLabel: "Protected details need review", reason: "" };
      try { details = JSON.parse(decryptIntegrationSecret(proposal.detailsEncrypted)); } catch { issue = "Protected proposal evidence needs administrator review."; }
      return { id: proposal.id, status: proposal.status, proposedById: proposal.proposedById, reviewedById: proposal.reviewedById, reviewedAt: proposal.reviewedAt, reviewReference: proposal.reviewReference, createdAt: proposal.createdAt, ...details };
    });
    return { id: item.id, facilityId: item.facilityId, sourceType: item.sourceType, sourceEnvironment: item.sourceEnvironment, currencyBasis: item.sourceType === "BANK_IMPORT_ENTRY" ? "ORIGINAL_BANK_CURRENCY_UNVERIFIED" : item.sourceType === "MANUAL_REPORTED" ? "REPORTED_ZAR_UNVERIFIED" : "NETCASH_ZAR_REVIEW", receiptDate: item.receiptDate, amount: item.amount.toFixed(2), currency: item.currency, status: item.status, revision: item.revision, capturedById: item.capturedById, createdAt: item.createdAt, reference: String(evidence?.evidenceReference ?? evidence?.reference ?? evidence?.transactionId ?? "Unavailable"), note: item.sourceType === "MANUAL_REPORTED" ? String(evidence?.note ?? "") : item.sourceType === "BANK_IMPORT_ENTRY" ? "Original bank import has no retained currency field. Confirm original statement currency separately; the ZAR account review context does not verify a receipt. Store assignment is for investigation only." : "Imported source; store assignment is for investigation only.", issue, proposals, proposalsTruncated: item.proposals.length > 20 };
  }));
  return { facilities, rows, nextCursor: items.length > 50 ? rows.at(-1)!.id : null, boundary: receiptReviewBoundary };
}
export async function unidentifiedReceiptAccounts(scope: RequestScope, facilityId: string, query: string) {
  await requireFacility(scope, facilityId);
  const accounts = await db.account.findMany({ where: { currency: "ZAR", customer: { organisationId: scope.organisationId }, tenancy: { facilityId, facility: { organisationId: scope.organisationId } }, OR: [{ accountNumber: { contains: query, mode: "insensitive" } }, { customer: { firstName: { contains: query, mode: "insensitive" } } }, { customer: { lastName: { contains: query, mode: "insensitive" } } }, { customer: { companyName: { contains: query, mode: "insensitive" } } }] }, select: { id: true, accountNumber: true, customerId: true, customer: { select: { firstName: true, lastName: true, companyName: true } }, tenancy: { select: { customerId: true } } }, orderBy: { accountNumber: "asc" }, take: 21 });
  return { rows: accounts.slice(0, 20).filter(a => a.tenancy?.customerId === a.customerId).map(a => ({ id: a.id, label: `${a.accountNumber} · ${a.customer.companyName || `${a.customer.firstName} ${a.customer.lastName}`}` })), truncated: accounts.length > 20 };
}
export async function unidentifiedReceiptSources(scope: RequestScope) {
  if (!scope.unrestrictedFacilities) throw new Error("RECEIPT_REVIEW_SOURCE_PERMISSION");
  const [bank, netcash] = await Promise.all([
    db.settlementBankEntry.findMany({ where: { active: true, amount: { gt: 0 }, import: { organisationId: scope.organisationId, status: "ACTIVE" } }, select: { id: true }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 101 }),
    db.settlementLine.findMany({ where: { active: true, kind: "RECEIPT", paymentId: null, adjustmentId: null, bankEntryId: null, resolutionHash: null, statement: { organisationId: scope.organisationId, status: { not: "VOID" } } }, select: { id: true }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 101 }),
  ]);
  const rows = [];
  for (const [sourceType, items] of [["BANK_IMPORT_ENTRY", bank], ["NETCASH_STATEMENT_LINE", netcash]] as const) for (const item of items.slice(0, 100)) {
    try { const proof = await importedProof(db, scope, sourceType, item.id); rows.push({ sourceType, sourceId: item.id, sourceFingerprint: proof.sourceFingerprint, label: `${sourceType === "BANK_IMPORT_ENTRY" ? "Bank" : "Netcash"} · ${proof.receiptDate} · ${sourceType === "BANK_IMPORT_ENTRY" ? `${proof.amount} (verify original currency)` : `R${proof.amount}`} · ${proof.sourceEnvironment} · ref ${proof.evidence.transactionId}` }); } catch { /* Unsupported sources stay in original reconciliation, never relabelled. */ }
  }
  return { rows, truncated: bank.length > 100 || netcash.length > 100, note: "Bounded imported credit candidates only; not a complete bank reconciliation or proof of customer payment." };
}
