import { createHash, createHmac, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import type { TLSSocket } from "node:tls";

import type { ProviderResult } from "@/lib/integrations/providers";

type FetchLike = typeof fetch;
type FacilityAccessConfig = { organisationIndexCode: string; doorIndexCodes: string[] };
type HikCentralJsonResponse = { code?: string | number; msg?: string; data?: unknown };

export type HikCentralProviderConfiguration = {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  userId?: string;
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
  userId?: string;
}) {
  const contentType = "application/json";
  const accept = "*/*";
  const contentMd5 = createHash("md5").update(input.body).digest("base64");
  const signedHeaders = `${input.userId ? `userid:${input.userId}\n` : ""}x-ca-key:${input.appKey}\nx-ca-nonce:${input.nonce}\nx-ca-timestamp:${input.timestamp}\n`;
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

    // Exact certificate pin is checked before req.end; wrong-pin/no-request regression: tests/hikcentral-tls.test.ts.
    const req = httpsRequest(
      { // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
        hostname: target.hostname,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        agent: false,
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("error", reject);
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) { req.destroy(new Error("HikCentral response exceeded its limit.")); return; }
          chunks.push(chunk);
        });
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
          return;
        }
        req.end(body);
      });
    });

    req.on("timeout", () => req.destroy(new Error("HikCentral request timed out.")));
    req.on("error", (error) => reject(error instanceof Error ? error : new Error("HikCentral request failed.")));
    const deadline = setTimeout(() => req.destroy(new Error("HikCentral request timed out.")), 30_000);
    req.on("close", () => clearTimeout(deadline));
  });
}

