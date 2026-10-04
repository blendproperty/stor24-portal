import assert from "node:assert/strict";
import test from "node:test";
import { databaseConfig, databaseLimits } from "../src/lib/database-limits";

test("database defaults bound connections and runaway queries", () => {
  assert.deepEqual(databaseLimits({}), {
    max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 30000, idle_in_transaction_session_timeout: 60000,
    application_name: "stor24-crm",
  });
});
test("invalid limits fail without disclosing configuration values", () => {
  for (const name of ["DB_POOL_MAX", "DB_CONNECTION_TIMEOUT_MS", "DB_POOL_IDLE_TIMEOUT_MS", "DB_STATEMENT_TIMEOUT_MS", "DB_IDLE_TRANSACTION_TIMEOUT_MS"]) {
    for (const value of ["", "0", "-1", "Infinity", "1.5", " ", "1e1", "secret-invalid-value", "999999999"]) {
      assert.throws(() => databaseLimits({ [name]: value }), error => error instanceof Error && error.message === `INVALID_DATABASE_LIMIT:${name}`);
    }
  }
  assert.equal(databaseLimits({ DB_POOL_MAX: "20" }).max, 20);
});
test("connection URL parameters cannot disable limits and TLS parameters are preserved", () => {
  const config = databaseConfig("postgresql://ci:ci@localhost:5432/test?statement_timeout=0&idle_in_transaction_session_timeout=0&max=1000&sslmode=verify-full");
  const url = new URL(config.connectionString!);
  assert.equal(url.searchParams.has("statement_timeout"), false);
  assert.equal(url.searchParams.has("idle_in_transaction_session_timeout"), false);
  assert.equal(url.searchParams.has("max"), false);
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(config.statement_timeout, 30000);
});
