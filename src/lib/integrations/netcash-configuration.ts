import { z } from "zod";

import { db } from "@/lib/db";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  integrationEncryptionConfigured,
} from "@/lib/integrations/integration-secret-vault";
import type { RequestScope } from "@/lib/scope";

export const NETCASH_CATEGORY = "PAYMENTS";
export const NETCASH_PROVIDER = "NETCASH";
export const NETCASH_PARTNER_ENDPOINT = "https://ws.netcash.co.za/NIWS/niws_partner.svc";
export const NETCASH_SOFTWARE_VENDOR_KEY = "24ade73c-98cf-47b3-99be-cc7b867b3080";

const configurationSchema = z.object({
  merchantAccount: z.string().trim().regex(/^5\d{10}$/, "Enter the 11-digit Netcash test account number beginning with 5."),
  accountServiceKey: z.uuid(),
  debitOrderServiceKey: z.uuid(),
  payNowServiceKey: z.uuid(),
});

type StoredNetcashConfiguration = {
  environment?: unknown;
  merchantAccountEncrypted?: unknown;
  accountServiceKeyEncrypted?: unknown;
  debitOrderServiceKeyEncrypted?: unknown;
  payNowServiceKeyEncrypted?: unknown;
  transactionProcessingEnabled?: unknown;
};

export type NetcashServiceValidation = {
  accountStatus: string;
  services: Array<{ serviceId: "1" | "5" | "14"; status: string }>;
};

const serviceLabels = { "1": "Debit Orders and DebiCheck", "5": "Account Services", "14": "Pay Now" } as const;

function configuredString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

export function buildValidateServiceKeyEnvelope(input: z.infer<typeof configurationSchema>) {
  const services = [
    ["5", input.accountServiceKey],
    ["1", input.debitOrderServiceKey],
    ["14", input.payNowServiceKey],
  ] as const;
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:t="http://tempuri.org/">` +
    `<s:Header><a:Action s:mustUnderstand="1">http://tempuri.org/NIWS_Partner/ValidateServiceKey</a:Action><a:To s:mustUnderstand="1">${NETCASH_PARTNER_ENDPOINT}</a:To></s:Header>` +
    `<s:Body><t:ValidateServiceKey><t:request><t:SoftwareVendorKey>${NETCASH_SOFTWARE_VENDOR_KEY}</t:SoftwareVendorKey>` +
    `<t:MerchantAccount>${escapeXml(input.merchantAccount)}</t:MerchantAccount><t:ServiceInfoList>` +
    services.map(([serviceId, serviceKey]) => `<t:ServiceInfo><t:ServiceId>${serviceId}</t:ServiceId><t:ServiceKey>${escapeXml(serviceKey)}</t:ServiceKey></t:ServiceInfo>`).join("") +
    `</t:ServiceInfoList></t:request></t:ValidateServiceKey></s:Body></s:Envelope>`;
}

