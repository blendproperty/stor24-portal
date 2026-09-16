import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MAX_FACIAL_SUBMISSION_BYTES, validateFacialSubmissionImage } from "../src/lib/facial-access-service.ts";

const servicePath = new URL("../src/lib/facial-access-service.ts", import.meta.url);
const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const publicRoutePath = new URL("../src/app/api/public/v1/reservations/facial-photo/route.ts", import.meta.url);
const staffListRoutePath = new URL("../src/app/api/v1/access/facial-submissions/route.ts", import.meta.url);
const staffActionRoutePath = new URL("../src/app/api/v1/access/facial-submissions/[id]/route.ts", import.meta.url);
const migrationPath = new URL("../prisma/migrations/20260916120000_facial_photo_submissions/migration.sql", import.meta.url);

test("facial submission image validation matches the existing 5 MB JPEG/PNG rule", () => {
  assert.doesNotThrow(() => validateFacialSubmissionImage(new File(["image"], "face.jpg", { type: "image/jpeg" })));
  assert.doesNotThrow(() => validateFacialSubmissionImage(new File(["image"], "face.png", { type: "image/png" })));
  assert.throws(() => validateFacialSubmissionImage(new File(["image"], "face.gif", { type: "image/gif" })), /FACE_IMAGE_TYPE_INVALID/);
  assert.throws(
    () => validateFacialSubmissionImage(new File([new Uint8Array(MAX_FACIAL_SUBMISSION_BYTES + 1)], "face.jpg", { type: "image/jpeg" })),
    /FACE_IMAGE_SIZE_INVALID/,
  );
});

test("schema defines the facial photo submission queue additively", async () => {
  const schema = await readFile(schemaPath, "utf8");
  assert.match(schema, /model FacialPhotoSubmission \{/);
  assert.match(schema, /enum FacialSubmissionStatus \{\s*AWAITING_STAFF\s*APPROVED\s*REJECTED\s*SUPERSEDED\s*\}/);
  assert.match(schema, /imageData\s+Bytes/);
  assert.match(schema, /consentPolicyVersion\s+String/);
});

test("migration creates the FacialPhotoSubmission table and enum", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /CREATE TYPE "FacialSubmissionStatus"/);
  assert.match(migration, /CREATE TABLE "FacialPhotoSubmission"/);
  assert.match(migration, /"FacialPhotoSubmission_reservationId_fkey"/);
});

// STOR24_Claude_Handover_Facial_Access_Option_1.md section 5: submission must
// require verified identity, a signed agreement and a real cleared payment
// before a customer can even submit a photo. This is a source-contract check
// (no live database in this sandbox), not a live-eligibility proof.
test("submission eligibility gates on verification, signed agreement and cleared payment", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.match(service, /reservation\.status !== "ACTIVE"/);
  assert.match(service, /!reservation\.contactVerifiedAt \|\| !reservation\.customer\.emailVerifiedAt/);
  assert.match(service, /VERIFICATION_REQUIRED/);
  assert.match(service, /reservation\.publicLease\?\.status !== "SIGNED"/);
  assert.match(service, /AGREEMENT_NOT_SIGNED/);
  // Debit-order qualifying-payment rules are an explicit open owner decision
  // (handover section 12) -- self-service must not silently invent one.
  assert.match(service, /paymentMethod === "DEBIT_ORDER"/);
  assert.match(service, /DEBIT_ORDER_NOT_YET_SUPPORTED/);
  assert.match(service, /accountNumber: `ST24-T-\$\{reservationId\}`/);
  assert.match(service, /provider: "NETCASH", method: "PAY_NOW", status: "SUCCEEDED"/);
  assert.match(service, /PAYMENT_NOT_CLEARED/);
});

// A resubmission must not leave two AWAITING_STAFF rows for the same
// reservation eligible for staff approval at once.
test("a new submission supersedes any earlier awaiting-staff submission for the same reservation", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.match(service, /facialPhotoSubmission\.updateMany\(\{\s*where: \{ reservationId: reservation\.id, status: "AWAITING_STAFF" \},\s*data: \{ status: "SUPERSEDED" \}/);
});

// Handover section 4/6/12: staff activation is the only checkpoint that may
// trigger a real HikCentral enrolment, and only once the occupancy this
// submission is bound to is actually ACTIVE (i.e. Move In *and* lease
// signature have both completed) -- not on the Move In click alone.
test("staff approval requires an ACTIVE occupancy and rechecks payment before any HikCentral call", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.match(service, /export async function approveFacialSubmission/);
  const approveFn = service.slice(service.indexOf("export async function approveFacialSubmission"));
  assert.match(approveFn, /occupancies\.find\(\(item\) => item\.status === "ACTIVE"\)/);
  assert.match(approveFn, /OCCUPANCY_NOT_ACTIVE/);
  assert.match(approveFn, /findQualifyingPayment\(submission\.reservationId\)/);
  assert.match(approveFn, /PAYMENT_NOT_CLEARED/);
  assert.match(approveFn, /provider\.enroll\(/);
  assert.match(approveFn, /facial_access\.enrolment_activated/);
  assert.match(approveFn, /facial_access\.enrolment_failed/);
  // Consent belongs to the customer's own submission, not a staff attestation.
  assert.doesNotMatch(approveFn, /consentRecordedById:\s*scope\.userId/);
});

test("raw image bytes are never written to an audit event or log call", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.doesNotMatch(service, /console\.(log|info|debug)\([^)]*imageData/);
  assert.doesNotMatch(service, /after:\s*\{[^}]*imageData/);
  assert.doesNotMatch(service, /after:\s*\{[^}]*faceBase64/);
});

test("public submission endpoint self-authenticates and rate-limits", async () => {
  const route = await readFile(publicRoutePath, "utf8");
  assert.match(route, /publicApiAuthorized\(request\)/);
  assert.match(route, /rateLimit\(/);
  assert.match(route, /image instanceof File/);
});

test("staff facial-submission routes require access permission scope and same-origin", async () => {
  const listRoute = await readFile(staffListRoutePath, "utf8");
  assert.match(listRoute, /requirePermissionScope\("access\.view"\)/);
  const actionRoute = await readFile(staffActionRoutePath, "utf8");
  assert.match(actionRoute, /requirePermissionScope\("access\.manage"\)/);
  assert.match(actionRoute, /sameOrigin\(request\)/);
});
