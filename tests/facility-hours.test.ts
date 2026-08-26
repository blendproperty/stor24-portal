import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const company = readFileSync(new URL("../src/components/company-workspace.tsx", import.meta.url), "utf8");
const publicFacility = readFileSync(new URL("../src/app/api/public/v1/facilities/[slug]/route.ts", import.meta.url), "utf8");

test("company setup stores separate facility access and office schedules", () => {
  assert.match(company, /title="Access hours"/);
  assert.match(company, /title="Office hours"/);
  assert.match(company, /accessPublicHolidayClosed/);
  assert.match(company, /officePublicHolidayClosed/);
  assert.match(company, /Set independently for each facility/);
});

test("customer-safe facility API exposes both schedules", () => {
  assert.match(publicFacility, /"accessWeekdayStart"/);
  assert.match(publicFacility, /"accessPublicHolidayClosed"/);
  assert.match(publicFacility, /"officeWeekdayStart"/);
  assert.match(publicFacility, /"officePublicHolidayClosed"/);
});