async function boundedProviderJson(response: Response): Promise<HikCentralJsonResponse> {
  if (!response.body) throw new Error("HikCentral returned an empty response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > 1024 * 1024) { await reader.cancel(); throw new Error("HikCentral response exceeded its limit."); }
    chunks.push(next.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as HikCentralJsonResponse; }
  catch { throw new Error("HikCentral returned an invalid response."); }
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
    const userId = this.configuration?.userId;
    if (path !== "/artemis/api/resource/v1/acsDoor/acsDoorList" && !userId) throw new Error("CONFIG_REQUIRED:HIKCENTRAL_USER_ID");
    const { contentMd5, signature } = hikCentralSignature({ method: "POST", path, body, appKey, appSecret, timestamp, nonce, userId });
    const headers = {
      Accept: "*/*",
      "Content-Type": "application/json",
      "Content-MD5": contentMd5,
      "X-Ca-Key": appKey,
      "X-Ca-Nonce": nonce,
      "X-Ca-Timestamp": timestamp,
      "X-Ca-Signature-Headers": "x-ca-key,x-ca-nonce,x-ca-timestamp",
      "X-Ca-Signature": signature,
      ...(userId ? { userId, "X-Ca-Signature-Headers": "userid,x-ca-key,x-ca-nonce,x-ca-timestamp" } : {}),
    };

    const pinnedFingerprint = this.configuration?.pinnedCertSha256?.trim();
    const { status, ok, json } = pinnedFingerprint
      ? await pinnedHttpsPost(`${baseUrl}${path}`, body, headers, pinnedFingerprint)
      : await this.request(`${baseUrl}${path}`, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(30_000) }).then(async (response) => ({
          status: response.status,
          ok: response.ok,
          json: await boundedProviderJson(response),
        }));

    if (ok && ["/person/personId/personInfo", "/person/personCode/personInfo"].some(suffix => path.endsWith(suffix)) && String(json.code) === "1001" && /not found/i.test(json.msg ?? "")) throw new Error("HIKCENTRAL_PERSON_NOT_FOUND");
    if (!ok || String(json.code) !== "0") throw new Error(`HikCentral request was not confirmed (HTTP ${status}).`);
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

  async listDoors(): Promise<ProviderResult<{ doors: { indexCode: string; name: string }[] }>> {
    try {
      const doors: { indexCode: string; name: string }[] = [];
      for (let pageNo = 1; pageNo <= 50; pageNo++) {
        const data = await this.post("/artemis/api/resource/v1/acsDoor/acsDoorList", { pageNo, pageSize: 100 }) as { list?: unknown };
        if (!Array.isArray(data.list)) throw new Error("HikCentral returned an invalid door list.");
        for (const item of data.list) {
          if (!item || typeof item !== "object") throw new Error("HikCentral returned an invalid door.");
          const door = item as Record<string, unknown>;
          if (typeof door.doorIndexCode !== "string" || !door.doorIndexCode || typeof door.doorName !== "string" || !door.doorName) continue;
          doors.push({ indexCode: door.doorIndexCode, name: door.doorName });
        }
        if (data.list.length < 100) {
          if (!doors.length) throw new Error("HikCentral returned no doors with both a name and index code.");
          return { ok: true, providerReference: "hikcentral", data: { doors } };
        }
      }
      throw new Error("HikCentral door list exceeded 5,000 entries.");
    } catch (error) { return providerFailure(error); }
  }

  async version(): Promise<ProviderResult<{ product: string; version: string }>> {
    try {
      const data = await this.post("/artemis/api/common/v1/version", {}) as Record<string, unknown>;
      if (typeof data.produceName !== "string" || typeof data.softVersion !== "string") throw new Error("HikCentral did not return its software version.");
      return { ok: true, providerReference: "hikcentral", data: { product: data.produceName, version: data.softVersion } };
    } catch (error) { return providerFailure(error); }
  }

  async listAccessLevels(): Promise<ProviderResult<{ levels: { id: string; name: string; resourceIds: string[]; resourceNames: string[] }[] }>> {
    try {
      const levels: { id: string; name: string; resourceIds: string[]; resourceNames: string[] }[] = [];
      for (let pageNo = 1; pageNo <= 50; pageNo++) {
        const data = await this.post("/artemis/api/acs/v1/privilege/group", { pageNo, pageSize: 100, type: 1 }) as { list?: unknown };
        if (!Array.isArray(data.list)) throw new Error("HikCentral returned an invalid access-level list.");
        for (const item of data.list) {
          if (!item || typeof item !== "object") throw new Error("HikCentral returned an invalid access level.");
          const level = item as Record<string, unknown>;
          if (typeof level.privilegeGroupId !== "string" || typeof level.privilegeGroupName !== "string" || !Array.isArray(level.ElementList)) throw new Error("HikCentral returned an access level without its resource list.");
          const resources = level.ElementList.map((entry: unknown) => {
            const element = (entry as { Element?: { ID?: unknown } })?.Element ?? entry as { ID?: unknown };
            if (typeof element?.ID !== "number" && typeof element?.ID !== "string") throw new Error("HikCentral returned an access level without a resource ID.");
            const name = (element as { BaseInfo?: { Name?: unknown } }).BaseInfo?.Name;
            return { id: String(element.ID), name: typeof name === "string" ? name : "" };
          });
          levels.push({ id: level.privilegeGroupId, name: level.privilegeGroupName, resourceIds: resources.map(item => item.id), resourceNames: resources.map(item => item.name) });
        }
        if (data.list.length < 100) return { ok: true, providerReference: "hikcentral", data: { levels } };
      }
      throw new Error("HikCentral access-level list exceeded 5,000 entries.");
    } catch (error) { return providerFailure(error); }
  }

  async listOrganizations(): Promise<ProviderResult<{ organizations: { indexCode: string; name: string; parentIndexCode: string | null }[] }>> {
    try {
      const organizations: { indexCode: string; name: string; parentIndexCode: string | null }[] = [];
      for (let pageNo = 1; pageNo <= 50; pageNo++) {
        const data = await this.post("/artemis/api/resource/v1/org/orgList", { pageNo, pageSize: 100 }) as { list?: unknown };
        if (!Array.isArray(data.list)) throw new Error("HikCentral returned an invalid organization list.");
        for (const item of data.list) {
          if (!item || typeof item !== "object") throw new Error("HikCentral returned an invalid organization.");
          const org = item as Record<string, unknown>;
          if (typeof org.orgIndexCode !== "string" || typeof org.orgName !== "string") throw new Error("HikCentral returned an organization without an ID or name.");
          organizations.push({ indexCode: org.orgIndexCode, name: org.orgName, parentIndexCode: typeof org.parentOrgIndexCode === "string" ? org.parentOrgIndexCode : null });
        }
        if (data.list.length < 100) return { ok: true, providerReference: "hikcentral", data: { organizations } };
      }
      throw new Error("HikCentral organization list exceeded 5,000 entries.");
    } catch (error) { return providerFailure(error); }
  }

  async personByCode(personCode: string): Promise<ProviderResult<{ personId: string; personCode: string; organisationIndexCode: string; givenName: string; familyName: string }>> {
    try {
      const data = await this.post("/artemis/api/resource/v1/person/personCode/personInfo", { personCode }) as Record<string, unknown>;
      if (typeof data.personId !== "string" || data.personCode !== personCode || typeof data.orgIndexCode !== "string") throw new Error("HikCentral returned an unexpected person identity.");
      return { ok: true, providerReference: data.personId, data: { personId: data.personId, personCode, organisationIndexCode: data.orgIndexCode, givenName: typeof data.personGivenName === "string" ? data.personGivenName : "", familyName: typeof data.personFamilyName === "string" ? data.personFamilyName : "" } };
    } catch (error) { return error instanceof Error && error.message === "HIKCENTRAL_PERSON_NOT_FOUND" ? { ok: false, retryable: false, code: error.message, message: "HikCentral person was not found." } : providerFailure(error); }
  }

  async personById(personId: string): Promise<ProviderResult<{ personId: string; personCode: string; givenName: string; familyName: string }>> {
    try {
      if (!personId || personId.length > 64) throw new Error("HikCentral person ID is invalid.");
      const data = await this.post("/artemis/api/resource/v1/person/personId/personInfo", { personId }) as Record<string, unknown>;
      if (data.personId !== personId || typeof data.personCode !== "string") throw new Error("HikCentral returned a different person.");
      return { ok: true, providerReference: personId, data: { personId, personCode: data.personCode, givenName: typeof data.personGivenName === "string" ? data.personGivenName : "", familyName: typeof data.personFamilyName === "string" ? data.personFamilyName : "" } };
    } catch (error) { return error instanceof Error && error.message === "HIKCENTRAL_PERSON_NOT_FOUND" ? { ok: false, retryable: false, code: error.message, message: "HikCentral person was not found." } : providerFailure(error); }
  }

  async peopleByName(name: string): Promise<ProviderResult<{ people: { personId: string; givenName: string; familyName: string }[] }>> {
    try {
      if (!name.trim() || name.length > 32) throw new Error("HikCentral person search name is invalid.");
      const people: { personId: string; givenName: string; familyName: string }[] = [];
      for (let pageNo = 1; pageNo <= 50; pageNo++) {
        const data = await this.post("/artemis/api/resource/v1/person/advance/personList", { pageNo, pageSize: 100, personName: name }) as { list?: unknown; total?: unknown };
        if (!Array.isArray(data.list) || typeof data.total !== "number") throw new Error("HikCentral returned an invalid person search.");
        for (const item of data.list) {
          if (!item || typeof item !== "object") throw new Error("HikCentral returned an invalid person.");
          const person = item as Record<string, unknown>;
          if (typeof person.personId !== "string" || typeof person.personGivenName !== "string" || typeof person.personFamilyName !== "string") throw new Error("HikCentral returned incomplete person names.");
          people.push({ personId: person.personId, givenName: person.personGivenName, familyName: person.personFamilyName });
        }
        if (people.length >= data.total || data.list.length < 100) return { ok: true, providerReference: "hikcentral", data: { people } };
      }
      throw new Error("HikCentral person search exceeded 5,000 entries.");
    } catch (error) { return providerFailure(error); }
  }

  async createPersonWithFace(input: Pick<HikCentralEnrollmentInput, "personCode" | "givenName" | "familyName" | "faceBase64"> & { organisationIndexCode: string }): Promise<ProviderResult<{ personId: string }>> {
    try {
      if (!/^[A-Za-z0-9]{1,16}$/.test(input.personCode) || !input.faceBase64 || !input.organisationIndexCode) throw new Error("HikCentral person code, department or face is invalid.");
      const data = await this.post("/artemis/api/resource/v1/person/single/add", {
        personCode: input.personCode, personGivenName: input.givenName, personFamilyName: input.familyName,
        orgIndexCode: input.organisationIndexCode, faces: [{ faceData: input.faceBase64 }],
      });
      if (typeof data !== "string" || !data) throw new Error("HikCentral did not return its new person ID.");
      return { ok: true, providerReference: data, data: { personId: data } };
    } catch (error) { return providerFailure(error); }
  }

  async updatePersonFace(personId: string, faceBase64: string): Promise<ProviderResult<{ accepted: true }>> {
    try {
      if (!personId || personId.length > 100 || !faceBase64 || faceBase64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(faceBase64) || Buffer.from(faceBase64, "base64").length > 5 * 1024 * 1024) throw new Error("HikCentral person or face is invalid.");
      await this.post("/artemis/api/resource/v1/person/face/update", { personId, faceData: faceBase64 });
      return { ok: true, providerReference: personId, data: { accepted: true } };
    } catch (error) { return providerFailure(error); }
  }

  async addPersonToAccessLevel(privilegeGroupId: string, personId: string): Promise<ProviderResult<{ accepted: true }>> {
    try {
      await this.post("/artemis/api/acs/v1/privilege/group/single/addPersons", { privilegeGroupId, type: 1, list: [{ id: personId }] });
      return { ok: true, providerReference: privilegeGroupId, data: { accepted: true } };
    } catch (error) { return providerFailure(error); }
  }

  async removePersonFromAccessLevel(privilegeGroupId: string, personId: string): Promise<ProviderResult<{ accepted: true }>> {
    try {
      if (!privilegeGroupId || !personId || privilegeGroupId.length > 64 || personId.length > 64) throw new Error("HikCentral access level or person is invalid.");
      await this.post("/artemis/api/acs/v1/privilege/group/single/deletePersons", { privilegeGroupId, type: 1, list: [{ id: personId }] });
      return { ok: true, providerReference: privilegeGroupId, data: { accepted: true } };
    } catch (error) { return providerFailure(error); }
  }

  async accessLevelHasPerson(privilegeGroupId: string, personId: string): Promise<ProviderResult<{ member: boolean }>> {
    try {
      for (let pageNo = 1; pageNo <= 50; pageNo++) {
        const data = await this.post("/artemis/api/acs/v1/privilege/group/single/personList", { privilegeGroupId, type: 1, pageNo, pageSize: 100 }) as { list?: unknown };
        if (!Array.isArray(data.list)) throw new Error("HikCentral returned an invalid access-level person list.");
        if (data.list.some((item) => item && typeof item === "object" && (item as { id?: unknown }).id === personId)) return { ok: true, providerReference: privilegeGroupId, data: { member: true } };
        if (data.list.length < 100) return { ok: true, providerReference: privilegeGroupId, data: { member: false } };
      }
      throw new Error("HikCentral access-level person list exceeded 5,000 entries.");
    } catch (error) { return providerFailure(error); }
  }

  async enroll(input: HikCentralEnrollmentInput): Promise<ProviderResult<{ personId: string; personCode: string }>> {
    void input;
    // shortcut: the old three-call contract is unverified; replace only with a staged consumer and provider readback.
    return { ok: false, retryable: false, code: "UNVERIFIED_PROVIDER_CONTRACT", message: "Facial enrolment requires the staged HikCentral integration." };
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
