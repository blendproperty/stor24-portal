import { createHash, createHmac, randomUUID } from "node:crypto";

import type { ProviderResult } from "@/lib/integrations/providers";

type FetchLike = typeof fetch;
type FacilityAccessConfig = { organisationIndexCode: string; doorIndexCodes: string[] };

export type HikCentralProviderConfiguration = {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  facilities: Record<string, FacilityAccessConfig>;
};

export type HikCentralEnrollmentInput = {
  facilityId: string;
  personCode: string;
  givenName: string;
  familyName: string;
  faceBase64: string;
  validFrom: Date;
  validUntil?: Date;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`CONFIG_REQUIRED:${name}`);
  return value;
}

export function hikCentralSignature(input: {
  method: string;
  path: string;
  body: string;
  appKey: string;
  appSecret: string;
  timestamp: string;
  nonce: string;
}) {
  const contentType = "application/json";
  const accept = "*/*";
  const contentMd5 = createHash("md5").update(input.body).digest("base64");
  const signedHeaders = `x-ca-key:${input.appKey}\nx-ca-nonce:${input.nonce}\nx-ca-timestamp:${input.timestamp}\n`;
  const canonical = `${input.method.toUpperCase()}\n${accept}\n${contentMd5}\n${contentType}\n${signedHeaders}${input.path}`;
  return {
    contentMd5,
    signature: createHmac("sha256", input.appSecret).update(canonical).digest("base64"),
  };
}

function environmentFacilityConfig(facilityId: string): FacilityAccessConfig {
  const raw = required("HIKCENTRAL_FACILITY_CONFIG_JSON");
  const parsed = JSON.parse(raw) as Record<string, FacilityAccessConfig>;
  const config = parsed[facilityId];
  if (!config?.organisationIndexCode || !Array.isArray(config.doorIndexCodes) || !config.doorIndexCodes.length) {
    throw new Error("CONFIG_REQUIRED:HIKCENTRAL_FACILITY_CONFIG_JSON");
  }
  return config;
}

function providerFailure(error: unknown): ProviderResult<never> {
  const message = error instanceof Error ? error.message : "HikCentral request failed.";
  const configuration = message.startsWith("CONFIG_REQUIRED:");
  return { ok: false, retryable: !configuration, code: configuration ? "CONFIG_REQUIRED" : "HIKCENTRAL_ERROR", message };
}

export class HikCentralAccessProvider {
  readonly category = "ACCESS_CONTROL" as const;
  constructor(private readonly request: FetchLike = fetch, private readonly configuration?: HikCentralProviderConfiguration) {}

  private facilityConfig(facilityId: string) {
    if (!this.configuration) return environmentFacilityConfig(facilityId);
    const config = this.configuration.facilities[facilityId];
    if (!config?.organisationIndexCode || !config.doorIndexCodes.length) throw new Error("CONFIG_REQUIRED:HIKCENTRAL_FACILITY_MAPPING");
    return config;
  }

  private async post(path: string, payload: Record<string, unknown>) {
    const baseUrl = (this.configuration?.baseUrl ?? required("HIKCENTRAL_BASE_URL")).replace(/\/$/, "");
    const appKey = this.configuration?.appKey ?? required("HIKCENTRAL_APP_KEY");
    const appSecret = this.configuration?.appSecret ?? required("HIKCENTRAL_APP_SECRET");
    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const { contentMd5, signature } = hikCentralSignature({ method: "POST", path, body, appKey, appSecret, timestamp, nonce });
    const response = await this.request(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "Content-MD5": contentMd5,
        "X-Ca-Key": appKey,
        "X-Ca-Nonce": nonce,
        "X-Ca-Timestamp": timestamp,
        "X-Ca-Signature-Headers": "x-ca-key,x-ca-nonce,x-ca-timestamp",
        "X-Ca-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = await response.json() as { code?: string | number; msg?: string; data?: Record<string, unknown> };
    if (!response.ok || String(json.code ?? "0") !== "0") throw new Error(`HikCentral rejected ${path}: ${json.msg ?? response.status}`);
    return json.data ?? {};
  }

  async health(): Promise<ProviderResult<{ latencyMs: number }>> {
    const started = Date.now();
    try {
      await this.post(process.env.HIKCENTRAL_DOOR_SEARCH_PATH ?? "/artemis/api/resource/v1/acsDoor/advance/acsDoorList", { pageNo: 1, pageSize: 1 });
      return { ok: true, providerReference: "hikcentral", data: { latencyMs: Date.now() - started } };
    } catch (error) { return providerFailure(error); }
  }

  async enroll(input: HikCentralEnrollmentInput): Promise<ProviderResult<{ personId: string; personCode: string }>> {
    try {
      const config = this.facilityConfig(input.facilityId);
      const person = await this.post(process.env.HIKCENTRAL_PERSON_ADD_PATH ?? "/artemis/api/resource/v1/person/single/add", {
        personCode: input.personCode,
        personGivenName: input.givenName,
        personFamilyName: input.familyName,
        orgIndexCode: config.organisationIndexCode,
      });
      const personId = String(person.personId ?? person.indexCode ?? "");
      if (!personId) throw new Error("HikCentral did not return a person identifier.");
      await this.post(process.env.HIKCENTRAL_FACE_ADD_PATH ?? "/artemis/api/resource/v1/face/single/add", { personId, faceData: input.faceBase64 });
      await this.post(process.env.HIKCENTRAL_PERMISSION_ADD_PATH ?? "/artemis/api/acps/v1/auth_config/add", {
        personIds: [personId],
        resourceInfos: config.doorIndexCodes.map((resourceIndexCode) => ({ resourceIndexCode, resourceType: "door" })),
        startTime: input.validFrom.toISOString(),
        endTime: (input.validUntil ?? new Date("2099-12-31T21:59:59.000Z")).toISOString(),
      });
      return { ok: true, providerReference: personId, data: { personId, personCode: input.personCode } };
    } catch (error) { return providerFailure(error); }
  }

  async revoke(input: { facilityId: string; personId: string }): Promise<ProviderResult<{ revoked: true }>> {
    try {
      const config = this.facilityConfig(input.facilityId);
      await this.post(process.env.HIKCENTRAL_PERMISSION_DELETE_PATH ?? "/artemis/api/acps/v1/auth_config/delete", {
        personIds: [input.personId],
        resourceInfos: config.doorIndexCodes.map((resourceIndexCode) => ({ resourceIndexCode, resourceType: "door" })),
      });
      return { ok: true, providerReference: input.personId, data: { revoked: true } };
    } catch (error) { return providerFailure(error); }
  }
}
