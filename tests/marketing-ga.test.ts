import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { marketingTraffic } from "../src/lib/marketing-ga";
test("GA reporting is explicitly unconfigured and fails without exposing provider errors or credentials", async () => {
  const savedAccount = process.env.GA4_SERVICE_ACCOUNT_JSON,
    savedProperty = process.env.GA4_PROPERTY_ID,
    originalFetch = globalThis.fetch;
  try {
    delete process.env.GA4_SERVICE_ACCOUNT_JSON;
    delete process.env.GA4_PROPERTY_ID;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error("private provider error");
    };
    assert.equal(
      (await marketingTraffic("2026-10-01", "2026-10-04")).status,
      "unconfigured",
    );
    assert.equal(calls, 0);
    process.env.GA4_PROPERTY_ID = "556793224";
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "invalid",
      private_key: "private-test-key",
    });
    const result = await marketingTraffic("2026-10-01", "2026-10-04");
    assert.equal(result.status, "unavailable");
    assert.equal(JSON.stringify(result).includes("private-test-key"), false);
    assert.equal(result.totals, null);
  } finally {
    if (savedAccount === undefined) delete process.env.GA4_SERVICE_ACCOUNT_JSON;
    else process.env.GA4_SERVICE_ACCOUNT_JSON = savedAccount;
    if (savedProperty === undefined) delete process.env.GA4_PROPERTY_ID;
    else process.env.GA4_PROPERTY_ID = savedProperty;
    globalThis.fetch = originalFetch;
  }
});
test("GA reporting requests only aggregate read metrics and never returns its token", async () => {
  const savedAccount = process.env.GA4_SERVICE_ACCOUNT_JSON,
    savedProperty = process.env.GA4_PROPERTY_ID,
    originalFetch = globalThis.fetch;
  try {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    process.env.GA4_PROPERTY_ID = "556793224";
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "fixture@fixture.iam.gserviceaccount.com",
      private_key: privateKey,
    });
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        assert.match(String(init?.body), /analytics.readonly|assertion=/);
        return Response.json({ access_token: "synthetic-not-a-real-token" });
      }
      assert.equal(
        url,
        "https://analyticsdata.googleapis.com/v1beta/properties/556793224:runReport",
      );
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return Response.json(
        body.dimensions.length
          ? {
              rows: [
                {
                  dimensionValues: [{ value: "20261004" }],
                  metricValues: [{ value: "12" }, { value: "20" }],
                },
              ],
            }
          : {
              rows: [
                {
                  metricValues: [
                    { value: "12" },
                    { value: "20" },
                    { value: "8" },
                  ],
                },
              ],
            },
      );
    };
    const result = await marketingTraffic("2026-10-01", "2026-10-04");
    assert.equal(result.status, "connected");
    assert.deepEqual(result.totals, { sessions: 12, views: 20, users: 8 });
    assert.equal(result.days[0].date, "2026-10-04");
    assert.equal(bodies.length, 2);
    assert.equal(
      JSON.stringify(result).includes("synthetic-not-a-real-token"),
      false,
    );
    assert.equal(JSON.stringify(bodies).includes("userId"), false);
  } finally {
    if (savedAccount === undefined) delete process.env.GA4_SERVICE_ACCOUNT_JSON;
    else process.env.GA4_SERVICE_ACCOUNT_JSON = savedAccount;
    if (savedProperty === undefined) delete process.env.GA4_PROPERTY_ID;
    else process.env.GA4_PROPERTY_ID = savedProperty;
    globalThis.fetch = originalFetch;
  }
});
