import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rows: Record<string, string> = {
  facilities: "a,Alpha,A,Africa/Johannesburg\nb,Beta,B,Africa/Johannesburg",
  unit_types: "ta,a,Small,2,2,4\ntb,b,Small,2,2,4",
  units: "ua,a,ta,1,AVAILABLE,100\nub,b,tb,1,AVAILABLE,100",
  customers: "c,Synthetic,Customer,,,",
  tenancies: "t,a,c,ua,ACTIVE,2026-09-01,,100",
  reservations: "r,b,c,ub,ACTIVE,100,2026-10-01,2026-10-01",
};

function validate(overrides: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "stor24-migration-test-"));
  try {
    for (const [name, data] of Object.entries({ ...rows, ...overrides })) {
      const header = headers[name] ?? readFileSync(resolve("migration/templates", `${name}.csv`), "utf8").trim();
      writeFileSync(join(directory, `${name}.csv`), `${header}\n${data}\n`);
    }
    const output = join(directory, "result.json");
    const run = spawnSync(process.execPath, [resolve("scripts/validate-migration-export.mjs"), directory, output], { encoding: "utf8" });
    assert.equal(run.error, undefined);
    return { status: run.status, report: JSON.parse(readFileSync(output, "utf8")) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("migration validator accepts linked facilities with optional customer fields", () => {
  const result = validate();
  assert.equal(result.status, 0); assert.equal(result.report.valid, true);
  assert.equal(result.report.counts.units, 2);
});

test("migration validator rejects malformed CSV instead of approving truncated data", () => {
  for (const customer of ['c,"Synthetic,Customer,,,', 'c,Syn"thetic,Customer,,,', 'c,"Synthetic"junk,Customer,,,', 'c,Synthetic,Customer,,', 'c,Synthetic,Customer,,,,extra']) {
    const result = validate({ customers: customer });
    assert.equal(result.status, 1, customer); assert.equal(result.report.valid, false);
    assert.match(result.report.errors.join("\n"), /CSV|column count/);
  }
  for (const header of ['legacy_id,first_name,last_name,company_name,email,phone,phone', 'legacy_id,first_name,last_name,company_name,email,phone,']) {
    const result = validate({ customers: 'c,Synthetic,Customer,,,,' }, { customers: header });
    assert.equal(result.status, 1); assert.match(result.report.errors.join("\n"), /header/);
  }
});

test("migration validator accepts escaped quotes, quoted commas and multiline fields", () => {
  const result = validate({ customers: 'c,"Syn,""thetic""","Customer\nName",,,' });
  assert.equal(result.status, 0); assert.equal(result.report.valid, true);
  assert.equal(result.report.counts.customers, 1);
});

test("migration validator rejects every blank required relationship", () => {
  for (const [name, indexes] of Object.entries({ unit_types: [1], units: [1, 2], tenancies: [1, 2, 3], reservations: [1, 2, 3] })) {
    for (const index of indexes) {
      const record = rows[name].split("\n")[0].split(","); record[index] = "";
      const result = validate({ [name]: [record.join(","), ...rows[name].split("\n").slice(1)].join("\n") });
      assert.equal(result.status, 1, `${name} relationship ${index}`);
      assert.equal(result.report.valid, false);
      assert.match(result.report.errors.join("\n"), /missing required reference/);
    }
  }
});

test("migration validator rejects cross-facility links even when all IDs exist", () => {
  const cases: Record<string, string>[] = [
    { units: "ua,a,tb,1,AVAILABLE,100\nub,b,tb,1,AVAILABLE,100" },
    { tenancies: "t,b,c,ua,ACTIVE,2026-09-01,,100" },
    { reservations: "r,a,c,ub,ACTIVE,100,2026-10-01,2026-10-01" },
  ];
  for (const overrides of cases) {
    const result = validate(overrides);
    assert.equal(result.status, 1); assert.equal(result.report.valid, false);
    assert.match(result.report.errors.join("\n"), /belongs to a different facility/);
  }
});
