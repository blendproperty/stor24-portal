import { createHash, createHmac, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import type { TLSSocket } from "node:tls";

import type { ProviderResult } from "@/lib/integrations/providers";

type FetchLike = typeof fetch;
type FacilityAccessConfig = { organisationIndexCode: string; doorIndexCodes: string[] };
type HikCentralJsonResponse = { code?: string | number; msg?: string; data?: Record<string, unknown> };

export type HikCentralProviderConfiguration = {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  facilities: Record<string, FacilityAccessConfig>;
  /**
   * Optional SHA-256 fingerprint (colon-separated hex, e.g. "AA:BB:...") of the exact
   * TLS certificate presented by `baseUrl`. When set, requests bypass normal certificate
   * chain/hostname validation and instead pin to this specific certificate — used for
   * on-prem HikCentral gateways whose self-signed certificate cannot pass hostname
   * validation (e.g. issued to 127.0.0.1 rather than the gateway's real address). This
   * value is not a secret; it identifies a public certificate, not a credential.
   */
  pinnedCertSha256?: string;
  /**
   * Optional region index code(s) to scope a region-aware Artemis query to. Not used by
   * the health check (see note on `health()` below) — kept here in case a future call
   * genuinely needs region scoping on an installation where regions are meaningfully
   * organised. Not a secret.
   */
  regionIndexCodes?: string[];
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

function normalizeFingerprint(value: string) {
  return value.replace(/:/g, "").toUpperCase();
}

/**
 * Sends a POST request over a manually pinned TLS connection: normal certificate chain
 * and hostname validation is disabled (the gateway's self-signed certificate cannot pass
 * it), and instead the exact SHA-256 fingerprint of the presented certificate is checked
 * against `expectedFingerprint` before the connection is trusted. A mismatch destroys the
 * connection immediately — no request body is ever sent, and no response is ever read.
 */
function pinnedHttpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
  expectedFingerprint: string,
): Promise<{ status: number; ok: boolean; json: HikCentralJsonResponse }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const normalizedExpected = normalizeFingerprint(expectedFingerprint);

    const req = httpsRequest(
      {
        hostname: target.hostname,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            const json = text ? (JSON.parse(text) as HikCentralJsonResponse) : {};
            resolve({ status: response.statusCode ?? 0, ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300, json });
          } catch {
            reject(new Error("HikCentral returned a response that could not be parsed."));
          }
        });
      },
    );

    req.on("socket", (socket) => {
      socket.on("secureConnect", () => {
        const certificate = (socket as TLSSocket).getPeerCertificate();
        const actualFingerprint = certificate?.fingerprint256 ? normalizeFingerprint(certificate.fingerprint256) : "";
        if (!actualFingerprint || actualFingerprint !== normalizedExpected) {
          req.destroy(new Error("HikCentral certificate fingerprint did not match the configured pin; refusing to trust this connection."));
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("HikCentral request timed out.")));
    req.on("error", (error) => reject(error instanceof Error ? error : new Error("HikCentral request failed.")));
    req.write(body);
    req.end();
  });
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
    const headers = {
      Accept: "*/*",
      "Content-Type": "application/json",
      "Content-MD5": contentMd5,
      "X-Ca-Key": appKey,
      "X-Ca-Nonce": nonce,
      "X-Ca-Timestamp": timestamp,
      "X-Ca-Signature-Headers": "x-ca-key,x-ca-nonce,x-ca-timestamp",
      "X-Ca-Signature": signature,
    };

    const pinnedFingerprint = this.configuration?.pinnedCertSha256?.trim();
    const { status, ok, json } = pinnedFingerprint
      ? await pinnedHttpsPost(`${baseUrl}${path}`, body, headers, pinnedFingerprint)
      : await this.request(`${baseUrl}${path}`, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) }).then(async (response) => ({
          status: response.status,
          ok: response.ok,
          json: (await response.json()) as HikCentralJsonResponse,
        }));

    if (!ok || String(json.code ?? "0") !== "0") throw new Error(`HikCentral rejected ${path}: ${json.msg ?? status}`);
    return json.data ?? {};
  }

  /**
   * Verified directly against a live HikCentral Professional installation (not just
   * against the docs): the region-scoped "advance" door search
   * (`/artemis/api/resource/v1/acsDoor/advance/acsDoorList`) requires a `regionIndexCodes`
   * array whose values must be real region codes on that installation — there is no
   * universal "root region" constant that works everywhere (a commonly-cited doc example,
   * "root000000", is only a placeholder and is rejected as an invalid region on at least
   * one real installation). Rather than depend on guessing a region code, the health check
   * uses the plain (non-"advance") door list endpoint instead, which this and other
   * Artemis-compatible installations accept with just `pageNo`/`pageSize` — no region
   * scoping required. This was confirmed with a direct request/response probe against the
   * gateway, not assumed from documentation.
   */
  async health(): Promise<ProviderResult<{ latencyMs: number }>> {
    const started = Date.now();
    try {
      await this.post(process.env.HIKCENTRAL_DOOR_SEARCH_PATH ?? "/artemis/api/resource/v1/acsDoor/acsDoorList", {
        pageNo: 1,
        pageSize: 1,
      });
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
