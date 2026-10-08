import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ABC_FUNNELS, abcFilter, marketingABC, parseABCFunnel, parseABCReport } from "../src/lib/marketing-abc";
import { MarketingFunnel } from "../src/components/marketing-abc";
function fixtureFunnel(values = [20, 12, 8, 6, 4]) {
  return { funnelTable: { dimensionHeaders: [{ name: "funnelStepName" }], metricHeaders: [{ name: "funnelStepAbandonmentRate" }, { name: "activeUsers" }, { name: "funnelStepAbandonments" }], rows: ABC_FUNNELS.booking.map(([, name], i) => ({ dimensionValues: [{ value: `${i + 1}. ${name}` }], metricValues: [{ value: String(i < 4 ? (values[i] - values[i + 1]) / values[i] : 0) }, { value: String(values[i]) }, { value: String(i < 4 ? values[i] - values[i + 1] : 0) }] })) } };
}
test("funnel reads named headers, ordered users and drop-offs, never sums event totals", () => {
  const parsed = parseABCFunnel(fixtureFunnel(), ABC_FUNNELS.booking);
  assert.deepEqual(parsed.steps[0], { name: "Unit finder opened", users: 20, abandoned: 8, abandonmentRate: .4 });
  const html = renderToStaticMarkup(<MarketingFunnel title="Booking" funnel={parsed}/>);
  assert.match(html, /Largest measured drop-off: Unit finder opened/);
  assert.match(html, /40.0%/); assert.match(html, /does not establish a reason/);
  const broken = fixtureFunnel(); broken.funnelTable.rows.pop();
  assert.throws(() => parseABCFunnel(broken, ABC_FUNNELS.booking), /INCOMPLETE_FUNNEL/);
  assert.throws(() => parseABCFunnel(fixtureFunnel([4, 12, 8, 6, 4]), ABC_FUNNELS.booking));
});
test("successful empty funnel is zero measured starts; unavailable and malformed are explicit gaps", () => {
  const empty = fixtureFunnel(); empty.funnelTable.rows = [];
  const zero = parseABCFunnel(empty, ABC_FUNNELS.booking);
  assert.equal(zero.steps[0].users, 0);
  assert.match(renderToStaticMarkup(<MarketingFunnel title="Booking" funnel={zero}/>), /historical activity cannot be reconstructed/);
  assert.throws(() => parseABCFunnel({}, ABC_FUNNELS.booking));
  assert.match(renderToStaticMarkup(<MarketingFunnel title="Booking" funnel={{ status: "unavailable", steps: [], caveats: [] }}/>), /Event totals are not substituted/);
  for (const value of ["", "NaN", "-2", "Infinity"]) assert.throws(() => parseABCReport({ rows: [{ metricValues: [{ value }] }] }, 0, 1));
  const report = parseABCReport({ rows: [{ metricValues: [{ value: "2" }] }], rowCount: 200, metadata: { subjectToThresholding: true, samplingMetadatas: [{}] } }, 0, 1);
  assert.equal(report.limited, true); assert.equal(report.caveats.length, 2);
});
test("all ABC requests retain exact host / channel filters and independent provider failure states", async () => {
  const originalFetch = globalThis.fetch, account = process.env.GA4_SERVICE_ACCOUNT_JSON, property = process.env.GA4_PROPERTY_ID;
  try {
    delete process.env.GA4_SERVICE_ACCOUNT_JSON; delete process.env.GA4_PROPERTY_ID;
    let calls = 0; globalThis.fetch = async () => { calls++; throw Error("private-secret"); };
    assert.equal((await marketingABC("2026-10-01", "2026-10-07")).status, "unconfigured"); assert.equal(calls, 0);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "fixture@fixture.iam.gserviceaccount.com", private_key: privateKey }); process.env.GA4_PROPERTY_ID = "123";
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = async (url, init) => {
      if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "private-token" });
      assert.match(String(url), /^https:\/\/analyticsdata.googleapis.com\/v1(?:beta|alpha)\/properties\/123:run(?:Report|FunnelReport)$/);
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      assert.match(JSON.stringify(body.dimensionFilter), /hostName/); assert.match(JSON.stringify(body.dimensionFilter), /stor24.co.za/); assert.match(JSON.stringify(body.dimensionFilter), /sessionDefaultChannelGroup/);
      if (String(url).endsWith("runFunnelReport")) {
        assert.equal(body.funnel.isOpenFunnel, false); assert.equal(body.funnel.steps[1].withinDurationFromPriorStep, "1800s");
        if (body.funnel.steps.length === 3) return new Response("private error", { status: 503 });
        return Response.json(fixtureFunnel());
      }
      if (body.dimensions[0]?.name === "pagePath") return Response.json({ rows: [{ dimensionValues: body.dimensions.map((_: unknown, i: number) => ({ value: i === 0 ? "/book/lease/private-token" : "generate_lead" })), metricValues: body.metrics.map(() => ({ value: "1" })) }] });
      return Response.json({ rows: [] });
    };
    const result = await marketingABC("2026-10-01", "2026-10-07", { channel: "Organic Search" });
    assert.equal(bodies.length, 11); assert.equal(result.funnels.booking.status, "connected"); assert.equal(result.funnels.enquiry.status, "unavailable"); assert.equal(result.acquisition.status, "connected"); assert.deepEqual(result.pages.rows, []);
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.throws(() => abcFilter({ source: "bad\nsource" }));
  } finally {
    globalThis.fetch = originalFetch;
    if (account === undefined) delete process.env.GA4_SERVICE_ACCOUNT_JSON; else process.env.GA4_SERVICE_ACCOUNT_JSON = account;
    if (property === undefined) delete process.env.GA4_PROPERTY_ID; else process.env.GA4_PROPERTY_ID = property;
  }
});
