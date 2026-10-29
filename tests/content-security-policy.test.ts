import assert from "node:assert/strict";
import test from "node:test";
import { pageSecurityHeaders, contentSecurityPolicy } from "../src/lib/content-security-policy";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

test("untrusted CSP/nonce headers are replaced with a fresh request nonce", () => {
  const first = pageSecurityHeaders(new Headers({ "x-nonce": "attacker", "content-security-policy": "script-src * 'unsafe-inline'" }));
  const second = pageSecurityHeaders(new Headers());
  assert.notEqual(first.requestHeaders.get("x-nonce"), second.requestHeaders.get("x-nonce"));
  assert.match(first.requestHeaders.get("x-nonce")!, /^[A-Za-z\d+/]{24}$/);
  assert.equal(first.requestHeaders.get("content-security-policy"), first.policy);
  assert.match(first.policy, /script-src-attr 'none'/);
  assert.match(first.policy, /object-src 'none'/);
  assert.doesNotMatch(first.policy.split(";").find(value => value.trim().startsWith("script-src "))!, /unsafe-inline|attacker/);
  assert.doesNotMatch(contentSecurityPolicy(), /nonce-/);
});

test("anonymous HTML receives consistent render/response CSP while APIs keep their own policy", async () => {
  const page = await proxy(new NextRequest("https://example.invalid/login"));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-security-policy"), page.headers.get("x-middleware-request-content-security-policy"));
  assert.equal(page.headers.get("cache-control"), "private, no-store");
  const api = await proxy(new NextRequest("https://example.invalid/api/v1/configuration"));
  assert.equal(api.status, 401);
  assert.equal(api.headers.get("content-security-policy"), null);
  assert.equal((await proxy(new NextRequest("https://example.invalid/offline-recovery.js"))).status, 200);
});
