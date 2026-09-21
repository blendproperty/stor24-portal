import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import { encryptIntegrationSecret, integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import { isTestPayment } from "@/lib/payments/payment-evidence";
import { mriMonthRange, mriSettingsSchema, summariseMriSource } from "@/lib/mri-policy";

type Stored = { version?: number; databaseLabel?: string; environment?: string; loginEncrypted?: string; passwordEncrypted?: string; databaseIdentifierEncrypted?: string };
const where = (organisationId: string) => ({ organisationId, facilityId: null, category: "ACCOUNTING", provider: "MRI" });
function orgScope(scope: RequestScope) { if (!scope.unrestrictedFacilities) throw new Error("MRI_ORG_PERMISSION"); }
async function connection(tx: Prisma.TransactionClient, organisationId: string) {
  const rows = await tx.integrationConnection.findMany({ where: where(organisationId), take: 2 });
  if (rows.length > 1) throw new Error("MRI_DUPLICATE_CONFIG");
  return rows[0] ?? null;
}
function stored(config: unknown): Stored {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("MRI_CONFIG_VERSION");
  const value = config as Stored;
  if (value.version !== 1) throw new Error("MRI_CONFIG_VERSION");
  return value;
}

export async function mriConfiguration(scope: RequestScope) {
  orgScope(scope);
  const row = await connection(db, scope.organisationId), config = row ? stored(row.config) : {};
  return {
    revision: row?.updatedAt.toISOString() ?? null,
    databaseLabel: config.databaseLabel ?? "",
    environment: config.environment ?? "unknown",
    credentialsStored: Boolean(config.loginEncrypted && config.passwordEncrypted),
    databaseIdentifierStored: Boolean(config.databaseIdentifierEncrypted),
    encryptionReady: integrationEncryptionConfigured(),
    // Saving credentials cannot assert provider authentication or authorise posting.
    authenticated: false, postingEnabled: false,
  };
}

export async function saveMriConfiguration(scope: RequestScope, input: unknown) {
  orgScope(scope);
  const parsed = mriSettingsSchema.parse(input);
  if (!integrationEncryptionConfigured()) throw new Error("MRI_ENCRYPTION");
  await db.$transaction(async tx => {
    const old = await connection(tx, scope.organisationId);
    if ((old?.updatedAt.toISOString() ?? null) !== parsed.revision) throw new Error("MRI_CHANGED");
    const previous = old ? stored(old.config) : {};
    const changedTarget = old && (previous.databaseLabel !== parsed.databaseLabel || previous.environment !== parsed.environment);
    // Never retain the former database identifier when changing the target.
    const databaseIdentifierEncrypted = parsed.databaseIdentifier
      ? encryptIntegrationSecret(parsed.databaseIdentifier)
      : changedTarget ? undefined : previous.databaseIdentifierEncrypted;
    const config = {
      version: 1, databaseLabel: parsed.databaseLabel, environment: parsed.environment,
      loginEncrypted: parsed.login ? encryptIntegrationSecret(parsed.login) : previous.loginEncrypted,
      passwordEncrypted: parsed.password ? encryptIntegrationSecret(parsed.password) : previous.passwordEncrypted,
      databaseIdentifierEncrypted,
    };
    if (!config.loginEncrypted || !config.passwordEncrypted) throw new Error("MRI_CREDENTIALS");
    const data = { config: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue, status: "CONFIGURED" as const, lastSuccessAt: null, lastHealthAt: null, failureCode: "MRI_CONTRACT_REQUIRED", failureMessage: "API authentication and journal contract not verified." };
    const saved = old
      ? await tx.integrationConnection.update({ where: { id: old.id }, data: { ...data, updatedAt: new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1)) } })
      : await tx.integrationConnection.create({ data: { ...where(scope.organisationId), id: `mri:${scope.organisationId}`, ...data } });
    await tx.auditEvent.create({ data: {
      organisationId: scope.organisationId, actorId: scope.userId, action: "integration.mri.settings.saved", entityType: "IntegrationConnection", entityId: saved.id,
      after: { credentialsStored: true, credentialsReplaced: Boolean(parsed.login), databaseIdentifierStored: Boolean(databaseIdentifierEncrypted), targetChanged: Boolean(changedTarget), authenticated: false, postingEnabled: false },
    } });
  }, { isolationLevel: "Serializable" });
  return mriConfiguration(scope);
}

/** Read-only inventory for finance review, NOT balanced or approved journals. */
export async function mriSourceReview(scope: RequestScope, month: string) {
  orgScope(scope);
  const { start, end, partial } = mriMonthRange(month);
  return db.$transaction(async tx => {
    const entries = await tx.ledgerEntry.findMany({
      where: { account: { customer: { organisationId: scope.organisationId } }, effectiveAt: { gte: start, lt: end } },
      include: { account: { select: { tenancy: { select: { facilityId: true, facility: { select: { name: true } } } } } } },
      orderBy: { id: "asc" }, take: 10001,
    });
    if (entries.length > 10000) throw new Error("MRI_SOURCE_LIMIT");
    const accountIds = [...new Set(entries.map(e => e.accountId))];
    const payments = await tx.payment.findMany({ where: { accountId: { in: accountIds } }, select: { accountId: true, status: true, environment: true, idempotencyKey: true, currency: true } });
    // Conservative preparation quarantine: any test payment or unsupported currency
    // in an account's history excludes ALL of its movements until finance reconciles it.
    const quarantine = new Set(payments.filter(p => isTestPayment(p) || p.currency !== "ZAR").map(p => p.accountId));
    const summary = summariseMriSource(entries.map(e => ({
      id: e.id, accountId: e.accountId, facilityId: e.account.tenancy?.facilityId ?? null,
      facilityName: e.account.tenancy?.facility.name ?? null, type: e.type,
      amount: e.amount.toFixed(2), taxAmount: e.taxAmount.toFixed(2), effectiveAt: e.effectiveAt.toISOString(),
    })), quarantine);
    const legacyQueue = await tx.webhookOutbox.count({ where: { organisationId: scope.organisationId, destination: "mri://pending-integration-decision" } });
    return { month, partial, ...summary, quarantinedAccounts: quarantine.size, legacyQueue, generatedAt: new Date().toISOString(), postingEnabled: false };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
