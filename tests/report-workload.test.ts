import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { reportParametersSchema } from "../src/lib/reporting";
import { MAX_REPORT_ROWS, REPORT_QUERY_TAKE } from "../src/lib/report-workload";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Synthetic persistence arguments.
const scope = { userId: "staff", organisationId: "org", facilityIds: ["a"], unrestrictedFacilities: false };
const parameters = (reportKey: string) => ({ reportKey, from: "2026-01-01", to: "2026-01-31", format: "CSV" as const, groupBy: "month" as const });
async function fixture() {
  const rows: Record<string, Row[]> = { facility: [], unit: [], occupancy: [], lead: [], tenancy: [], insuranceEnrollment: [], integrationConnection: [] };
  const queries: Row[] = [];
  const db = Object.fromEntries(Object.keys(rows).map(model => [model, { findMany: async (args: Row) => { queries.push({ model, ...args }); return rows[model]; } }]));
  const output = await build({ absWorkingDir: process.cwd(), tsconfig: "tsconfig.json", stdin: { contents: 'export {buildReportRows} from "./src/lib/report-data-service";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "report-workload-fixture", setup(b) {
    const mocks: Record<string, string> = {
      "@/lib/db": "export const db=__fixture.db;",
      "@/lib/scope": "export async function requireFacility(scope,id) { if(!scope.facilityIds.includes(id)) throw Error('FACILITY_FORBIDDEN'); }",
      "@/lib/collections-service": "export async function collectionsWorkspace() {throw Error('unexpected');}",
    };
    b.onResolve({ filter: /^@\/lib\// }, a => mocks[a.path] ? { path: a.path, namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: mocks[a.path] }));
  } }] });
  const loaded = { exports: {} as { buildReportRows: (s: typeof scope, p: ReturnType<typeof parameters> & { facilityId?: string }) => Promise<Row[]> } };
  new Function("require", "module", "exports", "__fixture", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, { db });
  return { ...loaded.exports, rows, queries };
}

test("period bounds retain all-history ageing and current snapshots, including leap-year windows", () => {
  assert.equal(reportParametersSchema.safeParse({ ...parameters("lead-conversion"), to: "2026-12-31" }).success, true);
  assert.equal(reportParametersSchema.safeParse({ ...parameters("lead-conversion"), to: "2027-01-02" }).success, false);
  assert.equal(reportParametersSchema.safeParse({ ...parameters("rent-roll"), from: "2024-01-01", to: "2024-12-31" }).success, true);
  for (const reportKey of ["receivables-ageing", "occupancy-revenue", "insurance-participation"]) {
    assert.equal(reportParametersSchema.safeParse({ ...parameters(reportKey), from: "2000-01-01" }).success, true);
  }
});

test("oversized reports fail in full before mapping; every root query remains scoped and bounded", async () => {
  const pairs = [["unit-availability", "unit"], ["lead-conversion", "lead"], ["move-activity", "occupancy"], ["rent-roll", "tenancy"], ["collections-performance", "tenancy"], ["insurance-participation", "insuranceEnrollment"], ["integration-health", "integrationConnection"]];
  for (const [key, model] of pairs) {
    const f = await fixture(); f.rows[model] = Array(MAX_REPORT_ROWS + 1).fill({});
    await assert.rejects(f.buildReportRows(scope, parameters(key)), /REPORT_LIMIT/);
    assert.equal(f.queries[0].take, REPORT_QUERY_TAKE);
    assert.ok(JSON.stringify(f.queries[0].where).includes('"org"'));
    assert.ok(JSON.stringify(f.queries[0].where).includes('"a"'));
  }
  const f = await fixture();
  await assert.rejects(f.buildReportRows(scope, { ...parameters("lead-conversion"), to: "2027-01-02" }), /REPORT_PERIOD_LIMIT/); assert.equal(f.queries.length, 0);
  await assert.rejects(f.buildReportRows(scope, { ...parameters("lead-conversion"), facilityId: "other" }), /FACILITY_FORBIDDEN/); assert.equal(f.queries.length, 0);
});

test("rent-roll preserves period counts and earliest date without loading the full ledger", async () => {
  const f = await fixture();
  f.rows.tenancy = [{ status: "ACTIVE", facility: { name: "A" }, customer: { firstName: "Synthetic", lastName: "Tenant" }, account: { accountNumber: "A1", balance: "120.25", _count: { ledgerEntries: 4321 }, ledgerEntries: [{ effectiveAt: new Date("2026-01-02T00:00:00Z") }] }, occupancies: [{ monthlyRate: "100.00", unit: { number: "1" } }] }];
  const rows = await f.buildReportRows(scope, parameters("rent-roll"));
  assert.equal(rows[0].periodLedgerEntries, 4321); assert.equal(rows[0].oldestPeriodEntry, "2026-01-02T00:00:00.000Z"); assert.equal(rows[0].balance, 120.25);
  assert.equal(f.queries[0].include.account.include.ledgerEntries.take, 1);
  assert.deepEqual(f.queries[0].include.account.include._count.select.ledgerEntries.where, f.queries[0].include.account.include.ledgerEntries.where);
});