function firstTag(xml: string, tag: string) {
  return xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([^<]*)<\\/(?:[\\w-]+:)?${tag}>`, "i"))?.[1]?.trim() ?? "";
}

export function parseValidateServiceKeyResponse(xml: string): NetcashServiceValidation {
  const fault = firstTag(xml, "Text") || firstTag(xml, "faultstring");
  if (fault) throw new Error(`NETCASH_SOAP_FAULT:${fault.slice(0, 300)}`);
  const accountStatus = firstTag(xml, "AccountStatus");
  const serviceBlocks = [...xml.matchAll(/<(?:[\w-]+:)?ServiceInfoResponse(?:Array)?\d*(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?ServiceInfoResponse(?:Array)?\d*>/gi)];
  const services = serviceBlocks.map((match) => ({
    serviceId: firstTag(match[1], "ServiceId") as "1" | "5" | "14",
    status: firstTag(match[1], "ServiceStatus"),
  })).filter((item) => ["1", "5", "14"].includes(item.serviceId) && item.status);
  const returnedIds = new Set(services.map((item) => item.serviceId));
  if (!accountStatus || services.length !== 3 || !["1", "5", "14"].every((serviceId) => returnedIds.has(serviceId as "1" | "5" | "14"))) {
    throw new Error("NETCASH_RESPONSE_INVALID");
  }
  return { accountStatus, services };
}

export async function validateNetcashServiceKeys(
  input: z.infer<typeof configurationSchema>,
  request: typeof fetch = fetch,
) {
  const response = await request(NETCASH_PARTNER_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": 'application/soap+xml; charset=utf-8; action="http://tempuri.org/NIWS_Partner/ValidateServiceKey"',
      accept: "application/soap+xml, text/xml",
    },
    body: buildValidateServiceKeyEnvelope(input),
    signal: AbortSignal.timeout(15_000),
  });
  const xml = await response.text();
  if (!response.ok) throw new Error(`NETCASH_HTTP_${response.status}`);
  return parseValidateServiceKeyResponse(xml);
}

async function netcashConnection(organisationId: string) {
  return db.integrationConnection.findFirst({
    where: { organisationId, facilityId: null, category: NETCASH_CATEGORY, provider: NETCASH_PROVIDER },
  });
}

export async function listNetcashConfiguration(scope: RequestScope) {
  const connection = await netcashConnection(scope.organisationId);
  const stored = (connection?.config ?? {}) as StoredNetcashConfiguration;
  return {
    encryptionReady: integrationEncryptionConfigured(),
    environment: stored.environment === "test" ? "test" : "test",
    merchantAccountConfigured: configuredString(stored.merchantAccountEncrypted),
    accountServiceKeyConfigured: configuredString(stored.accountServiceKeyEncrypted),
    debitOrderServiceKeyConfigured: configuredString(stored.debitOrderServiceKeyEncrypted),
    payNowServiceKeyConfigured: configuredString(stored.payNowServiceKeyEncrypted),
    transactionProcessingEnabled: stored.transactionProcessingEnabled === true,
    status: connection?.status ?? "DISCONNECTED",
    lastHealthAt: connection?.lastHealthAt?.toISOString() ?? null,
    lastSuccessAt: connection?.lastSuccessAt?.toISOString() ?? null,
    failureCode: connection?.failureCode ?? null,
    failureMessage: connection?.failureMessage ?? null,
  };
}

export async function validateAndSaveNetcashConfiguration(scope: RequestScope, input: unknown) {
  if (!integrationEncryptionConfigured()) throw new Error("CONFIG_REQUIRED:INTEGRATION_CONFIG_ENCRYPTION_KEY");
  const parsed = configurationSchema.parse(input);
  const existing = await netcashConnection(scope.organisationId);
  let validation: NetcashServiceValidation;
  try {
    validation = await validateNetcashServiceKeys(parsed);
  } catch (error) {
    if (existing) {
      await db.integrationConnection.update({
        where: { id: existing.id },
        data: {
          status: "DEGRADED",
          lastHealthAt: new Date(),
          lastFailureAt: new Date(),
          consecutiveFailures: { increment: 1 },
          failureCode: error instanceof Error ? error.message.split(":")[0] : "NETCASH_VALIDATION_FAILED",
          failureMessage: "The Netcash test credentials could not be validated.",
        },
      });
    }
    throw error;
  }
  if (validation.accountStatus !== "001" || validation.services.some((item) => item.status !== "001")) {
    const statuses = validation.services.map((item) => `${serviceLabels[item.serviceId]}: ${item.status}`).join(", ");
    throw new Error(`NETCASH_KEYS_NOT_VALIDATED:${validation.accountStatus}:${statuses}`);
  }
  const now = new Date();
  const config = {
    environment: "test",
    merchantAccountEncrypted: encryptIntegrationSecret(parsed.merchantAccount),
    accountServiceKeyEncrypted: encryptIntegrationSecret(parsed.accountServiceKey),
    debitOrderServiceKeyEncrypted: encryptIntegrationSecret(parsed.debitOrderServiceKey),
    payNowServiceKeyEncrypted: encryptIntegrationSecret(parsed.payNowServiceKey),
    transactionProcessingEnabled: false,
  };
  const connection = existing
    ? await db.integrationConnection.update({ where: { id: existing.id }, data: { config, status: "CONNECTED", lastHealthAt: now, lastSuccessAt: now, consecutiveFailures: 0, failureCode: null, failureMessage: null } })
    : await db.integrationConnection.create({ data: { organisationId: scope.organisationId, category: NETCASH_CATEGORY, provider: NETCASH_PROVIDER, config, status: "CONNECTED", lastHealthAt: now, lastSuccessAt: now } });
  await db.auditEvent.create({
    data: {
      organisationId: scope.organisationId,
      actorId: scope.userId,
      action: "integration.netcash.test_credentials.validated",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      after: { environment: "test", accountStatus: validation.accountStatus, services: validation.services, transactionProcessingEnabled: false },
    },
  });
  return validation;
}

export async function loadNetcashTestCredentials(organisationId: string) {
  const connection = await netcashConnection(organisationId);
  const stored = (connection?.config ?? {}) as StoredNetcashConfiguration;
  if (!connection || !configuredString(stored.merchantAccountEncrypted) || !configuredString(stored.accountServiceKeyEncrypted) || !configuredString(stored.debitOrderServiceKeyEncrypted) || !configuredString(stored.payNowServiceKeyEncrypted)) {
    throw new Error("CONFIG_REQUIRED:NETCASH_TEST_CREDENTIALS");
  }
  return {
    merchantAccount: decryptIntegrationSecret(stored.merchantAccountEncrypted),
    accountServiceKey: decryptIntegrationSecret(stored.accountServiceKeyEncrypted),
    debitOrderServiceKey: decryptIntegrationSecret(stored.debitOrderServiceKeyEncrypted),
    payNowServiceKey: decryptIntegrationSecret(stored.payNowServiceKeyEncrypted),
    transactionProcessingEnabled: stored.transactionProcessingEnabled === true,
  };
}
