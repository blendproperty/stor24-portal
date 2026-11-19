import assert from "node:assert/strict";
import test from "node:test";

import { HikCentralAccessProvider, hikCentralSignature } from "../src/lib/integrations/hikcentral-provider";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "../src/lib/integrations/integration-secret-vault";
import { MAX_FACE_IMAGE_BYTES, validateFaceImage } from "../src/lib/biometric-access-service";

test("HikCentral request signing is deterministic and request-specific", () => {
  const common = { method: "POST", path: "/artemis/api/resource/v1/person/single/add", appKey: "key", appSecret: "secret", timestamp: "1700000000000", nonce: "nonce" };
  const first = hikCentralSignature({ ...common, body: '{"personCode":"ST24-1"}' });
  const repeated = hikCentralSignature({ ...common, body: '{"personCode":"ST24-1"}' });
  const changed = hikCentralSignature({ ...common, body: '{"personCode":"ST24-2"}' });
  assert.deepEqual(first, repeated);
  assert.notEqual(first.signature, changed.signature);
  assert.notEqual(first.contentMd5, changed.contentMd5);
});

test("face upload accepts JPEG and PNG within the privacy boundary", () => {
  assert.doesNotThrow(() => validateFaceImage(new File(["image"], "face.jpg", { type: "image/jpeg" })));
  assert.doesNotThrow(() => validateFaceImage(new File(["image"], "face.png", { type: "image/png" })));
});

test("face upload rejects unsupported types and oversized files", () => {
  assert.throws(() => validateFaceImage(new File(["image"], "face.gif", { type: "image/gif" })), /FACE_IMAGE_TYPE_INVALID/);
  assert.throws(() => validateFaceImage(new File([new Uint8Array(MAX_FACE_IMAGE_BYTES + 1)], "face.jpg", { type: "image/jpeg" })), /FACE_IMAGE_SIZE_INVALID/);
});

test("integration secrets are encrypted with authenticated storage", () => {
  const previous = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "test-key-that-is-at-least-thirty-two-characters";
  try {
    const encrypted = encryptIntegrationSecret("hikcentral-secret");
    assert.notEqual(encrypted, "hikcentral-secret");
    assert.equal(decryptIntegrationSecret(encrypted), "hikcentral-secret");
    const parts = encrypted.split(".");
    const tamperedBytes = Buffer.from(parts[3], "base64url");
    tamperedBytes[0] ^= 0x01;
    parts[3] = tamperedBytes.toString("base64url");
    assert.throws(() => decryptIntegrationSecret(parts.join(".")));
  } finally {
    if (previous === undefined) delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
    else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = previous;
  }
});

test("HikCentral provider uses saved runtime credentials without environment secrets", async () => {
  const calls: Array<{ url: string; headers: Headers; body: string }> = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    return Response.json({ code: "0", data: { list: [] } });
  };
  const provider = new HikCentralAccessProvider(request as typeof fetch, {
    baseUrl: "https://hikcentral.example.test",
    appKey: "saved-key",
    appSecret: "saved-secret",
    facilities: { facility1: { organisationIndexCode: "org-1", doorIndexCodes: ["door-1"] } },
  });
  const result = await provider.health();
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  // Verified against a live HikCentral installation: the region-scoped "advance" search
  // requires real, install-specific region codes with no universal default, so the health
  // check uses the plain (non-"advance") door list endpoint instead, which needs no region
  // scoping at all.
  assert.equal(calls[0].url, "https://hikcentral.example.test/artemis/api/resource/v1/acsDoor/acsDoorList");
  assert.equal(calls[0].headers.get("x-ca-key"), "saved-key");
  assert.ok(calls[0].headers.get("x-ca-signature"));
});

