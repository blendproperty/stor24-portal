import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formatSouthAfricaDateTime, southAfricaDateKey, SOUTH_AFRICA_TIME_ZONE } from "../src/lib/south-africa-time";

test("uses the explicit South African IANA time zone", () => {
  assert.equal(SOUTH_AFRICA_TIME_ZONE, "Africa/Johannesburg");
});

test("formats UTC timestamps as South African local time", () => {
  assert.match(formatSouthAfricaDateTime("2026-08-28T12:00:00.000Z"), /14:00/);
});

test("South African date keys cross UTC midnight correctly", () => {
  assert.equal(southAfricaDateKey("2026-08-28T22:30:00.000Z"), "2026-08-29");
});

test("operational timestamp screens use the shared South African formatter", () => {
  for (const file of ["../src/app/audit/page.tsx", "../src/app/communications/page.tsx", "../src/app/integrations/page.tsx", "../src/app/offline-readiness/page.tsx", "../src/components/operations-workspace.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /formatSouthAfricaDate/);
    assert.doesNotMatch(source, /toLocaleString\("en-ZA"\)/);
  }
});
