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
  assert.equal(calls[0].url, "https://hikcentral.example.test/artemis/api/resource/v1/acsDoor/advance/acsDoorList");
  assert.equal(calls[0].headers.get("x-ca-key"), "saved-key");
  assert.ok(calls[0].headers.get("x-ca-signature"));
});
