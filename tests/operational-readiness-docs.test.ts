import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("operational UAT pack covers every in-scope release workstream", () => {
  const text = fs.readFileSync(
    path.join(root, "docs", "OPERATIONAL_UAT_AND_TRAINING.md"),
    "utf8",
  );

  for (const required of [
    "Public booking, reservation and cancellation",
    "Lead to move-in",
    "Facility and ownership isolation",
    "WhatsApp",
    "BlendSign success and failure handling",
    "Insurance operations",
    "Reporting and monitoring",
    "Migration rehearsal",
    "Offline and recovery",
    "South African Standard Time",
  ]) {
    assert.match(text, new RegExp(required));
  }
});

test("readiness checklist keeps business inputs and proof gates explicit", () => {
  const text = fs.readFileSync(
    path.join(root, "docs", "PRODUCTION_READINESS_CHECKLIST.md"),
    "utf8",
  );

  for (const required of [
    "CAPTCHA and OTP",
    "approved consenting test recipient",
    "controlled retry/resend",
    "provider, product, cover, premium, excess and policy wording",
    "authorised operational legacy export",
    "Do not mark readiness complete merely because code is deployed",
  ]) {
    assert.match(text, new RegExp(required));
  }
});
