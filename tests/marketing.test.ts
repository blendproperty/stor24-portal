import test from "node:test";
import assert from "node:assert/strict";
import {
  marketingInput,
  trackedUrl,
  csvCell,
} from "../src/lib/marketing-contract";
import { marketingReport } from "../src/lib/marketing-reporting";
import { leadAttributionSchema } from "../src/lib/lead-attribution";
import { canVisit } from "../src/lib/navigation-access";
const cid = "c" + "a".repeat(24),
  lid = "c" + "b".repeat(24);
test("tracked links carry registered IDs and constrain public landing destinations", () => {
  const url = new URL(
    trackedUrl(
      { id: cid, source: "google", medium: "cpc" },
      { id: lid, landingPage: "/book", keyword: "storage midrand" },
    ),
  );
  assert.equal(url.origin, "https://stor24.co.za");
  assert.equal(url.searchParams.get("utm_campaign"), cid);
  assert.equal(url.searchParams.get("utm_content"), lid);
  assert.equal(url.searchParams.get("utm_term"), lid);
  assert.equal(url.toString().includes("midrand"), false);
  for (const path of [
    "https://evil.test",
    "//evil.test",
    "/book?email=x",
    "/pay/result",
    "/my",
    "/book/sign/token",
  ])
    assert.throws(() =>
      trackedUrl(
        { id: cid, source: "google", medium: "cpc" },
        { id: lid, landingPage: path, keyword: null },
      ),
    );
});
test("marketing inputs reject negative, fractional count and malformed date/ID values", () => {
  const activity = {
    kind: "activity",
    submissionId: "11111111-1111-4111-8111-111111111111",
    campaignId: cid,
    title: "Search advertising",
    activityKind: "ADVERTISING",
    occurredAt: "2026-10-04T10:00:00Z",
    spend: 100.25,
    impressions: 10,
    clicks: 1,
  };
  assert.equal(marketingInput.safeParse(activity).success, true);
  for (const change of [
    { spend: -1 },
    { spend: 1.111 },
    { clicks: 1.5 },
    { campaignId: "private@example.com" },
    { occurredAt: "bad" },
    { unknown: "unexpected" },
  ])
    assert.equal(
      marketingInput.safeParse({ ...activity, ...change }).success,
      false,
    );
  const campaign = {
    kind: "campaign",
    submissionId: "11111111-1111-4111-8111-111111111111",
    facilityId: "store",
    name: "Launch",
    source: "google",
    medium: "cpc",
    budget: 100,
    status: "PLANNED",
    startsAt: "2026-10-04T00:00:00Z",
    endsAt: "2026-10-03T00:00:00Z",
  };
  assert.equal(marketingInput.safeParse(campaign).success, false);
});
test("CRM campaign attribution permits opaque IDs but rejects raw campaign or keyword text", () => {
  const base = {
    version: 1,
    consent: "granted",
    landingPage: "/",
    conversionPage: "/book",
    pages: ["/"],
    source: "google",
    medium: "cpc",
    campaignId: cid,
    linkId: lid,
  };
  assert.equal(leadAttributionSchema.safeParse(base).success, true);
  assert.equal(
    leadAttributionSchema.safeParse({ ...base, campaignId: "customer-name" })
      .success,
    false,
  );
  assert.equal(
    leadAttributionSchema.safeParse({
      ...base,
      utm_term: "private@example.com",
    }).success,
    false,
  );
});
test("report respects SAST day boundaries, facility scope, actual conversions and period spend", () => {
  const campaign = {
    id: cid,
    facilityId: "one",
    name: "Launch",
    source: "google",
    medium: "cpc",
    budget: 100,
    status: "ACTIVE",
    activities: [
      {
        occurredAt: "2026-10-03T23:00:00Z",
        spend: 40,
        clicks: 5,
        impressions: 100,
      },
      {
        occurredAt: "2026-10-03T20:00:00Z",
        spend: 99,
        clicks: 9,
        impressions: 999,
      },
    ],
  };
  const lead = {
    facilityId: "one",
    createdAt: "2026-10-03T22:00:00Z",
    source: "Website",
    won: true,
    reserved: false,
    attribution: {
      source: "google",
      medium: "cpc",
      campaignId: cid,
      landingPage: "/",
      conversionPage: "/book",
    },
  };
  const report = marketingReport(
    [
      lead,
      { ...lead, facilityId: "two" },
      { ...lead, createdAt: "2026-10-03T21:59:59Z" },
      { ...lead, createdAt: "2026-10-04T22:00:00Z" },
    ],
    [campaign],
    "2026-10-04",
    "2026-10-04",
    "one",
  );
  assert.equal(report.leads, 1);
  assert.equal(report.won, 1);
  assert.equal(report.spend, 40);
  assert.equal(report.campaigns[0].cpl, 40);
  assert.equal(report.trend[0].leads, 1);
  assert.equal(report.trend[0].spend, 40);
  const empty = marketingReport([], [campaign], "2026-10-04", "2026-10-04");
  assert.equal(empty.campaigns[0].cpl, null);
  assert.equal(empty.conversion, 0);
});
test("marketing navigation requires lead visibility and CSV values cannot become formulas", () => {
  assert.equal(
    canVisit("/marketing", { owner: false, permissions: ["operations.view"] }),
    false,
  );
  assert.equal(
    canVisit("/marketing", { owner: false, permissions: ["leads.view"] }),
    true,
  );
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
});
