import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const validator = readFileSync(new URL("../scripts/validate-migration-export.mjs", import.meta.url), "utf8");
const runbook = readFileSync(new URL("../docs/MIGRATION_REHEARSAL.md", import.meta.url), "utf8");

test("migration validator checks duplicate keys and broken references", () => {
  assert.match(validator, /duplicate legacy_id/);
  assert.match(validator, /references missing/);
  assert.match(validator, /process\.exitCode = 1/);
});

test("migration runbook requires validation, reconciliation and rollback evidence", () => {
  assert.match(runbook, /Reconcile record counts/);
  assert.match(runbook, /Roll back if counts do not reconcile/);
  assert.match(runbook, /cannot be claimed until an authorised legacy export is supplied/);
});
