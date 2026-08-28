import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { southAfricaDateKey } from "../src/lib/south-africa-time";

const page = readFileSync(new URL("../src/app/calendar/page.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/lib/calendar-service.ts", import.meta.url), "utf8");

test("calendar day grouping uses the South African calendar date", () => {
  assert.equal(southAfricaDateKey("2026-08-27T22:30:00.000Z"), "2026-08-28");
});

test("calendar is live and facility-scoped rather than a hard-coded schedule", () => {
  assert.match(page, /getOperationsCalendar/);
  assert.doesNotMatch(page, /Mon 03|Autopay retry|Rate reviews/);
  assert.match(service, /facilityWhere\(scope\)/);
  assert.match(service, /db\.task\.findMany/);
  assert.match(service, /db\.lead\.findMany/);
  assert.match(service, /db\.reservation\.findMany/);
});
