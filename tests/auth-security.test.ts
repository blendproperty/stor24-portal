import assert from "node:assert/strict";
import test from "node:test";
import { permissionGranted } from "../src/lib/permissions.ts";
import { createResetToken, hashResetToken } from "../src/lib/password-reset.ts";
import { isPublicPathname } from "../src/proxy.ts";

test("dedicated merchandise worker reaches its credential handler without exposing staff APIs", () => {
  assert.equal(isPublicPathname("/api/v1/operations/merchandise-orders/expire"), true);
  for (const path of ["/api/v1/operations/merchandise-orders", "/api/v1/operations/merchandise-orders/expire/extra", "/api/v1/operations/merchandise-orders/expired", "/operations/merchandise"]) {
    assert.equal(isPublicPathname(path), false);
  }
});

test("tenant order shell uses tenant API authentication rather than staff login", () => {
  assert.equal(isPublicPathname("/my/orders/test-order_1"), true);
  assert.equal(isPublicPathname("/my/orders/test-order_1/admin"), false);
  assert.equal(isPublicPathname("/my/admin"), false);
});

test("session proxy allows only the HMAC-authenticated BlendSign webhook path", () => {
  assert.equal(isPublicPathname("/api/webhooks/blendsign"), true);
  assert.equal(isPublicPathname("/api/webhooks/blendsign/anything"), true);
  assert.equal(isPublicPathname("/api/webhooks/unknown"), false);
});

test("session proxy allows the unauthenticated Netcash Pay Now webhook path", () => {
  assert.equal(isPublicPathname("/api/webhooks/netcash"), true);
});

test("PWA shell assets are public without exposing protected application routes", () => {
  assert.equal(isPublicPathname("/sw.js"), true);
  assert.equal(isPublicPathname("/manifest.webmanifest"), true);
  assert.equal(isPublicPathname("/offline.html"), true);
  assert.equal(isPublicPathname("/offline-workspace.html"), true);
  assert.equal(isPublicPathname("/icons/icon-192.png"), true);
  assert.equal(isPublicPathname("/accounts"), false);
  assert.equal(isPublicPathname("/api/v1/accounts"), false);
});

test("permission matcher supports exact, scoped, read-only and owner grants", () => {
  assert.equal(permissionGranted(["leads.create"], "leads.create"), true);
  assert.equal(permissionGranted(["facility.*"], "facility.update"), true);
  assert.equal(permissionGranted(["*.view"], "reports.view"), true);
  assert.equal(permissionGranted(["reports.view"], "reports.export"), false);
  assert.equal(permissionGranted(["*"], "users.manage"), true);
});

test("reset tokens are random and only stable after hashing", () => {
  const first = createResetToken();
  const second = createResetToken();
  assert.notEqual(first, second);
  assert.equal(hashResetToken(first), hashResetToken(first));
  assert.notEqual(hashResetToken(first), first);
  assert.match(hashResetToken(first), /^[a-f0-9]{64}$/);
});
