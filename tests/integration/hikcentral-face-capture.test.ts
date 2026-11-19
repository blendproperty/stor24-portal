import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../../src/lib/db";
import { captureHikCentralFaceHandoff, decideHikCentralFace, hikCentralCustomerCode, hikCentralFaceHandoff, issueHikCentralFaceHandoff, previewHikCentralFace, expireHikCentralFaceCaptures } from "../../src/lib/hikcentral-face-capture";
import { loadHikCentralRuntimeConfiguration, saveHikCentralMapping } from "../../src/lib/integrations/hikcentral-configuration";
import { reconcileDeletedHikCentralPerson } from "../../src/lib/hikcentral-person-link";
import { encryptIntegrationSecret } from "../../src/lib/integrations/integration-secret-vault";
import { approveCustomerFaceAccessRestoration, processHikCentralAccessLocks, reconcileCustomerFaceAccess } from "../../src/lib/hikcentral-customer-access";

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
    await assert.rejects(loadHikCentralRuntimeConfiguration(org.id, facility.id), /CONFIG_REQUIRED:HIKCENTRAL_FACILITY_MAPPING/);
    assert.deepEqual((await loadHikCentralRuntimeConfiguration(org.id)).facilities, {});
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
    assert.ok(new Date(prepared.expiresAt).getTime() - Date.now() > 19 * 60_000);
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

    const newcomer = await db.customer.create({ data: { organisationId: org.id, firstName: "Jane", lastName: "Tester" } });
    const personCode = hikCentralCustomerCode(org.id, newcomer.id);
    assert.match(personCode, /^S24[A-Z0-9]{13}$/);
    let created = false;
    const newPersonCalls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      const path = String(url);
      newPersonCalls.push(path);
      if (path.endsWith("/person/advance/personList")) return Response.json({ code: "0", data: { total: 0, list: [] } });
      if (path.endsWith("/org/orgList")) return Response.json({ code: "0", data: { list: [{ orgIndexCode: "97", orgName: "STOR24", parentOrgIndexCode: "1" }] } });
      if (path.endsWith("/person/personCode/personInfo")) return created
        ? Response.json({ code: "0", data: { personId: "2001", personCode, orgIndexCode: "97", personGivenName: "Jane", personFamilyName: "Tester" } })
        : Response.json({ code: "1001", msg: "Person not found" });
      assert.match(path, /\/person\/single\/add$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.personCode, personCode);
      assert.equal(body.orgIndexCode, "97");
      assert.equal(body.personGivenName, "Jane");
      assert.equal(body.personFamilyName, "Tester");
      assert.ok(Buffer.from(body.faces[0].faceData, "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));
      created = true;
      return Response.json({ code: "0", data: "2001" });
    }) as typeof fetch;
    const newHandoff = await issueHikCentralFaceHandoff(scope, { customerId: newcomer.id, facilityId: facility.id, version: 0 });
    await db.customer.update({ where: { id: newcomer.id }, data: { firstName: "Changed" } });
    await assert.rejects(hikCentralFaceHandoff(newHandoff.token), /PHOTO_CHANGED/);
    await db.customer.update({ where: { id: newcomer.id }, data: { firstName: "Jane" } });
    const newDetails = await hikCentralFaceHandoff(newHandoff.token);
    assert.match(newDetails.notice, /create your person record/);
    await captureHikCentralFaceHandoff(newHandoff.token, { policyHash: newDetails.policyHash, consent: true, image });
    const newPhoto = await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: newcomer.id } });
    assert.equal(newPhoto.personId, null);
    assert.equal(await db.integrationIdentityLink.findUnique({ where: { customerId: newcomer.id } }), null);
    (await previewHikCentralFace(scope, newPhoto.id, newPhoto.version)).fill(0);
    await db.customer.update({ where: { id: newcomer.id }, data: { lastName: "Changed" } });
    await assert.rejects(decideHikCentralFace(scope, newPhoto.id, newPhoto.version, "SEND"), /PHOTO_CHANGED/);
    assert.equal(newPersonCalls.filter(path => path.endsWith("/person/single/add")).length, 0);
    await db.customer.update({ where: { id: newcomer.id }, data: { lastName: "Tester" } });
    assert.deepEqual(await decideHikCentralFace(scope, newPhoto.id, newPhoto.version, "SEND"), { status: "PROVIDER_ACCEPTED" });
    const linked = await db.integrationIdentityLink.findUniqueOrThrow({ where: { customerId: newcomer.id } });
    assert.equal(linked.hikCentralPersonId, "2001");
    assert.equal(linked.status, "ACTIVE");
    const stored = await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: newcomer.id } });
    assert.equal(stored.personId, "2001");
    assert.equal(stored.encryptedImage, null);
    assert.equal(newPersonCalls.filter(path => path.endsWith("/person/single/add")).length, 1);
    assert.equal(newPersonCalls.filter(path => path.includes("/privilege/")).length, 0);

    assert.deepEqual((await reconcileCustomerFaceAccess(scope, newcomer.id, facility.id)).status, "NOT_ELIGIBLE");
    await db.integrationConnection.create({ data: { organisationId: org.id, facilityId: facility.id, category: "ACCESS_CONTROL", provider: "HIKCENTRAL", status: "CONFIGURED", config: { organisationIndexCode: "97", doorIndexCodes: ["1239", "1244", "1249", "701", "702"], accessLevelIds: ["12", "77"], freeEgressConfirmed: true } } });
    const unitType = await db.unitType.create({ data: { facilityId: facility.id, name: "Synthetic unit", features: [] } });
    async function activeUnit(number: string) {
      const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: unitType.id, number, monthlyRate: 100 } });
      const account = await db.account.create({ data: { customerId: newcomer.id, accountNumber: `${key}-${number}` } });
      const tenancy = await db.tenancy.create({ data: { facilityId: facility.id, customerId: newcomer.id, accountId: account.id, status: "ACTIVE", paymentMethod: "EFT", startDate: new Date("2026-11-01"), occupancies: { create: { unitId: unit.id, status: "ACTIVE", startDate: new Date("2026-11-01"), monthlyRate: 100 } } } });
      await db.auditEvent.create({ data: { organisationId: org.id, facilityId: facility.id, actorId: staff.id, action: "tenancy.key_handover_confirmed", entityType: "Tenancy", entityId: tenancy.id } });
      return tenancy;
    }
    const firstTenancy = await activeUnit("one");
    const members = new Set<string>();
    const writes: string[] = [];
    globalThis.fetch = (async (url, init) => {
      const path = String(url), body = JSON.parse(String(init?.body));
      if (path.endsWith("/privilege/group")) return Response.json({ code: "0", data: { list: [
        { privilegeGroupId: "12", privilegeGroupName: "Block24", ElementList: [1239, 1244, 1249].map(ID => ({ Element: { ID } })) },
        { privilegeGroupId: "77", privilegeGroupName: "STOR24 visitor faces", ElementList: [701, 702].map(ID => ({ Element: { ID } })) },
      ] } });
      if (path.endsWith("/person/personId/personInfo")) return Response.json({ code: "0", data: { personId: "2001", personCode, personGivenName: "Jane", personFamilyName: "Tester" } });
      if (path.endsWith("/privilege/group/single/personList")) return Response.json({ code: "0", data: { list: members.has(body.privilegeGroupId) ? [{ id: "2001" }] : [] } });
      if (path.endsWith("/privilege/group/single/addPersons")) { writes.push(`add:${body.privilegeGroupId}`); members.add(body.privilegeGroupId); return Response.json({ code: "0", data: "" }); }
      if (path.endsWith("/privilege/group/single/deletePersons")) { writes.push(`delete:${body.privilegeGroupId}`); members.delete(body.privilegeGroupId); return Response.json({ code: "0", data: "" }); }
      throw Error(`Unexpected HikCentral call ${path}`);
    }) as typeof fetch;
    assert.equal((await reconcileCustomerFaceAccess(scope, newcomer.id, facility.id)).status, "GRANTED");
    assert.deepEqual(writes, ["add:12", "add:77"]);
    await assert.rejects(saveHikCentralMapping(scope, { facilityId: facility.id, organisationIndexCode: "97", doorIndexCodes: ["1239", "1244", "1249", "701", "703"], accessLevelIds: ["12", "77"], freeEgressConfirmed: true }), /HIKCENTRAL_ACTIVE_GRANTS_REVIEW_REQUIRED/);
    assert.equal((await reconcileCustomerFaceAccess(scope, newcomer.id, facility.id)).status, "GRANTED");
    assert.equal(writes.length, 2);
    const secondTenancy = await activeUnit("two");
    await db.tenancy.update({ where: { id: firstTenancy.id }, data: { status: "CLOSED" } });
    assert.equal((await reconcileCustomerFaceAccess(scope, newcomer.id, facility.id)).status, "GRANTED");
    assert.equal(writes.length, 2);
    await db.collectionCase.create({ data: { accountId: secondTenancy.accountId, terms: { dueDays: 0, allocation: "OLDEST_DUE_FIRST", approvalReference: "Synthetic approved terms", overrides: [] } } });
    await db.ledgerEntry.create({ data: { accountId: secondTenancy.accountId, type: "CHARGE", amount: 100, description: "Synthetic rent", effectiveAt: new Date("2026-10-01") } });
    await db.account.update({ where: { id: secondTenancy.accountId }, data: { balance: 100 } });
    assert.equal((await processHikCentralAccessLocks()).locked, 1);
    assert.deepEqual(writes, ["add:12", "add:77", "delete:12", "delete:77"]);
    await assert.rejects(approveCustomerFaceAccessRestoration(scope, newcomer.id, facility.id), /HIKCENTRAL_RESTORATION_NOT_READY/);
    const paid = await db.payment.create({ data: { accountId: secondTenancy.accountId, amount: 100, method: "EFT", status: "SUCCEEDED", idempotencyKey: randomUUID() } });
    await db.ledgerEntry.create({ data: { accountId: secondTenancy.accountId, type: "PAYMENT", amount: 100, description: "Synthetic verified receipt", effectiveAt: new Date(), externalRef: paid.idempotencyKey } });
    await db.auditEvent.create({ data: { organisationId: org.id, facilityId: facility.id, actorId: staff.id, action: "payment.posted", entityType: "Payment", entityId: paid.id } });
    await db.account.update({ where: { id: secondTenancy.accountId }, data: { balance: 0 } });
    assert.equal((await approveCustomerFaceAccessRestoration(scope, newcomer.id, facility.id)).status, "GRANTED");
    assert.deepEqual(writes, ["add:12", "add:77", "delete:12", "delete:77", "add:12", "add:77"]);
    await db.tenancy.update({ where: { id: secondTenancy.id }, data: { status: "CLOSED" } });
    assert.equal((await reconcileCustomerFaceAccess(scope, newcomer.id, facility.id)).status, "REVOKED");
    assert.deepEqual(writes.slice(-2), ["delete:12", "delete:77"]);

    let providerPersonDeleted = false;
    globalThis.fetch = (async (url) => {
      const path = String(url);
      if (path.endsWith("/person/personId/personInfo")) return providerPersonDeleted ? Response.json({ code: "1001", msg: "Person not found" }) : Response.json({ code: "0", data: { personId: "2001", personCode, personGivenName: "Jane", personFamilyName: "Tester" } });
      if (path.endsWith("/person/advance/personList")) return Response.json({ code: "0", data: { total: 0, list: [] } });
      throw Error(`Unexpected provider request: ${path}`);
    }) as typeof fetch;
    await assert.rejects(reconcileDeletedHikCentralPerson(scope, { facilityId: facility.id, customerId: newcomer.id, expectedPersonId: "2001" }), /HIKCENTRAL_PERSON_STILL_EXISTS/);
    providerPersonDeleted = true;
    assert.deepEqual(await reconcileDeletedHikCentralPerson(scope, { facilityId: facility.id, customerId: newcomer.id, expectedPersonId: "2001" }), { customerId: newcomer.id, previousPersonId: "2001", status: "PROVIDER_REMOVED" });
    assert.equal((await db.integrationIdentityLink.findUniqueOrThrow({ where: { customerId: newcomer.id } })).hikCentralPersonId, null);
    assert.equal((await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: newcomer.id } })).status, "PROVIDER_REMOVED");
    assert.equal(await db.hikCentralAccessGrant.count({ where: { customerId: newcomer.id } }), 0);
    assert.ok((await issueHikCentralFaceHandoff(scope, { customerId: newcomer.id, facilityId: facility.id, version: stored.version })).token);

    const possibleDuplicate = await db.customer.create({ data: { organisationId: org.id, firstName: "Bob", lastName: "Tester" } });
    let duplicateWrites = 0;
    globalThis.fetch = (async (url) => {
      const path = String(url);
      if (path.endsWith("/person/advance/personList")) return Response.json({ code: "0", data: { total: 0, list: [] } });
      if (path.endsWith("/org/orgList")) return Response.json({ code: "0", data: { list: [{ orgIndexCode: "97", orgName: "STOR24" }] } });
      if (path.endsWith("/person/single/add")) { duplicateWrites++; return Response.json({ code: "1001", msg: "Person code already exists" }); }
      duplicateWrites++;
      throw Error("A duplicate rejection must never trigger another provider write");
    }) as typeof fetch;
    const duplicateHandoff = await issueHikCentralFaceHandoff(scope, { customerId: possibleDuplicate.id, facilityId: facility.id, version: 0 });
    const duplicateDetails = await hikCentralFaceHandoff(duplicateHandoff.token);
    await captureHikCentralFaceHandoff(duplicateHandoff.token, { policyHash: duplicateDetails.policyHash, consent: true, image });
    const duplicatePhoto = await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { customerId: possibleDuplicate.id } });
    (await previewHikCentralFace(scope, duplicatePhoto.id, duplicatePhoto.version)).fill(0);
    assert.deepEqual(await decideHikCentralFace(scope, duplicatePhoto.id, duplicatePhoto.version, "SEND"), { status: "PROVIDER_UNCERTAIN" });
    assert.equal(duplicateWrites, 1);
    assert.equal((await db.hikCentralFaceCapture.findUniqueOrThrow({ where: { id: duplicatePhoto.id } })).status, "PROVIDER_UNCERTAIN");
    assert.equal(await db.integrationIdentityLink.findUnique({ where: { customerId: possibleDuplicate.id } }), null);

    const alreadyAtHikCentral = await db.customer.create({ data: { organisationId: org.id, firstName: "Brett Test", lastName: "Dovey" } });
    globalThis.fetch = (async (url) => {
      assert.match(String(url), /\/person\/advance\/personList$/);
      return Response.json({ code: "0", data: { total: 1, list: [{ personId: "1150", personGivenName: "Brett", personFamilyName: "Dovey" }] } });
    }) as typeof fetch;
    await assert.rejects(issueHikCentralFaceHandoff(scope, { customerId: alreadyAtHikCentral.id, facilityId: facility.id, version: 0 }), /HIKCENTRAL_PERSON_REVIEW_REQUIRED/);
    assert.equal(await db.hikCentralFaceHandoff.count({ where: { customerId: alreadyAtHikCentral.id } }), 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY; else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = previousKey;
    await db.$disconnect();
  }
});
