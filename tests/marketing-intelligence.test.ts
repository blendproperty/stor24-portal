import test from "node:test";
import assert from "node:assert/strict";
import type { MarketingWorkspace } from "../src/lib/marketing-service";
import {
  marketingIntelligence,
  ratio,
} from "../src/lib/marketing-intelligence";
const fixture = {
  facilities: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
  count: 4,
  limited: false,
  campaigns: [
    {
      id: "campaign",
      facilityId: "a",
      name: "Launch",
      source: "google",
      medium: "cpc",
      budget: 100,
      status: "ACTIVE",
      startsAt: "2026-10-01T00:00:00+02:00",
      endsAt: "2026-10-05T00:00:00+02:00",
      activities: [
        {
          id: "one",
          occurredAt: "2026-10-02T00:00:00+02:00",
          spend: 40,
          clicks: 10,
          impressions: 100,
        },
        {
          id: "two",
          occurredAt: "2026-10-10T00:00:00+02:00",
          spend: 80,
          clicks: 20,
          impressions: 200,
        },
      ],
      links: [
        {
          id: "placement",
          campaignId: "campaign",
          label: "Creative A",
          landingPage: "/",
          url: "https://stor24.co.za/",
        },
      ],
    },
  ],
  leads: [
    {
      facilityId: "a",
      createdAt: "2026-10-01T22:30:00Z",
      won: true,
      reserved: false,
      source: "PUBLIC_WEBSITE",
      attribution: {
        source: "google",
        medium: "cpc",
        campaignId: "campaign",
        linkId: "placement",
        landingPage: "/",
        conversionPage: "/book",
      },
    },
    {
      facilityId: "a",
      createdAt: "2026-10-02T10:00:00Z",
      won: false,
      reserved: false,
      source: "PHONE",
      attribution: null,
    },
    {
      facilityId: "a",
      createdAt: "2026-09-30T21:30:00Z",
      won: false,
      reserved: false,
      source: "PHONE",
      attribution: null,
    },
    {
      facilityId: "b",
      createdAt: "2026-10-02T10:00:00Z",
      won: false,
      reserved: false,
      source: "PUBLIC_WEBSITE",
      attribution: {
        source: "google",
        medium: "cpc",
        campaignId: "campaign",
        linkId: "placement",
        landingPage: "/",
        conversionPage: "/book",
      },
    },
  ],
} as unknown as MarketingWorkspace;
test("equal SAST comparison windows, lifetime budget and reporting-cutoff pacing stay distinct", () => {
  const r = marketingIntelligence(fixture, "2026-10-02", "2026-10-03", "a");
  assert.equal(r.previousFrom, "2026-09-30");
  assert.equal(r.previousTo, "2026-10-01");
  assert.equal(r.previous.leads, 1);
  assert.equal(r.current.leads, 2);
  assert.equal(r.current.spend, 40);
  assert.equal(r.budgets[0].lifetimeSpend, 120);
  assert.equal(r.budgets[0].remaining, -20);
  assert.equal(r.budgets[0].spendToCutoff, 40);
  assert.ok(Math.abs(r.budgets[0].expectedToDate! - 75) < 0.001);
});
test("recorded sources do not inherit campaign costs; registered placement attribution remains scoped", () => {
  const r = marketingIntelligence(fixture, "2026-10-02", "2026-10-03", "a");
  assert.equal(r.channels.find((c) => c.label === "google / cpc")?.leads, 1);
  assert.equal(r.channels.find((c) => !c.registered)?.spend, 0);
  assert.equal(r.registeredLeads, 1);
  assert.equal(r.placements[0].leads, 1);
  assert.equal(r.placements[0].won, 1);
  assert.equal(r.landingPages[0].leads, 1);
  const all = marketingIntelligence(fixture, "2026-10-02", "2026-10-03");
  assert.equal(all.current.campaigns[0].leads, 1);
  assert.equal(all.placements[0].leads, 1);
  assert.equal(
    all.channels.reduce((n, c) => n + c.leads, 0),
    3,
  );
  const other = marketingIntelligence(fixture, "2026-10-02", "2026-10-03", "b");
  assert.equal(other.budgets.length, 0);
  assert.equal(other.placements.length, 0);
  assert.equal(other.registeredLeads, 0);
});
test("zero denominators and open-ended schedules have no fabricated efficiency or pacing", () => {
  assert.equal(ratio(10, 0), null);
  assert.equal(ratio(0, 10), 0);
  const changed = structuredClone(fixture);
  changed.campaigns[0].endsAt = null;
  changed.campaigns[0].budget = 0;
  const r = marketingIntelligence(changed, "2026-10-02", "2026-10-03", "a");
  assert.equal(r.budgets[0].utilisation, null);
  assert.equal(r.budgets[0].expectedToDate, null);
});
