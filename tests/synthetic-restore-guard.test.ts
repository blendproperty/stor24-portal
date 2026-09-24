import assert from "node:assert/strict";
import test from "node:test";
import { syntheticRestoreTarget } from "../src/lib/synthetic-restore-guard";
const fixture = { GITHUB_ACTIONS: "true", CI: "true", MERCHANDISE_DB_TEST: "isolated-ci", GITHUB_REPOSITORY: "blendproperty/stor24-portal", DATABASE_URL: "postgresql://ci:ci@localhost:5432/merchandise_ci", POSTGRES_CONTAINER: "a".repeat(64) };
test("restore drill only accepts the disposable CI database and a separate fixed target", () => {
  const target = syntheticRestoreTarget(fixture);
  assert.equal(new URL(target.restoredUrl).pathname, "/stor24_restore_ci");
  assert.notEqual(target.sourceDatabase, target.restoredDatabase);
  for (const field of ["GITHUB_ACTIONS", "CI", "MERCHANDISE_DB_TEST", "GITHUB_REPOSITORY", "POSTGRES_CONTAINER"]) assert.throws(() => syntheticRestoreTarget({ ...fixture, [field]: undefined }));
  for (const url of ["postgresql://ci:ci@production:5432/merchandise_ci", "postgresql://ci:ci@localhost:5432/stor24", "postgresql://ci:ci@localhost:5433/merchandise_ci", "postgresql://owner:secret@localhost:5432/merchandise_ci", "postgresql://ci:ci@localhost:5432/merchandise_ci?host=production", "postgresql://ci:ci@localhost:5432/merchandise_ci#other", "not-a-url"]) assert.throws(() => syntheticRestoreTarget({ ...fixture, DATABASE_URL: url }));
  assert.throws(() => syntheticRestoreTarget({ ...fixture, POSTGRES_CONTAINER: "production" }));
});
