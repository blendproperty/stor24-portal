import assert from "node:assert/strict";
import { db } from "../../../src/lib/db";
import { facialPhotoPolicy } from "../../../src/lib/facial-photo-security";

/** Synthetic metadata for tests focused on other handover gates; the photo suite tests real encrypted upload/review. */
export async function seedApprovedPhoto(organisationId: string, reservationId: string, userId: string) {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.FACIAL_ACCESS_POLICIES_JSON = JSON.stringify({ ...JSON.parse(process.env.FACIAL_ACCESS_POLICIES_JSON ?? "{}"), [organisationId]: { enabled: true, version: "ci-v1", notice: "Synthetic CI policy only. This does not represent legal approval or a real customer consent.", consentLabel: "Synthetic consent checkbox only", approvalReference: "CI-only", retentionHours: 24, alternativeContact: "CI staff assisted alternative" } });
  return db.facialPhotoSubmission.create({ data: { reservationId, status: "APPROVED", encryptedImage: "synthetic-fixture-never-decrypted", imageSha256: "synthetic", policyVersion: "ci-v1", policyHash: facialPhotoPolicy(organisationId)!.hash, consentNotice: "Synthetic consent only", consentAt: new Date(), expiresAt: new Date(Date.now() + 86400000), reviewedAt: new Date(), reviewedById: userId } });
}
