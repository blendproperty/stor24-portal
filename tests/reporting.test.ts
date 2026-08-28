import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { availableReports, reportParametersSchema, toCsv } from "../src/lib/reporting";

test("report catalogue is filtered by role", () => {
  const sales = availableReports(["reports.sales"]).map((report) => report.key);
  assert.deepEqual(sales, ["lead-conversion"]);
  const owner = availableReports(["*"]);
  assert.equal(owner.length, 9);
});

test("report exports use scoped production data and never synthetic rows", () => {
  const route = readFileSync(new URL("../src/app/api/v1/reports/export/route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/lib/report-data-service.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../src/components/reports-workspace.tsx", import.meta.url), "utf8");
  assert.match(route, /buildReportRows/);
  assert.doesNotMatch(route, /synthetic/);
  assert.match(service, /requireFacility\(scope, parameters\.facilityId\)/);
  assert.match(workspace, /facilities\.map/);
  assert.doesNotMatch(workspace, /Stor24 Randburg/);
});

test("report parameters reject reversed date ranges", () => {
  const parsed = reportParametersSchema.safeParse({ reportKey: "occupancy-revenue", from: "2026-07-31", to: "2026-05-01", format: "CSV", groupBy: "month" });
  assert.equal(parsed.success, false);
});

test("CSV encoding handles commas, quotes and formula-like values safely as quoted text", () => {
  const csv = toCsv([{ name: "Unit, A", note: 'He said "ready"', value: "=1+1" }]);
  assert.match(csv, /"Unit, A"/);
  assert.match(csv, /"He said ""ready"""/);
  assert.match(csv, /"'=1\+1"/);
});