test("HTTP success without an explicit provider success code is not proof", async () => {
  const provider = new HikCentralAccessProvider((async (_url, init) => {
    assert.equal(init?.redirect, "error");
    return Response.json({ data: {} });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "ci", appSecret: "ci", facilities: {} });
  assert.equal((await provider.health()).ok, false);
});

test("door discovery reads the provider IDs for all three Block24 access points", async () => {
  const names = ["Block24 Main Gate_Door_1", "Block24 Entrance_Door_1", "Block24 Exit_Door_1"];
  const provider = new HikCentralAccessProvider((async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { pageNo: 1, pageSize: 100 });
    return Response.json({ code: "0", data: { list: [{ doorName: "unnamed-id" }, ...names.map((doorName, i) => ({ doorName, doorIndexCode: String(1000 + i) }))] } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", facilities: {} });
  const result = await provider.listDoors();
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.doors, names.map((name, i) => ({ name, indexCode: String(1000 + i) })));
});

test("door discovery fails closed when HikCentral omits a door ID", async () => {
  const provider = new HikCentralAccessProvider((async () => Response.json({ code: "0", data: { list: [{ doorName: "Block24 Main Gate_Door_1" }] } })) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", facilities: {} });
  assert.equal((await provider.listDoors()).ok, false);
});

test("access inspection reads the installed version and access-level resources without writing", async () => {
  const calls: string[] = [];
  const provider = new HikCentralAccessProvider((async (url) => {
    calls.push(String(url));
    return Response.json({ code: "0", data: String(url).endsWith("/version")
      ? { produceName: "HikCentral Professional", softVersion: "3.1.1" }
      : { list: [{ privilegeGroupId: "12", privilegeGroupName: "Block24", ElementList: [{ Element: { ID: 101, BaseInfo: { Name: "Block24 Main Gate_Door_1" } } }, { Element: { ID: 102, BaseInfo: { Name: "Block24 Entrance_Door_1" } } }, { Element: { ID: 103, BaseInfo: { Name: "Block24 Exit_Door_1" } } }] }] } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "stor24-api", facilities: {} });
  assert.deepEqual((await provider.version()), { ok: true, providerReference: "hikcentral", data: { product: "HikCentral Professional", version: "3.1.1" } });
  const levels = await provider.listAccessLevels();
  assert.equal(levels.ok, true);
  if (levels.ok) assert.deepEqual(levels.data.levels, [{ id: "12", name: "Block24", resourceIds: ["101", "102", "103"], resourceNames: ["Block24 Main Gate_Door_1", "Block24 Entrance_Door_1", "Block24 Exit_Door_1"] }]);
  assert.deepEqual(calls, ["https://example.invalid/artemis/api/common/v1/version", "https://example.invalid/artemis/api/acs/v1/privilege/group"]);
});

test("department inspection reads provider index codes without making changes", async () => {
  const provider = new HikCentralAccessProvider((async (url, init) => {
    assert.match(String(url), /\/org\/orgList$/);
    assert.deepEqual(JSON.parse(String(init?.body)), { pageNo: 1, pageSize: 100 });
    return Response.json({ code: "0", data: { list: [{ orgIndexCode: "root", orgName: "Root", parentOrgIndexCode: "0" }, { orgIndexCode: "stor24", orgName: "STOR24", parentOrgIndexCode: "root" }] } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "admin", facilities: {} });
  assert.deepEqual(await provider.listOrganizations(), { ok: true, providerReference: "hikcentral", data: { organizations: [{ indexCode: "root", name: "Root", parentIndexCode: "0" }, { indexCode: "stor24", name: "STOR24", parentIndexCode: "root" }] } });
});

test("person and access-level reads require the HikCentral user ID", async () => {
  const provider = new HikCentralAccessProvider((async () => { throw Error("missing user ID sent to provider"); }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", facilities: {} });
  const result = await provider.version();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CONFIG_REQUIRED");
});

test("an ungranted version endpoint does not prevent authorised access-level reads", async () => {
  const calls: string[] = [];
  const provider = new HikCentralAccessProvider((async (url) => {
    calls.push(String(url));
    return Response.json(String(url).endsWith("/version")
      ? { code: "1028", msg: "API not authorised" }
      : { code: "0", data: { list: [{ privilegeGroupId: "12", privilegeGroupName: "Block24", ElementList: [] }] } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "admin", facilities: {} });
  const levels = await provider.listAccessLevels();
  const version = await provider.version();
  assert.equal(levels.ok, true);
  assert.equal(version.ok, false);
  assert.deepEqual(calls.map((url) => url.split("/artemis")[1]), ["/api/acs/v1/privilege/group", "/api/common/v1/version"]);
});

test("HikCentral user ID is included in the signed request headers", async () => {
  let observed = false;
  const provider = new HikCentralAccessProvider((async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("userid"), "stor24-api");
    assert.equal(headers.get("x-ca-signature-headers"), "userid,x-ca-key,x-ca-nonce,x-ca-timestamp");
    observed = true;
    return Response.json({ code: "0", data: { produceName: "HikCentral Professional", softVersion: "3.1.1" } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "stor24-api", facilities: {} });
  assert.equal((await provider.version()).ok, true);
  assert.equal(observed, true);
});

test("unverified legacy person adapter cannot send provider writes", async () => {
  const provider = new HikCentralAccessProvider((async () => { throw Error("unexpected provider write"); }) as typeof fetch);
  assert.equal((await provider.enroll({ facilityId: "f", personCode: "p", givenName: "A", familyName: "B", faceBase64: "AA==", validFrom: new Date() })).ok, false);
});

test("existing revocation caller still receives an explicit provider result", async () => {
  const provider = new HikCentralAccessProvider((async (url) => {
    assert.match(String(url), /auth_config\/delete$/);
    return Response.json({ code: "0", data: {} });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "stor24-api", facilities: { f: { organisationIndexCode: "org", doorIndexCodes: ["1"] } } });
  assert.equal((await provider.revoke({ facilityId: "f", personId: "1150" })).ok, true);
});

test("person creation sends the face with the documented person request and keeps the returned ID", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const provider = new HikCentralAccessProvider((async (url, init) => {
    calls.push({ path: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ code: "0", data: "1150" });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "stor24-api", facilities: { f: { organisationIndexCode: "org", doorIndexCodes: ["1", "2", "3"] } } });
  const result = await provider.createPersonWithFace({ organisationIndexCode: "org", personCode: "S24A1", givenName: "Test", familyName: "Person", faceBase64: "AQID" });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ path: "https://example.invalid/artemis/api/resource/v1/person/single/add", body: { personCode: "S24A1", personGivenName: "Test", personFamilyName: "Person", orgIndexCode: "org", faces: [{ faceData: "AQID" }] } }]);
  if (result.ok) assert.equal(result.data.personId, "1150");
});

test("access-level assignment is separate from person creation and requires membership readback", async () => {
  const paths: string[] = [];
  const provider = new HikCentralAccessProvider((async (url, init) => {
    paths.push(String(url));
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("addPersons")) { assert.deepEqual(body, { privilegeGroupId: "L1", type: 1, list: [{ id: "1150" }] }); return Response.json({ code: "0", data: "" }); }
    assert.deepEqual(body, { privilegeGroupId: "L1", type: 1, pageNo: 1, pageSize: 100 });
    return Response.json({ code: "0", data: { list: [{ id: "1150" }] } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "stor24-api", facilities: {} });
  assert.equal((await provider.addPersonToAccessLevel("L1", "1150")).ok, true);
  assert.deepEqual((await provider.accessLevelHasPerson("L1", "1150")), { ok: true, providerReference: "L1", data: { member: true } });
  assert.equal(paths.length, 2);
});

test("access-level removal uses the installed deletePersons contract and requires absence readback", async () => {
  const calls: string[] = [];
  const provider = new HikCentralAccessProvider((async (url, init) => {
    calls.push(String(url));
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("deletePersons")) { assert.deepEqual(body, { privilegeGroupId: "L1", type: 1, list: [{ id: "1150" }] }); return Response.json({ code: "0", data: "" }); }
    assert.deepEqual(body, { privilegeGroupId: "L1", type: 1, pageNo: 1, pageSize: 100 });
    return Response.json({ code: "0", data: { list: [] } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "stor24-api", facilities: {} });
  assert.equal((await provider.removePersonFromAccessLevel("L1", "1150")).ok, true);
  assert.deepEqual((await provider.accessLevelHasPerson("L1", "1150")), { ok: true, providerReference: "L1", data: { member: false } });
  assert.equal(calls.length, 2);
});

test("an existing person face update targets that person and refuses invalid image data", async () => {
  const calls: unknown[] = [];
  const provider = new HikCentralAccessProvider((async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ code: "0", data: "" });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "stor24-api", facilities: {} });
  assert.equal((await provider.updatePersonFace("1150", "AQID")).ok, true);
  assert.deepEqual(calls, [{ personId: "1150", faceData: "AQID" }]);
  assert.equal((await provider.updatePersonFace("1150", "not an image")).ok, false);
  assert.equal(calls.length, 1);
});

test("face transfer readback confirms the exact person ID without treating a different person as success", async () => {
  const provider = new HikCentralAccessProvider((async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { personId: "1150" });
    return Response.json({ code: "0", data: { personId: "1150", personCode: "5118710783", personGivenName: "Brett", personFamilyName: "Dovey" } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "admin", facilities: {} });
  assert.deepEqual(await provider.personById("1150"), { ok: true, providerReference: "1150", data: { personId: "1150", personCode: "5118710783", givenName: "Brett", familyName: "Dovey" } });
  const wrong = new HikCentralAccessProvider((async () => Response.json({ code: "0", data: { personId: "1151", personCode: "5118710783" } })) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "admin", facilities: {} });
  assert.equal((await wrong.personById("1150")).ok, false);
});

test("deleted person readback is distinct from a provider lookup failure", async () => {
  const configuration = { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "admin", facilities: {} };
  const missing = new HikCentralAccessProvider((async () => Response.json({ code: "1001", msg: "Person not found" })) as typeof fetch, configuration);
  const denied = new HikCentralAccessProvider((async () => Response.json({ code: "1001", msg: "Permission denied" })) as typeof fetch, configuration);
  assert.deepEqual(await missing.personById("1150"), { ok: false, retryable: false, code: "HIKCENTRAL_PERSON_NOT_FOUND", message: "HikCentral person was not found." });
  const deniedResult = await denied.personById("1150");
  assert.equal(deniedResult.ok, false);
  if (!deniedResult.ok) assert.notEqual(deniedResult.code, "HIKCENTRAL_PERSON_NOT_FOUND");
});

test("person name search uses paged read-only provider results to guard duplicate creation", async () => {
  const provider = new HikCentralAccessProvider((async (url, init) => {
    assert.match(String(url), /\/person\/advance\/personList$/);
    assert.deepEqual(JSON.parse(String(init?.body)), { pageNo: 1, pageSize: 100, personName: "Dovey" });
    return Response.json({ code: "0", data: { total: 1, list: [{ personId: "1150", personGivenName: "Brett", personFamilyName: "Dovey" }] } });
  }) as typeof fetch, { baseUrl: "https://example.invalid", appKey: "key", appSecret: "secret", userId: "admin", facilities: {} });
  assert.deepEqual(await provider.peopleByName("Dovey"), { ok: true, providerReference: "hikcentral", data: { people: [{ personId: "1150", givenName: "Brett", familyName: "Dovey" }] } });
});