test("occupancy totals include empty facilities and complete bounded unit data", async () => {
  const f = await fixture();
  f.rows.facility = [{ id: "a", name: "A" }, { id: "b", name: "Empty" }];
  f.rows.unit = [{ facilityId: "a", monthlyRate: "200", occupancies: [{ monthlyRate: "150" }] }, { facilityId: "a", monthlyRate: "300", occupancies: [] }];
  const rows = await f.buildReportRows(scope, parameters("occupancy-revenue"));
  assert.equal(rows[0].totalUnits, 2); assert.equal(rows[0].occupiedUnits, 1); assert.equal(rows[0].monthlyOccupiedRent, 150); assert.equal(rows[0].potentialMonthlyRent, 500); assert.equal(rows[0].economicOccupancyPercent, 30);
  assert.equal(rows[1].totalUnits, 0);
  f.rows.unit = Array(MAX_REPORT_ROWS + 1).fill({});
  await assert.rejects(f.buildReportRows(scope, parameters("occupancy-revenue")), /REPORT_LIMIT/);
});

async function ageingFixture(counts: Row[]) {
  const queries: Row[] = [];
  const account = { id: "account", accountNumber: "A1", customer: { firstName: "Synthetic", lastName: "Tenant" }, tenancy: { facilityId: "a", facility: { id: "a", name: "A" } }, balance: { toString: () => "100" }, currency: "ZAR", ledgerEntries: [{ id: "charge", type: "CHARGE", amount: { toString: () => "100" }, description: "Storage", effectiveAt: new Date("2020-01-01T00:00:00+02:00") }], payments: [], adjustments: [], debitInstructions: [], collectionCase: { revision: 1, activities: [], promises: [], terms: { dueDays: 0, allocation: "OLDEST_DUE_FIRST", approvalReference: "Synthetic approved terms", overrides: [] } } };
  const tx = { account: { findMany: async (args: Row) => { queries.push(args); return args.select ? counts : [account]; } }, auditEvent: { findMany: async () => [] }, user: { findMany: async () => { throw Error("Reports must not load owner choices"); } } };
  const db = { $transaction: async (work: (tx: Row) => Promise<unknown>, options: Row) => { assert.equal(options.isolationLevel, "RepeatableRead"); return work(tx); } };
  const output = await build({ absWorkingDir: process.cwd(), tsconfig: "tsconfig.json", stdin: { contents: 'export {collectionsWorkspace} from "./src/lib/collections-service";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "ageing-workload-fixture", setup(b) {
    const mocks: Record<string, string> = { "@/generated/prisma/client": 'export const Prisma={TransactionIsolationLevel:{RepeatableRead:"RepeatableRead"}};', "@/lib/db": "export const db=__fixture.db;", "@/lib/scope": "export const facilityWhere=s=>({organisationId:s.organisationId,id:{in:s.facilityIds}});" };
    b.onResolve({ filter: /^@\// }, a => mocks[a.path] ? { path: a.path, namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: mocks[a.path] }));
  } }] });
  const loaded = { exports: {} as { collectionsWorkspace: (s: typeof scope, date: string, bounded: boolean) => Promise<{ rows: Row[] }> } };
  new Function("require", "module", "exports", "__fixture", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, { db });
  return { ...loaded.exports, queries };
}

test("ageing rejects excessive child and aggregate histories before loading or evaluating accounts", async () => {
  for (const relation of ["ledgerEntries", "payments", "adjustments", "debitInstructions"]) {
    const counts = { ledgerEntries: 0, payments: 0, adjustments: 0, debitInstructions: 0, [relation]: 2001 };
    const f = await ageingFixture([{ _count: counts }]);
    await assert.rejects(f.collectionsWorkspace(scope, "2026-01-31", true), /REPORT_LIMIT/);
    assert.equal(f.queries.length, 1); assert.equal(f.queries[0].take, 2001);
    assert.ok(JSON.stringify(f.queries[0].where).includes('"org"'));
    assert.ok(JSON.stringify(f.queries[0].where).includes('"a"'));
  }
  const f = await ageingFixture(Array(6).fill({ _count: { ledgerEntries: 2000, payments: 0, adjustments: 0, debitInstructions: 0 } }));
  await assert.rejects(f.collectionsWorkspace(scope, "2026-01-31", true), /REPORT_LIMIT/);
  assert.equal(f.queries.length, 1);
});

test("bounded ageing keeps complete historical sources and approved ageing calculations", async () => {
  const f = await ageingFixture([{ _count: { ledgerEntries: 1, payments: 0, adjustments: 0, debitInstructions: 0 } }]);
  const result = await f.collectionsWorkspace(scope, "2026-01-31", true);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].ageing.issue, null);
  assert.equal(result.rows[0].ageing.overdue, 10000); assert.equal(result.rows[0].sources[0].date, "2020-01-01");
  assert.equal(f.queries[1].include.ledgerEntries.take, undefined);
  assert.equal(f.queries[1].where.customer.organisationId, "org");
});
