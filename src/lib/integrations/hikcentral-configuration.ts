import { z } from "zod";

import { db } from "@/lib/db";
import { HikCentralAccessProvider, type HikCentralProviderConfiguration } from "@/lib/integrations/hikcentral-provider";
import { decryptIntegrationSecret, encryptIntegrationSecret, integrationEncryptionConfigured } from "@/lib/integrations/integration-secret-vault";
import type { RequestScope } from "@/lib/scope";
import { requireFacility } from "@/lib/scope";

export const HIKCENTRAL_CATEGORY = "ACCESS_CONTROL";
export const HIKCENTRAL_PROVIDER = "HIKCENTRAL";

const credentialsSchema = z.object({
  endpoint: z.url().max(500),
  appKey: z.string().trim().min(1).max(500).optional(),
  appSecret: z.string().trim().min(1).max(1000).optional(),
});

const mappingSchema = z.object({
  facilityId: z.string().cuid(),
  organisationIndexCode: z.string().trim().min(1).max(200),
  doorIndexCodes: z.array(z.string().trim().min(1).max(200)).min(1).max(200).transform((items) => [...new Set(items)]),
});

type StoredCredentials = { endpoint?: unknown; appKeyEncrypted?: unknown; appSecretEncrypted?: unknown };
type StoredMapping = { organisationIndexCode?: unknown; doorIndexCodes?: unknown };

function safeEndpoint(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("HIKCENTRAL_ENDPOINT_INVALID");
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"].includes(hostname)) throw new Error("HIKCENTRAL_ENDPOINT_INVALID");
  return url.toString().replace(/\/$/, "");
}

function configuredString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

async function companyConnection(organisationId: string) {
  return db.integrationConnection.findFirst({ where: { organisationId, facilityId: null, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER } });
}

export async function listHikCentralConfiguration(scope: RequestScope) {
  const facilityWhere = scope.unrestrictedFacilities ? {} : { id: { in: scope.facilityIds } };
  const [company, facilities, mappings] = await Promise.all([
    companyConnection(scope.organisationId),
    db.facility.findMany({ where: { organisationId: scope.organisationId, ...facilityWhere }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    db.integrationConnection.findMany({ where: { organisationId: scope.organisationId, facilityId: { not: null }, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER, ...(scope.unrestrictedFacilities ? {} : { facilityId: { in: scope.facilityIds } }) } }),
  ]);
  const credentials = (company?.config ?? {}) as StoredCredentials;
  return {
    encryptionReady: integrationEncryptionConfigured(),
    company: {
      endpoint: configuredString(credentials.endpoint) ? credentials.endpoint : "",
      appKeyConfigured: configuredString(credentials.appKeyEncrypted),
      appSecretConfigured: configuredString(credentials.appSecretEncrypted),
      status: company?.status ?? "DISCONNECTED",
      lastHealthAt: company?.lastHealthAt?.toISOString() ?? null,
      lastSuccessAt: company?.lastSuccessAt?.toISOString() ?? null,
      failureMessage: company?.failureMessage ?? null,
    },
    facilities: facilities.map((facility) => {
      const connection = mappings.find((item) => item.facilityId === facility.id);
      const config = (connection?.config ?? {}) as StoredMapping;
      return {
        ...facility,
        organisationIndexCode: configuredString(config.organisationIndexCode) ? config.organisationIndexCode : "",
        doorIndexCodes: Array.isArray(config.doorIndexCodes) ? config.doorIndexCodes.filter(configuredString) : [],
        status: connection?.status ?? "DISCONNECTED",
        lastHealthAt: connection?.lastHealthAt?.toISOString() ?? null,
        lastSuccessAt: connection?.lastSuccessAt?.toISOString() ?? null,
        failureMessage: connection?.failureMessage ?? null,
      };
    }),
  };
}

export async function saveHikCentralCredentials(scope: RequestScope, input: unknown) {
  if (!integrationEncryptionConfigured()) throw new Error("CONFIG_REQUIRED:INTEGRATION_CONFIG_ENCRYPTION_KEY");
  const parsed = credentialsSchema.parse(input);
  const existing = await companyConnection(scope.organisationId);
  const oldConfig = (existing?.config ?? {}) as StoredCredentials;
  const appKeyEncrypted = parsed.appKey ? encryptIntegrationSecret(parsed.appKey) : oldConfig.appKeyEncrypted;
  const appSecretEncrypted = parsed.appSecret ? encryptIntegrationSecret(parsed.appSecret) : oldConfig.appSecretEncrypted;
  if (!configuredString(appKeyEncrypted) || !configuredString(appSecretEncrypted)) throw new Error("HIKCENTRAL_CREDENTIALS_REQUIRED");
  const endpoint = safeEndpoint(parsed.endpoint);
  const connection = existing
    ? await db.integrationConnection.update({ where: { id: existing.id }, data: { status: "CONFIGURED", config: { endpoint, appKeyEncrypted, appSecretEncrypted }, failureCode: null, failureMessage: null } })
    : await db.integrationConnection.create({ data: { organisationId: scope.organisationId, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER, status: "CONFIGURED", config: { endpoint, appKeyEncrypted, appSecretEncrypted } } });
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "integration.hikcentral.credentials.updated", entityType: "IntegrationConnection", entityId: connection.id, before: existing ? { endpoint: (oldConfig.endpoint as string | undefined) ?? null, credentialsConfigured: true } : undefined, after: { endpoint, credentialsConfigured: true } } });
  return connection;
}

