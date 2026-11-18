import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../../src/lib/db";
import { captureHikCentralFaceHandoff, decideHikCentralFace, hikCentralFaceHandoff, issueHikCentralFaceHandoff, previewHikCentralFace, expireHikCentralFaceCaptures } from "../../src/lib/hikcentral-face-capture";
import { encryptIntegrationSecret } from "../../src/lib/integrations/integration-secret-vault";

test("customer-scoped Counter face capture needs consent and review before one provider update", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const previousKey = process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY, previousFetch = globalThis.fetch;
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "isolated-hikcentral-face-test-encryption-key";
  const key = randomUUID();
  try {
    const org = await db.organisation.create({ data: { name: "Synthetic HikCentral", slug: key } });
    const facility = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic facility", code: key } });
    const staff = await db.user.create({ data: { organisationId: org.id, name: "Synthetic operator", email: `${key}@example.invalid` } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["access.manage", "integrations.manage"] } });
    await db.roleAssignment.create({ data: { userId: staff.id, roleId: role.id } });
    const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Brett", lastName: "Dovey" } });
    await db.integrationIdentityLink.create({ data: { organisationId: org.id, customerId: customer.id, hikCentralPersonId: "1150", status: "ACTIVE", linkedAt: new Date() } });
    await db.facialPhotoControl.create({ data: { organisationId: org.id, controllerUserId: staff.id, enabled: true } });
    await db.facialPhotoMaintenance.upsert({ where: { id: "expiry" }, create: { id: "expiry", completedAt: new Date() }, update: { completedAt: new Date() } });
    const credentials = { endpoint: "https://hikcentral.example.invalid", userId: "admin", appKeyEncrypted: encryptIntegrationSecret("synthetic-key"), appSecretEncrypted: encryptIntegrationSecret("synthetic-secret") };
    await db.integrationConnection.create({ data: { organisationId: org.id, category: "ACCESS_CONTROL", provider: "HIKCENTRAL", status: "CONFIGURED", config: credentials } });
    await db.integrationConnection.create({ data: { organisationId: org.id, facilityId: facility.id, category: "ACCESS_CONTROL", provider: "HIKCENTRAL", status: "CONFIGURED", config: { organisationIndexCode: "synthetic-org", doorIndexCodes: ["synthetic-door"] } } });
    const scope = { organisationId: org.id, userId: staff.id, facilityIds: [], unrestrictedFacilities: true };
    const calls: string[] = [];
    let failNextFaceUpdate = false;
    globalThis.fetch = (async (url, init) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith("/person/personId/personInfo")) {
        assert.deepEqual(JSON.parse(String(init?.body)), { personId: "1150" });
        return Response.json({ code: "0", data: { personId: "1150", personCode: "5118710783", personGivenName: "Brett", personFamilyName: "Dovey" } });
      }
      assert.match(path, /\/person\/face\/update$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.personId, "1150");
      assert.ok(Buffer.from(body.faceData, "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));
      if (failNextFaceUpdate) return Response.json({ code: "1028", msg: "Synthetic uncertain provider result" });
      return Response.json({ code: "0", data: "" });
    }) as typeof fetch;
    const prepared = await issueHikCentralFaceHandoff(scope, { customerId: customer.id, facilityId: facility.id, version: 0 });
    const details = await hikCentralFaceHandoff(prepared.token);
    assert.equal(details.purpose, "hikcentral"); assert.equal(details.unitNumber, "");
    const bytes = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#777777" } }).jpeg().toBuffer();
    const image = new File([new Uint8Array(bytes)], "synthetic.jpg", { type: "image/jpeg" });
    await assert.rejects(captureHikCentralFaceHandoff(prepared.token, { policyHash: details.policyHash, consent: false, image }), /PHOTO_CONSENT_REQUIRED/);
    await captureHikCentralFaceHandoff(prepared.token, { policyHash: details.policyHash, consent: true, image });
    await assert.rejects(hikCentralFaceHandoff(prepared.token), /PHOTO_CHANGED/);
    const photo = await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: customer.id } });
    assert.equal(photo.status, "WAITING_REVIEW"); assert.ok(photo.encryptedImage); assert.ok(!photo.encryptedImage.includes("/9j/"));
    await assert.rejects(decideHikCentralFace(scope, photo.id, photo.version, "SEND"), /PHOTO_PREVIEW_REQUIRED/);
    const preview = await previewHikCentralFace(scope, photo.id, photo.version); assert.ok(preview.length); preview.fill(0);
    assert.deepEqual(await decideHikCentralFace(scope, photo.id, photo.version, "SEND"), { status: "PROVIDER_ACCEPTED" });
    const saved = await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: customer.id } });
    assert.equal(saved.encryptedImage, null); assert.ok(saved.providerAcceptedAt);
    assert.equal(calls.filter(path => path.endsWith("/person/face/update")).length, 1);
    await assert.rejects(decideHikCentralFace(scope, photo.id, photo.version, "SEND"), /PHOTO_CHANGED/);
    const replacement = await issueHikCentralFaceHandoff(scope, { customerId: customer.id, facilityId: facility.id, version: saved.version });
    const replacementDetails = await hikCentralFaceHandoff(replacement.token);
    await captureHikCentralFaceHandoff(replacement.token, { policyHash: replacementDetails.policyHash, consent: true, image });
    const replacementPhoto = await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: customer.id } });
    (await previewHikCentralFace(scope, replacementPhoto.id, replacementPhoto.version)).fill(0);
    failNextFaceUpdate = true;
    assert.deepEqual(await decideHikCentralFace(scope, replacementPhoto.id, replacementPhoto.version, "SEND"), { status: "PROVIDER_UNCERTAIN" });
    assert.equal(calls.filter(path => path.endsWith("/person/face/update")).length, 2);
    assert.ok((await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { id: photo.id } })).encryptedImage);
    await assert.rejects(issueHikCentralFaceHandoff(scope, { customerId: customer.id, facilityId: facility.id, version: replacementPhoto.version }), /PHOTO_CHANGED/);
    await db.hikCentralFaceCapture.update({ where: { id: photo.id }, data: { expiresAt: new Date(0) } });
    await expireHikCentralFaceCaptures();
    assert.equal((await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { id: photo.id } })).encryptedImage, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY; else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = previousKey;
    await db.$disconnect();
  }
});
