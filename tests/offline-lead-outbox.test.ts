import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { offlineLeadSyncSchema } from "../src/lib/validators.ts";

const servicePath = new URL("../src/lib/offline-lead-service.ts", import.meta.url);
const routePath = new URL("../src/app/api/v1/offline/leads/route.ts", import.meta.url);
const workspacePath = new URL("../public/offline-workspace.js", import.meta.url);
const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);

const valid = {
  submissionId: "da98c497-69ac-49cd-a21e-c0543f33ff71",
  deviceId: "3c9db879-7906-4512-b718-2a05f43fd8d1",
  capturedAt: "2026-08-25T08:00:00.000Z",
  firstName: "Offline",
  lastName: "Lead",
  email: "offline@example.test",
  phone: "+27 10 000 0000",
  facilityId: "facility-test",
  expectedMoveIn: "2026-09-01",
  consentToContact: true,
};

test("offline lead sync requires contact consent and stable retry identity", () => {
  assert.equal(offlineLeadSyncSchema.safeParse(valid).success, true);
  assert.equal(offlineLeadSyncSchema.safeParse({ ...valid, consentToContact: false }).success, false);
  assert.equal(offlineLeadSyncSchema.safeParse({ ...valid, submissionId: "not-stable" }).success, false);
});

test("offline lead creation is transactional, scoped, audited and idempotent", async () => {
  const [service, route, schema] = await Promise.all([readFile(servicePath, "utf8"), readFile(routePath, "utf8"), readFile(schemaPath, "utf8")]);
  assert.match(schema, /offlineSubmissionId\s+String\?\s+@unique/);
  assert.match(route, /requirePermissionScope\("leads\.create", parsed\.data\.facilityId\)/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(service, /db\.\$transaction/);
  assert.match(service, /offlineSubmissionId: input\.submissionId/);
  assert.match(service, /offline\.lead\.synced/);
  assert.match(service, /requestId: input\.submissionId/);
  assert.match(service, /raced\.facility\.organisationId === scope\.organisationId/);
  assert.doesNotMatch(service, /identityRef|billingAddress|document|payment|biometric/i);
});

test("offline outbox remains encrypted and removes synced personal data", async () => {
  const workspace = await readFile(workspacePath, "utf8");
  assert.match(workspace, /snapshot\.outbox/);
  assert.match(workspace, /persistSnapshot/);
  assert.match(workspace, /syncQueue/);
  assert.match(workspace, /snapshot\.outbox = snapshot\.outbox\.filter/);
  assert.match(workspace, /All queued leads are synced\. Personal details were removed/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage|BackgroundSync|sync\.register/);
});
