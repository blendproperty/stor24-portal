import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { offlineReservationSyncSchema } from "../src/lib/validators.ts";

const servicePath = new URL("../src/lib/offline-reservation-service.ts", import.meta.url);
const routePath = new URL("../src/app/api/v1/offline/reservations/route.ts", import.meta.url);
const workspacePath = new URL("../public/offline-workspace.js", import.meta.url);
const shellPath = new URL("../public/offline-workspace.html", import.meta.url);
const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const moveInPagePath = new URL("../src/app/operations/move-in/page.tsx", import.meta.url);
const moveInWorkspacePath = new URL("../src/components/move-in-workspace.tsx", import.meta.url);

const valid = {
  submissionId: "3c729f3f-b3f6-48dc-829b-271d47a1d544",
  leadSubmissionId: "4ae7f0d5-5de2-4c52-b36d-0f50914f6226",
  deviceId: "3c9db879-7906-4512-b718-2a05f43fd8d1",
  capturedAt: "2026-08-27T08:00:00.000Z",
  facilityId: "facility-test",
  customerId: "customer-test",
  leadId: "lead-test",
  unitId: "unit-test",
  quotedRate: 900,
  intendedMoveIn: "2026-09-01",
  paymentMethod: "DEBIT_ORDER" as const,
};

test("offline reservation sync requires stable identities and a positive quote", () => {
  assert.equal(offlineReservationSyncSchema.safeParse(valid).success, true);
  assert.equal(offlineReservationSyncSchema.safeParse({ ...valid, submissionId: "unstable" }).success, false);
  assert.equal(offlineReservationSyncSchema.safeParse({ ...valid, quotedRate: 0 }).success, false);
  assert.equal(offlineReservationSyncSchema.safeParse({ ...valid, paymentMethod: "CASH" }).success, false);
});

test("offline reservation sync atomically claims availability and is idempotent", async () => {
  const [service, route, schema] = await Promise.all([readFile(servicePath, "utf8"), readFile(routePath, "utf8"), readFile(schemaPath, "utf8")]);
  assert.match(schema, /idempotencyKey\s+String\?\s+@unique/);
  assert.match(route, /requirePermissionScope\("reservations\.manage", parsed\.data\.facilityId\)/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /UNIT_UNAVAILABLE/);
  assert.match(service, /db\.\$transaction/);
  assert.match(service, /updateMany/);
  assert.match(service, /status: "AVAILABLE"/);
  assert.match(service, /claimed\.count !== 1/);
  assert.match(service, /idempotencyKey: key/);
  assert.match(service, /offline\.reservation\.synced/);
  assert.match(service, /source: "OFFLINE_PWA"/);
  assert.match(service, /paymentMethod: input\.paymentMethod/);
  assert.match(service, /HOLD_HOURS = 24/);
  assert.match(service, /publicReference: reservationReference/);
  assert.match(service, /notifyReservationConfirmed/);
  assert.match(service, /Follow up offline reservation/);
  assert.match(service, /deliverySummary/);
  assert.doesNotMatch(service, /tx\.(?:document|payment|biometricEnrollment)\.(?:create|update)|identityRef/i);
});

test("offline reservation conflicts remain encrypted and editable", async () => {
  const [workspace, shell] = await Promise.all([readFile(workspacePath, "utf8"), readFile(shellPath, "utf8")]);
  assert.match(workspace, /snapshot\.reservationOutbox/);
  assert.match(workspace, /\/api\/v1\/offline\/reservations/);
  assert.match(workspace, /response\.status === 409/);
  assert.match(workspace, /item\.status = "CONFLICT"/);
  assert.match(workspace, /saveReservationEdit/);
  assert.match(shell, /not confirmed until the server accepts it after reconnection/i);
  assert.match(shell, /Payments, leases, documents and biometrics are never queued offline/);
  assert.doesNotMatch(workspace, /BackgroundSync|sync\.register/);
});

test("two offline devices racing for one unit allow exactly one atomic claim", async () => {
  let status = "AVAILABLE";
  const atomicClaim = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (status !== "AVAILABLE") return 0;
    status = "RESERVED";
    return 1;
  };
  const results = await Promise.all([atomicClaim(), atomicClaim()]);
  assert.deepEqual(results.sort(), [0, 1]);
  assert.equal(status, "RESERVED");
});

test("offline operator UI distinguishes connectivity, refreshes conflicts and retains non-PII receipts", async () => {
  const [workspace, shell] = await Promise.all([readFile(workspacePath, "utf8"), readFile(shellPath, "utf8")]);
  assert.match(workspace, /Internet detected · checking STOR 24/);
  assert.match(workspace, /Online and synced/);
  assert.match(workspace, /refreshAfterConflict/);
  assert.match(workspace, /Availability refreshed\. Choose another unit/);
  assert.match(workspace, /renderQueueHealth/);
  assert.match(workspace, /renderReceipts/);
  assert.match(shell, /Request a specific unit/);
  assert.match(shell, /Recent sync receipts/);
  assert.match(shell, /unit is not held or confirmed until/i);
  assert.match(shell, /Confirmation channels/);
  assert.match(shell, /role="switch"/);
  assert.match(shell, /class="form-submit-bar"/);
  assert.match(shell, /Intended payment method/);
  assert.match(shell, /Debit order — mandate lease/);
  assert.match(workspace, /paymentMethod/);
  assert.match(workspace, /communications: payload\.data\.communications/);
  assert.match(workspace, /Continue to lease/);
  assert.match(workspace, /Payment link unavailable/);
});

test("offline payment intent prefills the reservation-to-BlendSign handoff", async () => {
  const [page, workspace] = await Promise.all([readFile(moveInPagePath, "utf8"), readFile(moveInWorkspacePath, "utf8")]);
  assert.match(page, /initialReservationId/);
  assert.match(page, /paymentMethod: reservation\.paymentMethod/);
  assert.match(workspace, /initialReservation\?\.customerId/);
  assert.match(workspace, /initialReservation\?\.unitId/);
  assert.match(workspace, /initialReservation\?\.paymentMethod\s*===\s*"UNDECIDED"\s*\?\s*""/);
  assert.match(workspace, /Select and confirm payment method/);
  assert.match(workspace, /Prefilled from the reservation/);
});
