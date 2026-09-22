import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { boundedIdentityForm, decryptIdentity, encryptIdentity, identityAccessMatches, identityPolicy, identityRequired, newIdentityAccess, normaliseIdentityPage } from "../src/lib/identity-document-security";
test("ID policy is absent by default, strictly validated, and applies only from its approved date", () => {
  delete process.env.IDENTITY_DOCUMENT_POLICIES_JSON;
  assert.equal(identityPolicy("org"), null);
  process.env.IDENTITY_DOCUMENT_POLICIES_JSON = '{"org":{"enabled":false}}';
  assert.throws(() => identityPolicy("org"), /ID_POLICY_UNAVAILABLE/);
  const policy = { enabled: true, fullCopyApproved: true, effectiveFrom: "2026-10-01T00:00:00Z", version: "test", approvalReference: "synthetic", notice: "Synthetic test fixture only, not an approved privacy notice.", acknowledgementLabel: "Synthetic acknowledgement only", retentionHours: 24, acceptedTypes: ["PASSPORT"], alternativeContact: "Training store" };
  process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify({ org: policy });
  assert.equal(identityRequired("org", new Date("2026-09-01")), null);
  assert.ok(identityRequired("org", new Date("2026-10-02")));
  const hash = identityPolicy("org")!.hash;
  process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify({ org: { ...policy, notice: policy.notice + " Changed." } });
  assert.notEqual(identityPolicy("org")!.hash, hash);
  process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify({ org: { ...policy, reservationIds: ["pilot-booking"] } });
  assert.ok(identityRequired("org", new Date("2026-10-02"), "pilot-booking"));
  assert.equal(identityRequired("org", new Date("2026-10-02"), "other-booking"), null);
  assert.equal(identityRequired("org", new Date("2026-10-02")), null);
  assert.equal(identityRequired("other-org", new Date("2026-10-02"), "pilot-booking"), null);
  assert.equal(identityRequired("org", new Date("2026-09-01"), "pilot-booking"), null);
  assert.notEqual(identityPolicy("org")!.hash, hash);
  process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify({ org: { ...policy, reservationIds: [] } });
  assert.throws(() => identityRequired("org", new Date("2026-10-02"), "pilot-booking"), /ID_POLICY_UNAVAILABLE/);
  delete process.env.IDENTITY_DOCUMENT_POLICIES_JSON;
});
test("ID grants expire, are unpredictable, and never accept booking references", () => {
  const grant = newIdentityAccess();
  assert.ok(identityAccessMatches(grant.token, grant.identityAccessHash, grant.identityAccessExpiresAt));
  assert.equal(identityAccessMatches("ST24-20260922-ABC123", grant.identityAccessHash, grant.identityAccessExpiresAt), false);
  assert.equal(identityAccessMatches(newIdentityAccess().token, grant.identityAccessHash, grant.identityAccessExpiresAt), false);
  assert.equal(identityAccessMatches(grant.token, grant.identityAccessHash, new Date(0)), false);
});
test("ID ciphertext authenticates its booking/version and differs from facial storage", () => {
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "synthetic-identity-test-key-not-production";
  const bytes = Buffer.from("synthetic pages only"), encrypted = encryptIdentity(bytes, "booking:1");
  assert.deepEqual(decryptIdentity(encrypted, "booking:1"), bytes);
  assert.throws(() => decryptIdentity(encrypted, "booking:2"));
  assert.throws(() => decryptIdentity(encrypted.slice(0, -4) + "AAAA", "booking:1"));
});
test("ID pages are decoded, bounded and stripped of metadata", async () => {
  const bytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#889988" } }).withMetadata().png().toBuffer();
  const image = await normaliseIdentityPage(new File([bytes], "synthetic.png", { type: "image/png" }));
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.exif, undefined);
  await assert.rejects(normaliseIdentityPage(new File(["not an image"], "fake.jpg", { type: "image/jpeg" })), /ID_INVALID/);
  await assert.rejects(normaliseIdentityPage(new File([bytes], "copy.pdf", { type: "application/pdf" })), /ID_INVALID/);
  const tooSmall = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normaliseIdentityPage(new File([tooSmall], "small.png", { type: "image/png" })), /ID_INVALID/);
});
test("chunked oversized multipart ID uploads are stopped before parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedIdentityForm(new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit)), /ID_INVALID/);
  assert.equal(cancelled, true);
});
