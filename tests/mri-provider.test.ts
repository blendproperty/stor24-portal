import assert from "node:assert/strict";
import test from "node:test";
import { MRI_API_BASE, verifyMriAccess } from "../src/lib/integrations/mri-provider";
const credentials = { login: "ci@example.invalid", password: "ci &= secret" };
test("MRI v2 uses the documented password grant and bearer/header contract without writes", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await verifyMriAccess({ ...credentials, databaseIdentifier: "ci-db" }, async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (String(url).endsWith("/Token")) return Response.json({ access_token: "ci-token-never-persist", token_type: "bearer" });
    if (String(url).endsWith("GetDatabaseAccessList")) return Response.json([{ DatabaseName: "CI Blend", DatabaseIdentifier: "ci-db" }]);
    return Response.json({ ResultCount: 10, ResultSet: [{ Id: 1, PrivateField: "not returned" }] });
  });
  assert.equal(calls[0].url, `${MRI_API_BASE}/v2/Token`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(calls[0].init.body))), { grant_type: "password", username: credentials.login, password: credentials.password });
  assert.equal(calls[0].init.redirect, "error"); assert.equal(calls.length, 3);
  assert.equal(calls[1].init.method, "GET"); assert.deepEqual(JSON.parse(String(calls[2].init.body)), { PageIndex: 0, PageSize: 1 });
  assert.equal((calls[2].init.headers as Record<string, string>).DatabaseIdentifier, "ci-db");
  assert.equal(result.databaseReadable, true); assert.equal(result.propertyCount, 10);
  assert.ok(!JSON.stringify(result).includes("ci-token")); assert.ok(!JSON.stringify(result).includes("PrivateField"));
});
test("MRI discovery denial preserves authentication without claiming database access", async () => {
  let calls = 0;
  const result = await verifyMriAccess(credentials, async () => ++calls === 1 ? Response.json({ access_token: "ci-token", token_type: "Bearer" }) : Response.json({ error: "private provider diagnostic" }, { status: 403 }));
  assert.equal(result.authenticated, true); assert.equal(result.databaseReadable, false); assert.equal(result.discoveryAvailable, false); assert.equal(calls, 2);
});
test("MRI failures are bounded, redacted and never automatically retried", async () => {
  for (const status of [400,401,403,500]) {
    let calls = 0;
    await assert.rejects(verifyMriAccess(credentials, async () => { calls++; return new Response("ci-secret diagnostic", {status}); }), e => e instanceof Error && !e.message.includes("ci-secret") && /^MRI_(AUTH_REJECTED|PROVIDER_UNAVAILABLE)$/.test(e.message));
    assert.equal(calls, 1);
  }
  await assert.rejects(verifyMriAccess(credentials, async () => { throw new Error("ci-secret network detail"); }), /MRI_NETWORK/);
  await assert.rejects(verifyMriAccess(credentials, async () => new Response("x".repeat(128001))), /MRI_RESPONSE_INVALID/);
  await assert.rejects(verifyMriAccess(credentials, async () => Response.json({ access_token: "secret", token_type: "Basic" })), /MRI_RESPONSE_INVALID/);
});
