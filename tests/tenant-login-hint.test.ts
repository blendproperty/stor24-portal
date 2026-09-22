import test from "node:test";
import assert from "node:assert/strict";
import { tenantLoginHint } from "../src/lib/tenant-login-hint";
test("browser-only email hint decodes plus addresses without adding authentication", () => {
  assert.equal(tenantLoginHint("#email=person%2Bbooking%40example.invalid"), "person+booking@example.invalid");
  assert.equal(tenantLoginHint("#access-photo"),undefined);
  for(const bad of ["", "bad", "x@example.invalid\n", "x".repeat(255)]) assert.equal(tenantLoginHint("#"+new URLSearchParams({email:bad})),undefined);
});
