import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { boundedPhotoForm, decryptPhoto, encryptPhoto, facialPhotoPolicy, MAX_PHOTO_BYTES, normaliseFacialPhoto } from "../src/lib/facial-photo-security";
import { enrollBiometricAccess } from "../src/lib/biometric-access-service";

test("facial photo encryption authenticates the booking and version", () => {
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "isolated-test-key-never-use-in-production";
  const raw = Buffer.from("synthetic bytes"), encrypted = encryptPhoto(raw, "booking-a:v1");
  assert.notEqual(encrypted, encryptPhoto(raw, "booking-a:v1"));
  assert.deepEqual(decryptPhoto(encrypted, "booking-a:v1"), raw);
  assert.throws(() => decryptPhoto(encrypted, "booking-b:v1"));
  assert.throws(() => decryptPhoto(encrypted, "booking-a:v2"));
  const parts = encrypted.split("."), bytes = Buffer.from(parts[3], "base64url"); bytes[0] ^= 1; parts[3] = bytes.toString("base64url");
  assert.throws(() => decryptPhoto(parts.join("."), "booking-a:v1"));
});
test("collection has no assumed consent, approval or retention default", () => {
  delete process.env.FACIAL_ACCESS_POLICIES_JSON;
  assert.equal(facialPhotoPolicy("org"), null);
  process.env.FACIAL_ACCESS_POLICIES_JSON = JSON.stringify({ org: { enabled: true, version: "v1", notice: "Example test notice long enough to demonstrate validation", retentionHours: 24 } });
  assert.equal(facialPhotoPolicy("org"), null);
  process.env.FACIAL_ACCESS_POLICIES_JSON = "invalid";
  assert.equal(facialPhotoPolicy("org"), null);
});
test("image decoding rejects MIME impostors, truncation and excess pixels; strips metadata", async () => {
  const input = await sharp({ create: { width: 220, height: 300, channels: 3, background: "#808080" } }).withExif({ IFD0: { Artist: "PRIVATE EXIF TEST" } }).jpeg().toBuffer();
  const output = await normaliseFacialPhoto(new File([new Uint8Array(input)], "test.jpg", { type: "image/jpeg" }));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.exif, undefined);
  await assert.rejects(normaliseFacialPhoto(new File(["not a photograph"], "face.jpg", { type: "image/jpeg" })), /PHOTO_INVALID/);
  await assert.rejects(normaliseFacialPhoto(new File([new Uint8Array(input.subarray(0, input.length / 2))], "broken.jpg", { type: "image/jpeg" })), /PHOTO_INVALID/);
  const large = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normaliseFacialPhoto(new File([new Uint8Array(large)], "too-many-pixels.png", { type: "image/png" })), /PHOTO_INVALID/);
});
test("chunked multipart upload has a real byte limit", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_PHOTO_BYTES + 32769)); controller.close(); } });
  const request = new Request("https://example.test/upload", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(boundedPhotoForm(request), /PHOTO_INVALID/);
});
test("legacy direct upload cannot bypass customer consent or partial-enrolment safeguards", async () => {
  await assert.rejects(enrollBiometricAccess(), /FACIAL_ACCESS_REQUIRES_REVIEWED_QUEUE/);
});