export async function saveHikCentralMapping(scope: RequestScope, input: unknown) {
  const parsed = mappingSchema.parse(input);
  const facility = await requireFacility(scope, parsed.facilityId);
  const existing = await db.integrationConnection.findFirst({ where: { organisationId: scope.organisationId, facilityId: facility.id, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER } });
  const config = { organisationIndexCode: parsed.organisationIndexCode, doorIndexCodes: parsed.doorIndexCodes };
  const connection = existing
    ? await db.integrationConnection.update({ where: { id: existing.id }, data: { status: "CONFIGURED", config, failureCode: null, failureMessage: null } })
    : await db.integrationConnection.create({ data: { organisationId: scope.organisationId, facilityId: facility.id, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER, status: "CONFIGURED", config } });
  const previous = (existing?.config ?? {}) as StoredMapping;
  await db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: facility.id, actorId: scope.userId, action: "integration.hikcentral.mapping.updated", entityType: "IntegrationConnection", entityId: connection.id, before: existing ? { organisationIndexCode: previous.organisationIndexCode ?? null, doorIndexCodes: previous.doorIndexCodes ?? [] } : undefined, after: config } });
  return connection;
}

export async function loadHikCentralRuntimeConfiguration(organisationId: string, facilityId: string): Promise<HikCentralProviderConfiguration> {
  const [company, mapping] = await Promise.all([
    companyConnection(organisationId),
    db.integrationConnection.findFirst({ where: { organisationId, facilityId, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER } }),
  ]);
  const credentials = (company?.config ?? {}) as StoredCredentials;
  const facility = (mapping?.config ?? {}) as StoredMapping;
  if (!configuredString(credentials.endpoint) || !configuredString(credentials.appKeyEncrypted) || !configuredString(credentials.appSecretEncrypted)) throw new Error("CONFIG_REQUIRED:HIKCENTRAL_CREDENTIALS");
  if (!configuredString(facility.organisationIndexCode) || !Array.isArray(facility.doorIndexCodes) || !facility.doorIndexCodes.length) throw new Error("CONFIG_REQUIRED:HIKCENTRAL_FACILITY_MAPPING");
  return {
    baseUrl: credentials.endpoint,
    appKey: decryptIntegrationSecret(credentials.appKeyEncrypted),
    appSecret: decryptIntegrationSecret(credentials.appSecretEncrypted),
    facilities: { [facilityId]: { organisationIndexCode: facility.organisationIndexCode, doorIndexCodes: facility.doorIndexCodes.filter(configuredString) } },
  };
}

export async function testHikCentralConnection(scope: RequestScope, facilityId: string) {
  await requireFacility(scope, facilityId);
  const company = await companyConnection(scope.organisationId);
  const mapping = await db.integrationConnection.findFirst({ where: { organisationId: scope.organisationId, facilityId, category: HIKCENTRAL_CATEGORY, provider: HIKCENTRAL_PROVIDER } });
  if (!company || !mapping) throw new Error("CONFIG_REQUIRED:HIKCENTRAL");
  let result;
  try {
    result = await new HikCentralAccessProvider(fetch, await loadHikCentralRuntimeConfiguration(scope.organisationId, facilityId)).health();
  } catch (error) {
    result = { ok: false as const, code: "CONFIG_REQUIRED", message: error instanceof Error ? error.message : "HikCentral configuration is incomplete." };
  }
  const now = new Date();
  const update = result.ok
    ? { status: "CONNECTED" as const, lastHealthAt: now, lastSuccessAt: now, consecutiveFailures: 0, failureCode: null, failureMessage: null }
    : { status: result.code === "CONFIG_REQUIRED" ? "DISCONNECTED" as const : "DEGRADED" as const, lastHealthAt: now, lastFailureAt: now, consecutiveFailures: { increment: 1 }, failureCode: result.code, failureMessage: result.message.slice(0, 500) };
  await db.$transaction([
    db.integrationConnection.update({ where: { id: company.id }, data: update }),
    db.integrationConnection.update({ where: { id: mapping.id }, data: update }),
    db.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId, actorId: scope.userId, action: result.ok ? "integration.hikcentral.test.succeeded" : "integration.hikcentral.test.failed", entityType: "IntegrationConnection", entityId: mapping.id, after: result.ok ? { latencyMs: result.data.latencyMs } : { code: result.code } } }),
  ]);
  return result;
}
