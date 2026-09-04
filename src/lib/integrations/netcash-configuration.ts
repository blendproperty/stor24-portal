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
type AuditPayloadValue = string | number | boolean | null | Array<Record<string, string | boolean>>;
export type NetcashServiceValidation = {
  accountStatus: string;
  services: Array<{ serviceId: "1" | "5" | "14"; status: string }>;
};
export type NetcashValidationDiagnostic = {
  account: { status: string; message: string; valid: boolean };
  services: Array<{ serviceId: "1" | "5" | "14"; label: string; status: string; message: string; valid: boolean }>;
  validServiceCount: number;
  allValid: boolean;
};
const serviceLabels = { "1": "Debit Orders and DebiCheck", "5": "Account Services", "14": "Pay Now" } as const;
const statusMessages: Record<string, string> = {
  "001": "Validated",
  "104": "Account invalid or inactive",
  "105": "Service not active for this account",
  "106": "Service key invalid or inactive",
  "201": "Account temporarily locked",
};
export class NetcashProviderValidationError extends Error {
  validation: NetcashServiceValidation;
  constructor(validation: NetcashServiceValidation) {
    super("NETCASH_KEYS_NOT_VALIDATED");
    this.name = "NetcashProviderValidationError";
    this.validation = validation;
  }
}
export function describeNetcashStatus(status: string) {
  return statusMessages[status] ?? `Netcash status ${status || "unknown"}`;
}
export function summariseNetcashValidation(validation: NetcashServiceValidation): NetcashValidationDiagnostic {
  const services = validation.services.map((item) => ({
    ...item,
    label: serviceLabels[item.serviceId],
    message: describeNetcashStatus(item.status),
    valid: item.status === "001",
  }));
  const validServiceCount = services.filter((item) => item.valid).length;
  return {
    account: {
      status: validation.accountStatus,
      message: describeNetcashStatus(validation.accountStatus),
      valid: validation.accountStatus === "001",
    },
    services,
    validServiceCount,
    allValid: validation.accountStatus === "001" && validServiceCount === 3,
  };
}
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
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:nc="http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS" xmlns:t="http://tempuri.org/">` +
    // NOTE: the WSDL contract name is "INIWS_Partner" (interface prefix "I"), not "NIWS_Partner".
    // The addressing Action must match this exactly or WCF returns an ActionNotSupported /
    // ContractFilter mismatch fault before it even looks at the body.
    //
    // NOTE 2: the wrapper elements (ValidateServiceKey, request) live in the tempuri.org
    // operation namespace ("t:"), but the DATA fields inside `request` belong to the
    // ValidateServiceKeyRequest DataContract, whose namespace is schemas.datacontract.org/...
    // ("nc:") — confirmed by the same namespace appearing on every response under "b:".
    // Sending these fields under "t:" instead of "nc:" doesn't error — WCF's
    // DataContractSerializer silently ignores elements in the wrong namespace, so every
    // field deserialized to null regardless of what was sent, which is why the account
    // always came back as a generic AccountStatus 200 with everything nil.
    `<s:Header><a:Action s:mustUnderstand="1">http://tempuri.org/INIWS_Partner/ValidateServiceKey</a:Action><a:To s:mustUnderstand="1">${NETCASH_PARTNER_ENDPOINT}</a:To></s:Header>` +
    `<s:Body><t:ValidateServiceKey><t:request>` +
    `<nc:MerchantAccount>${escapeXml(input.merchantAccount)}</nc:MerchantAccount>` +
    `<nc:ServiceInfoList>` +
    services.map(([serviceId, serviceKey]) => `<nc:ServiceInfo><nc:ServiceId>${serviceId}</nc:ServiceId><nc:ServiceKey>${escapeXml(serviceKey)}</nc:ServiceKey></nc:ServiceInfo>`).join("") +
    `</nc:ServiceInfoList>` +
    `<nc:SoftwareVendorKey>${NETCASH_SOFTWARE_VENDOR_KEY}</nc:SoftwareVendorKey>` +
    `</t:request></t:ValidateServiceKey></s:Body></s:Envelope>`;
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
    // Surface the actual response so we can see Netcash's real shape instead of guessing blind.
    const snippet = xml.replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(`NETCASH_RESPONSE_INVALID:${snippet}`);
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
      "content-type": 'application/soap+xml; charset=utf-8; action="http://tempuri.org/INIWS_Partner/ValidateServiceKey"',
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
async function recordNetcashAudit(scope: RequestScope, action: string, after: Record<string, AuditPayloadValue>) {
  await db.auditEvent.create({
    data: {
      organisationId: scope.organisationId,
      actorId: scope.userId,
      action,
      entityType: "Integration",
      entityId: "NETCASH",
      after,
    },
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
    const now = new Date();
    const message = error instanceof Error ? error.message : "NETCASH_VALIDATION_FAILED";
    const failureCode = message.split(":")[0];
    if (existing) {
      await db.integrationConnection.update({
        where: { id: existing.id },
        data: {
          status: "DEGRADED",
          lastHealthAt: now,
          lastFailureAt: now,
          consecutiveFailures: { increment: 1 },
          failureCode,
          failureMessage: message.slice(0, 500),
        },
      });
    }
    await recordNetcashAudit(scope, "integration.netcash.validation.failed", {
      environment: "test",
      failureCode,
      failureDetail: message.slice(0, 500),
      result: "provider-or-transport-error",
      credentialsStored: false,
      transactionProcessingEnabled: false,
    });
    throw error;
  }
  const diagnostic = summariseNetcashValidation(validation);
  if (!diagnostic.allValid) {
    const now = new Date();
    const failureMessage = [
      `Account: ${diagnostic.account.status} ${diagnostic.account.message}`,
      ...diagnostic.services.map((item) => `${item.label}: ${item.status} ${item.message}`),
    ].join(" | ");
    if (existing) {
      await db.integrationConnection.update({
        where: { id: existing.id },
        data: {
          status: "DEGRADED",
          lastHealthAt: now,
          lastFailureAt: now,
          consecutiveFailures: { increment: 1 },
          failureCode: "NETCASH_KEYS_NOT_VALIDATED",
          failureMessage,
        },
      });
    }
    await recordNetcashAudit(scope, diagnostic.validServiceCount > 0 ? "integration.netcash.validation.partial" : "integration.netcash.validation.failed", {
      environment: "test",
      accountStatus: diagnostic.account.status,
      accountMessage: diagnostic.account.message,
      services: diagnostic.services.map(({ serviceId, label, status, message, valid }) => ({ serviceId, label, status, message, valid })),
      validServiceCount: diagnostic.validServiceCount,
      credentialsStored: false,
      transactionProcessingEnabled: false,
    });
    throw new NetcashProviderValidationError(validation);
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
  await recordNetcashAudit(scope, "integration.netcash.validation.succeeded", {
    environment: "test",
    accountStatus: diagnostic.account.status,
    accountMessage: diagnostic.account.message,
    services: diagnostic.services.map(({ serviceId, label, status, message, valid }) => ({ serviceId, label, status, message, valid })),
    validServiceCount: diagnostic.validServiceCount,
    credentialsStored: true,
    transactionProcessingEnabled: false,
    connectionId: connection.id,
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
