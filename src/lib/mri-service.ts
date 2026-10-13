import { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { RequestScope } from "@/lib/scope";
import { decryptIntegrationSecret, encryptIntegrationSecret, integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import { verifyMriAccess } from "@/lib/integrations/mri-provider";
import { isTestPayment } from "@/lib/payments/payment-evidence";
import { mriMonthRange, mriSettingsSchema, summariseMriSource } from "@/lib/mri-policy";

type Stored = { version?: number; databaseLabel?: string; environment?: string; loginEncrypted?: string; passwordEncrypted?: string; databaseIdentifierEncrypted?: string; authenticated?: boolean; databaseReadable?: boolean; discoveryAvailable?: boolean; databases?: Array<{ key: string; label: string; identifierEncrypted: string }>; propertyCount?: number | null };
type Lane = "primary" | "sandbox";
export const MRI_SANDBOX_DATABASE = "BlendTest";
const where = (organisationId: string, lane: Lane = "primary") => ({ organisationId, facilityId: null, category: "ACCOUNTING", provider: lane === "sandbox" ? "MRI_SANDBOX" : "MRI" });
function orgScope(scope: RequestScope) { if (!scope.unrestrictedFacilities) throw new Error("MRI_ORG_PERMISSION"); }
async function connection(tx: Prisma.TransactionClient, organisationId: string, lane: Lane = "primary") {
  const rows = await tx.integrationConnection.findMany({ where: where(organisationId, lane), take: 2 });
  if (rows.length > 1) throw new Error("MRI_DUPLICATE_CONFIG");
  return rows[0] ?? null;
}
function stored(config: unknown): Stored {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("MRI_CONFIG_VERSION");
  const value = config as Stored;
  if (value.version !== 1) throw new Error("MRI_CONFIG_VERSION");
  return value;
}

export async function mriConfiguration(scope: RequestScope, lane: Lane = "primary") {
  orgScope(scope);
  const row = await connection(db, scope.organisationId, lane), config = row ? stored(row.config) : {};
  return {
    revision: row?.updatedAt.toISOString() ?? null,
    databaseLabel: config.databaseLabel ?? "",
    environment: config.environment ?? "unknown",
    credentialsStored: Boolean(config.loginEncrypted && config.passwordEncrypted),
    databaseIdentifierStored: Boolean(config.databaseIdentifierEncrypted),
    encryptionReady: integrationEncryptionConfigured(),
    authenticated: config.authenticated === true, databaseReadable: config.databaseReadable === true,
    checkedAt: row?.lastHealthAt?.toISOString() ?? null, failureCode: row?.failureCode ?? null,
    databases: (config.databases ?? []).map(d => ({ key: d.key, label: d.label })),
    discoveryAvailable: config.discoveryAvailable === true, propertyCount: config.propertyCount ?? null,
    postingEnabled: false,
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
    const selected = parsed.databaseKey ? previous.databases?.find(d => d.key === parsed.databaseKey) : undefined;
    if (parsed.databaseKey && (!selected || parsed.login || parsed.databaseIdentifier)) throw new Error("MRI_DATABASE_SELECTION");
    const databaseLabel = selected?.label ?? parsed.databaseLabel;
    const changedTarget = old && (previous.databaseLabel !== databaseLabel || previous.environment !== parsed.environment);
    // Never retain the former database identifier when changing the target.
    const databaseIdentifierEncrypted = selected ? selected.identifierEncrypted : parsed.databaseIdentifier
      ? encryptIntegrationSecret(parsed.databaseIdentifier)
      : changedTarget ? undefined : previous.databaseIdentifierEncrypted;
    const config = {
      version: 1, databaseLabel, environment: parsed.environment,
      loginEncrypted: parsed.login ? encryptIntegrationSecret(parsed.login) : previous.loginEncrypted,
      passwordEncrypted: parsed.password ? encryptIntegrationSecret(parsed.password) : previous.passwordEncrypted,
      databaseIdentifierEncrypted,
      authenticated: false, databaseReadable: false,
    };
    if (!config.loginEncrypted || !config.passwordEncrypted) throw new Error("MRI_CREDENTIALS");
    const data = { config: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue, status: "CONFIGURED" as const, lastSuccessAt: null, lastHealthAt: null, failureCode: "MRI_CHECK_REQUIRED", failureMessage: "Run the read-only API connection check." };
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

export async function checkMriConnection(scope: RequestScope, revision: string, fetcher: typeof fetch = fetch, lane: Lane = "primary") {
  orgScope(scope);
  const initial = await connection(db, scope.organisationId, lane);
  if (!initial || initial.updatedAt.toISOString() !== revision) throw new Error("MRI_CHANGED");
  const config = stored(initial.config);
  if (!config.loginEncrypted || !config.passwordEncrypted) throw new Error("MRI_CREDENTIALS");
  const primary = lane === "sandbox" ? await connection(db, scope.organisationId) : null;
  if (lane === "sandbox") {
    if (config.environment !== "test" || config.databaseLabel !== MRI_SANDBOX_DATABASE || !config.databaseIdentifierEncrypted) throw new Error("MRI_SANDBOX_TARGET");
    if (primary && stored(primary.config).databaseIdentifierEncrypted && decryptIntegrationSecret(stored(primary.config).databaseIdentifierEncrypted!) === decryptIntegrationSecret(config.databaseIdentifierEncrypted)) throw new Error("MRI_SANDBOX_SHARED_TARGET");
  }
  let result: Awaited<ReturnType<typeof verifyMriAccess>> | null = null, code: string | null = null;
  try {
    result = await verifyMriAccess({ login: decryptIntegrationSecret(config.loginEncrypted), password: decryptIntegrationSecret(config.passwordEncrypted), databaseIdentifier: config.databaseIdentifierEncrypted ? decryptIntegrationSecret(config.databaseIdentifierEncrypted) : undefined, ...(lane === "sandbox" ? { expectedDatabaseLabel: MRI_SANDBOX_DATABASE } : {}) }, fetcher);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    code = ["MRI_AUTH_REJECTED", "MRI_NETWORK", "MRI_RESPONSE_INVALID", "MRI_PROVIDER_UNAVAILABLE", "MRI_SANDBOX_TARGET"].includes(message) ? message : "MRI_CREDENTIALS_UNREADABLE";
  }
  await db.$transaction(async tx => {
    const current = await connection(tx, scope.organisationId, lane);
    if (!current || current.updatedAt.toISOString() !== revision) throw new Error("MRI_CHANGED");
    if (lane === "sandbox") {
      const currentPrimary = await connection(tx, scope.organisationId);
      if ((currentPrimary?.updatedAt.toISOString() ?? null) !== (primary?.updatedAt.toISOString() ?? null)) throw new Error("MRI_CHANGED");
    }
    const checkedAt = new Date(), updatedAt = new Date(Math.max(checkedAt.getTime(), current.updatedAt.getTime() + 1));
    const checked = { ...config, authenticated: result?.authenticated ?? false, databaseReadable: result?.databaseReadable ?? false, discoveryAvailable: result?.discoveryAvailable ?? false, propertyCount: result?.propertyCount ?? null,
      databases: (result?.databases ?? []).map(d => ({ key: randomUUID(), label: d.DatabaseName, identifierEncrypted: encryptIntegrationSecret(d.DatabaseIdentifier) })),
    };
    await tx.integrationConnection.update({ where: { id: current.id }, data: {
      config: checked as Prisma.InputJsonValue, updatedAt, status: code ? "DEGRADED" : "CONFIGURED",
      lastHealthAt: checkedAt, lastSuccessAt: result ? checkedAt : null,
      ...(code ? { lastFailureAt: checkedAt, consecutiveFailures: { increment: 1 } } : { consecutiveFailures: 0 }),
      failureCode: code ?? (result?.databaseReadable ? "MRI_JOURNAL_NOT_ENABLED" : "MRI_DATABASE_REQUIRED"), failureMessage: null,
    } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "integration.mri.connection.checked", entityType: "IntegrationConnection", entityId: current.id,
      after: { authenticated: checked.authenticated, databaseReadable: checked.databaseReadable, failureCode: code, sandbox: lane === "sandbox", postingEnabled: false },
    } });
  }, { isolationLevel: "Serializable" });
  return mriConfiguration(scope, lane);
}

export async function mriSandboxWorkspace(scope: RequestScope) {
  orgScope(scope);
  const [primary, sandbox, configuration] = await Promise.all([connection(db, scope.organisationId), connection(db, scope.organisationId, "sandbox"), mriConfiguration(scope, "sandbox")]);
  const config = primary ? stored(primary.config) : null;
  const target = sandbox ? stored(sandbox.config) : null;
  const shared = Boolean(config?.databaseIdentifierEncrypted && target?.databaseIdentifierEncrypted && decryptIntegrationSecret(config.databaseIdentifierEncrypted) === decryptIntegrationSecret(target.databaseIdentifierEncrypted));
  // Old check evidence cannot advertise safe isolation after primary settings
  // have been changed to the sandbox target.
  if (shared) { configuration.authenticated = false; configuration.databaseReadable = false; configuration.failureCode = "MRI_SANDBOX_SHARED_TARGET"; }
  return { configuration, sourceRevision: primary?.updatedAt.toISOString() ?? null,
    storedTestAvailable: Boolean(config?.loginEncrypted && config.passwordEncrypted && config.databases?.filter(d => d.label === MRI_SANDBOX_DATABASE).length === 1),
    target: MRI_SANDBOX_DATABASE, postingEnabled: false };
}

/** Separate encrypted sandbox configuration: primary target remains unchanged. */
export async function prepareStoredMriSandbox(scope: RequestScope, input: unknown) {
  orgScope(scope);
  const command = z.object({ sourceRevision: z.string().datetime(), revision: z.string().datetime().nullable() }).strict().parse(input);
  if (!integrationEncryptionConfigured()) throw new Error("MRI_ENCRYPTION");
  await db.$transaction(async tx => {
    const primary = await connection(tx, scope.organisationId), old = await connection(tx, scope.organisationId, "sandbox");
    if (old) stored(old.config);
    if (!primary || primary.updatedAt.toISOString() !== command.sourceRevision || (old?.updatedAt.toISOString() ?? null) !== command.revision) throw new Error("MRI_CHANGED");
    const source = stored(primary.config), matches = source.databases?.filter(d => d.label === MRI_SANDBOX_DATABASE) ?? [];
    if (!source.loginEncrypted || !source.passwordEncrypted || matches.length !== 1) throw new Error("MRI_SANDBOX_UNAVAILABLE");
    const identifier = decryptIntegrationSecret(matches[0].identifierEncrypted);
    if (source.databaseIdentifierEncrypted && identifier === decryptIntegrationSecret(source.databaseIdentifierEncrypted)) throw new Error("MRI_SANDBOX_SHARED_TARGET");
    // Re-encrypt rather than sharing the source secret envelope or opaque keys.
    const config = { version: 1, environment: "test", databaseLabel: MRI_SANDBOX_DATABASE, loginEncrypted: encryptIntegrationSecret(decryptIntegrationSecret(source.loginEncrypted)), passwordEncrypted: encryptIntegrationSecret(decryptIntegrationSecret(source.passwordEncrypted)), databaseIdentifierEncrypted: encryptIntegrationSecret(identifier), authenticated: false, databaseReadable: false };
    const data = { config, status: "CONFIGURED" as const, lastSuccessAt: null, lastHealthAt: null, failureCode: "MRI_CHECK_REQUIRED", failureMessage: null };
    const saved = old ? await tx.integrationConnection.update({ where: { id: old.id }, data: { ...data, updatedAt: new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1)) } }) : await tx.integrationConnection.create({ data: { ...where(scope.organisationId, "sandbox"), id: `mri-sandbox:${scope.organisationId}`, ...data } });
    await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "integration.mri.sandbox.prepared", entityType: "IntegrationConnection", entityId: saved.id, after: { target: MRI_SANDBOX_DATABASE, environment: "test", credentialsStored: true, authenticated: false, postingEnabled: false } } });
  }, { isolationLevel: "Serializable" });
  return mriSandboxWorkspace(scope);
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
