import assert from "node:assert/strict";
import test from "node:test";
import { formatSouthAfricaDateTime, SOUTH_AFRICA_TIME_ZONE } from "../src/lib/south-africa-time";

test("uses the explicit South African IANA time zone", () => {
  assert.equal(SOUTH_AFRICA_TIME_ZONE, "Africa/Johannesburg");
});

test("formats UTC timestamps as South African local time", () => {
  assert.match(formatSouthAfricaDateTime("2026-08-28T12:00:00.000Z"), /14:00/);
});
